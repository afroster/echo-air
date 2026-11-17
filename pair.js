
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

const baileys = require('@whiskeysockets/baileys');
const PhoneNumber = require('awesome-phonenumber');

const makeWASocket = baileys.default || baileys.makeWASocket;

const {
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} = baileys;

const router = express.Router();

const logger = pino({
    level: 'fatal'
});

// ============================================
// REMOVE SESSION DIRECTORY
// ============================================

async function removeFile(filePath) {
    try {
        await fs.promises.rm(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (error) {
        console.error('Session cleanup error:', error);
        return false;
    }
}

// ============================================
// PAIRING ROUTE
// ============================================

router.get('/', async (req, res) => {
    let socket;
    let dirs;

    try {
        let num = req.query.number;

        if (!num || typeof num !== 'string') {
            return res.status(400).json({
                code: 'Please provide your WhatsApp number.'
            });
        }

        // Clean number
        num = num.replace(/[^0-9]/g, '');

        if (!num) {
            return res.status(400).json({
                code: 'Invalid phone number.'
            });
        }

        // Validate number
        const phone = new PhoneNumber('+' + num);

        if (!phone.isValid()) {
            return res.status(400).json({
                code: 'Invalid phone number. Enter your full international number.'
            });
        }

        // Normalize number
        num = phone.getNumber('e164').replace('+', '');

        // Generate echo~ + 49 hexadecimal characters
        const sessionId = 'echo~' + crypto.randomBytes(25)
            .toString('hex')
            .slice(0, 49);

        // Session directory
        dirs = path.join(__dirname, 'session', sessionId);

        await fs.promises.mkdir(dirs, {
            recursive: true
        });

        // ========================================
        // AUTH STATE
        // ========================================

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(dirs);

        const {
            version
        } = await fetchLatestBaileysVersion();

        // ========================================
        // CREATE SOCKET
        // ========================================

        socket = makeWASocket({
            version,

            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    logger
                )
            },

            printQRInTerminal: false,
            logger,
            browser: Browsers.windows('Chrome'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            maxRetries: 5
        });

        // Save credentials whenever updated
        socket.ev.on('creds.update', saveCreds);

        // ========================================
        // CONNECTION UPDATE
        // ========================================

        socket.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect,
                isNewLogin
            } = update;

            // ====================================
            // SUCCESSFULLY CONNECTED
            // ====================================

            if (connection === 'open') {
                console.log('ECHO CONNECTED SUCCESSFULLY');

                try {
                    await saveCreds();

                    const userJid = jidNormalizedUser(
                        num + '@s.whatsapp.net'
                    );

                    // Send session ID
                    await socket.sendMessage(userJid, {
                        text:
                            '*ECHO SESSION ID*\n\n' +
                            sessionId +
                            '\n\nDo not share this session ID with anyone.'
                    });

                    console.log('Session ID sent successfully.');

                    // Locate credentials file
                    const credsPath = path.join(
                        dirs,
                        'creds.json'
                    );

                    if (!fs.existsSync(credsPath)) {
                        throw new Error(
                            'creds.json was not created.'
                        );
                    }

                    // Read credentials
                    const sessionFile = await fs.promises.readFile(
                        credsPath
                    );

                    // Send credentials file
                    await socket.sendMessage(userJid, {
                        document: sessionFile,
                        mimetype: 'application/json',
                        fileName: 'creds.json'
                    });

                    console.log('Credentials file sent successfully.');

                    // Send final message
                    await socket.sendMessage(userJid, {
                        text:
                            '*ECHO CONNECTION SUCCESSFUL*\n\n' +
                            'Your session ID and credentials have been sent.\n\n' +
                            'Keep them private and do not share them with anyone.\n\n' +
                            'Thank you for using Echo.'
                    });

                    console.log('ECHO SESSION COMPLETED');

                    // Close socket
                    await delay(1500);

                    socket.end(undefined);

                    // Remove temporary session directory
                    await removeFile(dirs);

                } catch (error) {
                    console.error(
                        'ECHO SESSION DELIVERY ERROR:',
                        error.stack || error
                    );
                }
            }

            if (isNewLogin) {
                console.log('New WhatsApp login detected.');
            }

            // ====================================
            // CONNECTION CLOSED
            // ====================================

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.log(
                    'ECHO CONNECTION CLOSED:',
                    statusCode
                );

                if (statusCode === 401) {
                    console.log('WhatsApp logged out.');

                    await removeFile(dirs);
                } else {
                    console.log(
                        'WhatsApp connection closed. Check connection logs.'
                    );
                }
            }
        });

        // ========================================
        // GENERATE PAIRING CODE
        // ========================================

        if (state.creds.registered) {
            socket.end(undefined);

            await removeFile(dirs);

            return res.status(400).json({
                code: 'This session is already registered.'
            });
        }

        await delay(3000);

        const pairingCode = await socket.requestPairingCode(num);

        const code = pairingCode
            ?.match(/.{1,4}/g)
            ?.join('-') || pairingCode;

        console.log('ECHO PAIRING CODE GENERATED');

        console.log({
            number: num,
            code,
            session: sessionId
        });

        if (!res.headersSent) {
            return res.status(200).json({
                code
            });
        }

    } catch (error) {
        console.error(
            'ECHO PAIRING ERROR:',
            error.stack || error
        );

        if (socket) {
            try {
                socket.end(undefined);
            } catch (closeError) {
                console.error('Socket close error:', closeError);
            }
        }

        if (dirs) {
            await removeFile(dirs);
        }

        if (!res.headersSent) {
            return res.status(500).json({
                code: error.message || 'Echo pairing failed.'
            });
        }
    }
});

module.exports = router;
        
