
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');
const pn = require('awesome-phonenumber');

const baileys = require('@whiskeysockets/baileys');

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

    if (!x_num || typeof x_num !== 'string') {
        return res.status(400).send('Please provide a phone number.');
    }

    x_num = x_num.replace(/[^0-9]/g, '');

    const x_phone = pn('+' + x_num);

    if (!x_phone.isValid()) {
        return res.status(400).send(
            'Invalid phone number. Enter your full international number.'
        );
    }

    x_num = x_phone.getNumber('e164').replace('+', '');

    const x_session = 'echo~' + crypto.randomBytes(24).toString('hex');

    const x_pair = path.join(
        process.cwd(),
        'session',
        x_session
    );

    try {
        await fs.promises.mkdir(x_pair, {
            recursive: true
        });

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(x_pair);

        const {
            version
        } = await fetchLatestBaileysVersion();

        if (typeof makeWASocket !== 'function') {
            throw new Error('Baileys makeWASocket export is not a function.');
        }

        const x_echo = makeWASocket({
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
                console.log('Session ID:', x_session);

                try {
                    await saveCreds();

                    const x_credsPath = path.join(
                        x_pair,
                        'creds.json'
                    );

                    const x_creds = await fs.promises.readFile(
                        x_credsPath
                    );

                    const x_jid = jidNormalizedUser(
                        x_num + '@s.whatsapp.net'
                    );

                    await x_echo.sendMessage(x_jid, {
                        text: `*ECHO SESSION ID*\n\n${x_session}`
                    });

                    await x_echo.sendMessage(x_jid, {
                        document: x_creds,
                        mimetype: 'application/json',
                        fileName: 'creds.json',
                        caption:
                            '*ECHO SESSION*\n\nYour credentials file is ready. Keep it private.'
                    });

                    console.log('Session details sent successfully.');
                    console.log('Session files saved at:', x_pair);

                } catch (x_error) {
                    console.error('Session delivery error:', x_error);
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

                console.log('Connection closed. Status:', x_status);

                if (x_status === 401) {
                    console.log('WhatsApp logged out. Session:', x_session);
                }
            }
        });

        if (!state.creds.registered) {
            await delay(3000);

            let x_code = await x_echo.requestPairingCode(x_num);

            x_code = x_code?.match(/.{1,4}/g)?.join('-') || x_code;

            console.log('Pairing code:', x_code);
            console.log('Session ID:', x_session);

            if (!res.headersSent) {
                return res.status(200).type('text/plain').send(x_code);
            }
        } else {
            if (!res.headersSent) {
                return res.status(400).type('text/plain').send(
                    'This session is already registered.'
                );
            }
        }

    } catch (x_error) {
        console.error('PAIRING ERROR:', x_error);

        if (!res.headersSent) {
            return res.status(500).type('text/plain').send(
                'Pairing failed. Check your server logs.'
            );
        }
    }
});

module.exports = router;
    
