
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

const baileys = require('@whiskeysockets/baileys');
const pn = require('awesome-phonenumber');

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
// REMOVE FILE / DIRECTORY
// ============================================

async function removeFile(filePath) {
    try {
        await fs.promises.rm(filePath, {
            recursive: true,
            force: true
        });

        return true;
    } catch (error) {
        console.error('Error removing file:', error);
        return false;
    }
}


// ============================================
// PAIRING ROUTE
// ============================================

router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num || typeof num !== 'string') {
        return res.status(400).json({
            code: 'Please provide a phone number.'
        });
    }

    // Clean phone number
    num = num.replace(/[^0-9]/g, '');

    // Validate phone number
    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).json({
            code: 'Invalid phone number. Please enter your full international number without + or spaces.'
        });
    }

    // Normalize number
    num = phone.getNumber('e164').replace('+', '');

    // Generate echo~ + 49 hexadecimal characters
    const sessionId = 'echo~' + crypto.randomBytes(25)
        .toString('hex')
        .slice(0, 49);

    // Session directory
    const dirs = path.join(
        __dirname,
        'session',
        sessionId
    );

    let socket;

    // ========================================
    // INITIATE SESSION
    // ========================================

    async function initiateSession() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(dirs);

        const {
            version
        } = await fetchLatestBaileysVersion();

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


        // ====================================
        // CONNECTION UPDATE
        // ====================================

        socket.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect,
                isNewLogin,
                isOnline
            } = update;

            // Connected successfully
            if (connection === 'open') {
                console.log('Echo connected successfully!');
                console.log('Sending session file...');

                try {
                    await saveCreds();

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

                    const userJid = jidNormalizedUser(
                        num + '@s.whatsapp.net'
                    );

                    // Send credentials file
                    await socket.sendMessage(userJid, {
                        document: sessionFile,
                        mimetype: 'application/json',
                        fileName: 'creds.json'
                    });

                    console.log('Session file sent successfully.');

                    // Send warning
                    await socket.sendMessage(userJid, {
                        text:
                            'Do not share this file with anybody.\n\n' +
                            'Thanks for using Echo.'
                    });

                    console.log('Warning message sent successfully.');

                    // Cleanup
                    await delay(1000);

                    await removeFile(dirs);

                    console.log('Echo session completed successfully.');

                } catch (error) {
                    console.error('Error sending session:', error);
                }
            }

            if (isNewLogin) {
                console.log('New login via pairing code.');
            }

            if (isOnline) {
                console.log('Echo is online.');
            }

            // Connection closed
            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.log('Echo connection closed:', statusCode);

                if (statusCode === 401) {
                    console.log('WhatsApp logged out.');
                    await removeFile(dirs);
                } else {
                    console.log('Echo connection closed. Reconnecting...');

                    if (fs.existsSync(dirs)) {
                        try {
                            await initiateSession();
                        } catch (error) {
                            console.error('Reconnect error:', error);
                        }
                    }
                }
            }
        });


        // ====================================
        // REQUEST PAIRING CODE
        // ====================================

        if (!state.creds.registered) {
            await delay(3000);

            try {
                let code = await socket.requestPairingCode(num);

                code = code?.match(/.{1,4}/g)?.join('-') || code;

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
                console.error('Pairing code error:', error);

                if (!res.headersSent) {
                    return res.status(503).json({
                        code: error.message || 'Failed to get pairing code.'
                    });
                }
            }
        } else {
            return res.status(400).json({
                code: 'This session is already registered.'
            });
        }
    }


    // ========================================
    // START SESSION
    // ========================================

    try {
        if (typeof makeWASocket !== 'function') {
            throw new Error('Baileys makeWASocket function is unavailable.');
        }

        await fs.promises.mkdir(dirs, {
            recursive: true
        });

        await initiateSession();

    } catch (error) {
        console.error('ECHO INITIALIZATION ERROR:', error.stack || error);

        if (socket) {
            try {
                socket.end(undefined);
            } catch (closeError) {
                console.error('Socket close error:', closeError);
            }
        }

        await removeFile(dirs);

        if (!res.headersSent) {
            return res.status(500).json({
                code: error.message || 'Echo initialization failed.'
            });
        }
    }
});

module.exports = router;
            
