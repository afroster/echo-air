
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pn = require('awesome-phonenumber');

const router = express.Router();

router.get('/', async (req, res) => {
    let x_num = req.query.number;

    if (!x_num) {
        return res.status(400).json({
            error: 'Please provide a phone number.'
        });
    }

    x_num = x_num.replace(/[^0-9]/g, '');

    const x_phone = pn('+' + x_num);

    if (!x_phone.isValid()) {
        return res.status(400).json({
            error: 'Invalid phone number. Enter your full international number.'
        });
    }

    x_num = x_phone.getNumber('e164').replace('+', '');

    const x_session = 'echo~' + crypto.randomBytes(24).toString('hex');

    const x_pair = path.join(
        process.cwd(),
        'session',
        x_session
    );

    await fs.promises.mkdir(x_pair, {
        recursive: true
    });

    try {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(x_pair);

        const {
            version
        } = await fetchLatestBaileysVersion();

        const x_echo = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'fatal' })
                )
            },
            printQRInTerminal: false,
            logger: pino({ level: 'fatal' }),
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
                lastDisconnect
            } = update;

            if (connection === 'open') {
                console.log('Echo connected successfully!');

                try {
                    await saveCreds();

                    const x_creds = fs.readFileSync(
                        path.join(x_pair, 'creds.json')
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
                        caption: '*ECHO SESSION*\n\nYour credentials file is ready. Keep it private.'
                    });

                    console.log('Echo credentials sent successfully.');

                } catch (error) {
                    console.error('Error sending session:', error);
                }
            }

            if (connection === 'close') {
                const x_status =
                    lastDisconnect?.error?.output?.statusCode;

                if (x_status === 401) {
                    console.log('WhatsApp logged out.');
                } else {
                    console.log('Connection closed.');
                }
            }
        });

        if (!state.creds.registered) {
            await delay(3000);

            const x_code = await x_echo.requestPairingCode(x_num);

            const x_formatted = x_code
                ?.match(/.{1,4}/g)
                ?.join('-') || x_code;

            console.log('Pairing code:', x_formatted);

            if (!res.headersSent) {
                return res.status(200).json({
                    code: x_formatted,
                    id: x_session
                });
            }
        } else {
            return res.status(400).json({
                error: 'Session is already registered.'
            });
        }

    } catch (error) {
        console.error('Echo initialization error:', error);

        if (!res.headersSent) {
            return res.status(503).json({
                error: 'Failed to generate pairing code. Please try again.'
            });
        }
    }
});

module.exports = router;
