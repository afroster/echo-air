const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

const {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pn = require('awesome-phonenumber');

const router = express.Router();

function removeFile(x_path) {
    try {
        if (!fs.existsSync(x_path)) return false;

        fs.rmSync(x_path, {
            recursive: true,
            force: true
        });
    } catch (e) {
        console.error(e);
    }
}

router.get('/', async (req, res) => {
    let x_num = req.query.number;

    if (!x_num) {
        return res.status(400).send({
            code: 'Please provide a phone number'
        });
    }

    x_num = x_num.replace(/[^0-9]/g, '');

    const x_phone = pn('+' + x_num);

    if (!x_phone.isValid()) {
        return res.status(400).send({
            code: 'Invalid phone number. Enter your full international number.'
        });
    }

    x_num = x_phone.getNumber('e164').replace('+', '');

    const x_session = 'echo~' + crypto.randomBytes(24).toString('hex');

    const x_pair = path.join(
        process.cwd(),
        'session',
        x_session
    );

    async function x_connect() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(x_pair);

        try {
            const {
                version
            } = await fetchLatestBaileysVersion();

            const x_echo = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({
                            level: 'fatal'
                        }).child({
                            level: 'fatal'
                        })
                    )
                },
                printQRInTerminal: false,
                logger: pino({
                    level: 'fatal'
                }).child({
                    level: 'fatal'
                }),
                browser: Browsers.windows('Chrome'),
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            });

            x_echo.ev.on('creds.update', saveCreds);

            x_echo.ev.on('connection.update', async (update) => {
                const {
                    connection,
                    lastDisconnect,
                    isNewLogin,
                    isOnline
                } = update;

                if (connection === 'open') {
                    console.log('Echo connected successfully!');

                    try {
                        const x_creds = fs.readFileSync(
                            path.join(x_pair, 'creds.json')
                        );

                        const x_jid = jidNormalizedUser(
                            x_num + '@s.whatsapp.net'
                        );

                        // Send session ID
                        await x_echo.sendMessage(x_jid, {
                            text: `*ECHO SESSION ID*\n\n${x_session}`
                        });

                        // Send credentials file
                        await x_echo.sendMessage(x_jid, {
                            document: x_creds,
                            mimetype: 'application/json',
                            fileName: 'creds.json',
                            caption: '*ECHO SESSION*\n\nYour session file is ready. Keep it private and do not share it.'
                        });

                        console.log('Echo session and ID sent successfully.');

                        await delay(1000);

                        removeFile(x_pair);

                        console.log('Echo session cleaned up.');

                    } catch (error) {
                        console.error('Error sending session:', error);
                        removeFile(x_pair);
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

                    if (x_status === 401) {
                        console.log('Logged out from WhatsApp.');
                        removeFile(x_pair);
                    } else {
                        console.log('Connection closed — restarting...');
                        x_connect();
                    }
                }
            });

            if (!x_echo.authState.creds.registered) {
                await delay(3000);

                try {
                    let x_code = await x_echo.requestPairingCode(x_num);

                    x_code = x_code?.match(/.{1,4}/g)?.join('-') || x_code;

                    if (!res.headersSent) {
                        console.log({
                            number: x_num,
                            code: x_code,
                            session: x_session
                        });

                        await res.send({
                            code: x_code
                        });
                    }

                } catch (error) {
                    console.error('Pairing code error:', error);

                    if (!res.headersSent) {
                        res.status(503).send({
                            code: 'Failed to get pairing code. Please try again.'
                        });
                    }
                }
            }

        } catch (error) {
            console.error('Echo initialization error:', error);

            if (!res.headersSent) {
                res.status(503).send({
                    code: 'Service Unavailable'
                });
            }
        }
    }

    await x_connect();
});

module.exports = router;
