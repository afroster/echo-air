
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

const x_logger = pino({
    level: 'fatal'
});

router.get('/', async (req, res) => {
    let x_num = req.query.number;
    let x_socket;
    let x_pair;

    try {
        if (!x_num || typeof x_num !== 'string') {
            return res.status(400).json({
                code: 'Please provide a phone number.'
            });
        }

        x_num = x_num.replace(/[^0-9]/g, '');

        const x_phone = pn('+' + x_num);

        if (!x_phone.isValid()) {
            return res.status(400).json({
                code: 'Invalid phone number. Enter your full international number.'
            });
        }

        x_num = x_phone.getNumber('e164').replace('+', '');

        const x_session = 'echo~' + crypto.randomBytes(24).toString('hex');

        x_pair = path.join(
            __dirname,
            'session',
            x_session
        );

        await fs.promises.mkdir(x_pair, {
            recursive: true
        });

        if (typeof makeWASocket !== 'function') {
            throw new Error('makeWASocket is not a function. Check your Baileys version.');
        }

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(x_pair);

        const {
            version
        } = await fetchLatestBaileysVersion();

        x_socket = makeWASocket({
            version,

            auth: {
                creds: state.creds,

                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    x_logger
                )
            },

            printQRInTerminal: false,

            logger: x_logger,

            browser: Browsers.windows('Chrome'),

            markOnlineOnConnect: false,

            generateHighQualityLinkPreview: false,

            defaultQueryTimeoutMs: 60000,

            connectTimeoutMs: 60000,

            keepAliveIntervalMs: 30000,

            retryRequestDelayMs: 250,

            maxRetries: 5
        });

        x_socket.ev.on('creds.update', saveCreds);

        x_socket.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect,
                isNewLogin,
                isOnline
            } = update;

            if (connection === 'open') {
                console.log('Echo connected successfully!');

                try {
                    await saveCreds();

                    const x_creds = await fs.promises.readFile(
                        path.join(x_pair, 'creds.json')
                    );

                    const x_jid = jidNormalizedUser(
                        x_num + '@s.whatsapp.net'
                    );

                    await x_socket.sendMessage(x_jid, {
                        text: `*ECHO SESSION ID*\n\n${x_session}`
                    });

                    await x_socket.sendMessage(x_jid, {
                        document: x_creds,
                        mimetype: 'application/json',
                        fileName: 'creds.json',
                        caption: '*ECHO SESSION*\n\nYour session file is ready. Keep it private.'
                    });

                    console.log('Echo session sent successfully.');

                } catch (x_error) {
                    console.error('Echo session delivery error:', x_error.stack || x_error);
                }
            }

            if (isNewLogin) {
                console.log('New login via pairing code.');
            }

            if (isOnline) {
                console.log('Echo is online.');
            }

            if (connection === 'close') {
                const x_status =
                    lastDisconnect?.error?.output?.statusCode;

                console.log('Echo connection closed:', x_status);

                if (x_status === 401) {
                    console.log('WhatsApp logged out.');
                }
            }
        });

        if (!state.creds.registered) {
            await delay(3000);

            try {
                let x_code = await x_socket.requestPairingCode(x_num);

                x_code = x_code?.match(/.{1,4}/g)?.join('-') || x_code;

                console.log('Echo pairing code:', x_code);
                console.log('Echo session:', x_session);

                if (!res.headersSent) {
                    return res.status(200).json({
                        code: x_code
                    });
                }

            } catch (x_error) {
                console.error('ECHO PAIRING CODE ERROR:', x_error.stack || x_error);

                if (!res.headersSent) {
                    return res.status(503).json({
                        code: x_error.message || 'Failed to get pairing code.'
                    });
                }
            }

        } else {
            return res.status(400).json({
                code: 'Session is already registered.'
            });
        }

    } catch (x_error) {
        console.error('========== ECHO PAIRING ERROR ==========');
        console.error(x_error.stack || x_error);
        console.error('========================================');

        if (x_socket) {
            try {
                x_socket.end(undefined);
            } catch (x_endError) {
                console.error('Socket cleanup error:', x_endError);
            }
        }

        if (x_pair) {
            try {
                await fs.promises.rm(x_pair, {
                    recursive: true,
                    force: true
                });
            } catch (x_removeError) {
                console.error('Session cleanup error:', x_removeError);
            }
        }

        if (!res.headersSent) {
            return res.status(500).json({
                code: x_error.message || 'Unknown pairing error'
            });
        }
    }
});

module.exports = router;
