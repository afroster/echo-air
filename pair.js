
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
// REMOVE DIRECTORY
// ============================================

async function removeFile(filePath) {
    try {
        await fs.promises.rm(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (error) {
        console.error('CLEANUP ERROR:', error);
        return false;
    }
}

// ============================================
// ERROR RESPONSE
// ============================================

function sendError(res, error, status = 500) {
    console.error('ECHO ERROR:', error.stack || error);

    if (!res.headersSent) {
        return res.status(status).json({
            code: error.message || String(error),
            error: error.name || 'Error',
            details: error.stack || 'No stack trace available'
        });
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

        // Generate session ID
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

        // Save credentials
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
            // CONNECTION OPEN
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

                    console.log('SESSION ID SENT');

                    // Read credentials
                    const credsPath = path.join(
                        dirs,
                        'creds.json'
                    );

                    if (!fs.existsSync(credsPath)) {
                        throw new Error('creds.json was not created.');
                    }

                    const sessionFile = await fs.promises.readFile(
                        credsPath
                    );

                    // Send credentials
                    await socket.sendMessage(userJid, {
                        document: sessionFile,
                        mimetype: 'application/json',
                        fileName: 'creds.json'
                    });

                    console.log('CREDS FILE SENT');

                    // Completion message
                    await socket.sendMessage(userJid, {
                        text:
                            '*ECHO CONNECTION SUCCESSFUL*\n\n' +
                            'Your session ID and credentials have been sent.\n\n' +
                            'Keep them private. Do not share them with anyone.\n\n' +
                            'Thank you for using Echo.'
                    });

                    console.log('ECHO SESSION COMPLETED');

                    await delay(1500);

                    socket.end(undefined);

                    await removeFile(dirs);

                } catch (error) {
                    console.error(
                        'SESSION DELIVERY ERROR:',
                        error.stack || error
                    );
                }
            }

            if (isNewLogin) {
                console.log('NEW WHATSAPP LOGIN');
            }

            // ====================================
            // CONNECTION CLOSED
            // ====================================

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.log('CONNECTION CLOSED:', statusCode);

                if (statusCode === 401) {
                    console.log('WHATSAPP LOGGED OUT');
                    await removeFile(dirs);
                } else {
                    console.log('WHATSAPP CONNECTION CLOSED');
                }
            }
        });

        // ========================================
        // REQUEST PAIRING CODE
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

        console.log('PAIRING CODE GENERATED');

        if (!res.headersSent) {
            return res.status(200).json({
                code
            });
        }

    } catch (error) {
        if (socket) {
            try {
                socket.end(undefined);
            } catch (closeError) {
                console.error('SOCKET CLOSE ERROR:', closeError);
            }
        }

        if (dirs) {
            await removeFile(dirs);
        }

        return sendError(res, error);
    }
});

module.exports = router;
