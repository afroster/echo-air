const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const PhoneNumber = require('awesome-phonenumber');


const logger = pino({ level: 'silent' });
const sessionRoot = path.join(process.cwd(), 'session');
fs.mkdirSync(sessionRoot, { recursive: true });
const activeSessions = new Set();
function generate_SessionId() {
    return 'echo~' + crypto.randomBytes(24).toString('base64url');
}

function removeSession(sessionPath) {
    fs.rmSync(sessionPath, {
        recursive: true,
        force: true
    });
}

function validatePhoneNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return null;
    const parsedNumber = new PhoneNumber('+' + digits);
    if (!parsedNumber.isValid()) return null;
    return parsedNumber.getNumber('e164').replace('+', '');
}


const router = express.Router();

router.get('/', async (req, res) => {
    const phoneNumber = validatePhoneNumber(req.query.number);

    if (!phoneNumber) {
        return res.status(400).json({
            error: 'Please provide a valid international phone number'
        });
    }

    const sessionId = generate_SessionId();
    const sessionPath = path.join(sessionRoot, sessionId);
    let socket;
    let reconnecting = false;
    let completed = false;
    activeSessions.add(sessionId);
    const cleanup = () => {
        if (completed) return;
        completed = true;
        activeSessions.delete(sessionId);
        removeSession(sessionPath);
    };

    async function startSession() {
        if (completed || reconnecting) return;
        reconnecting = true;
        try {
            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();
            socket = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
                },
                logger,
                browser: Browsers.windows('Chrome'),
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            });

            socket.ev.on('creds.update', saveCreds);
            socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    reconnecting = false;
                    if (completed) return;
                    try {
                        const credentialsPath = path.join(
                            sessionPath,
                            'creds.json'
                        );

                        const credentials = await fs.promises.readFile(
                            credentialsPath
                        );

                        const recipient = jidNormalizedUser(
                            phoneNumber + '@s.whatsapp.net'
                        );

                        await socket.sendMessage(recipient, {
                            document: credentials,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });

                        await socket.sendMessage(recipient, {
                            image: {
                                url: 'https://img.youtube.com/vi/-oz_u1iMgf8/maxresdefault.jpg'
                            },
                            caption: `*Echo*

Keep it private`                        });

                        await socket.sendMessage(recipient, {
                            text: `Do not share this file with anybody.
                        `});

                        cleanup();
                        console.log('Session completed successfully.');

                    } catch (error) {
                        console.error('Message delivery failed:', error.message);
                        cleanup();
                    }
                }

                if (connection === 'close' && !completed) {
                    reconnecting = false;

                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log('WhatsApp session logged out.');
                        cleanup();
                        return;
                    }

                    console.log('Connection closed. Reconnecting...');

                    setTimeout(() => {
                        if (!completed) startSession();
                    }, 3000);
                }
            });

            reconnecting = false;

            if (!socket.authState.creds.registered) {
                await new Promise(resolve => setTimeout(resolve, 3000));

                if (completed) return;

                const pairingCode = await socket.requestPairingCode(
                    phoneNumber
                );

                const formattedCode =
                    pairingCode.match(/.{1,4}/g)?.join('-') || pairingCode;

                if (!res.headersSent) {
                    res.json({
                        code: formattedCode,
                        id: sessionId
                    });
                }
            }

        } catch (error) {
            reconnecting = false;

            console.error('Session initialization failed:', error.message);

            if (!res.headersSent) {
                res.status(503).json({
                    error: 'Unable to initialize WhatsApp session.'
                });
            }

            cleanup();
        }
    }

    await startSession();
});

module.exports = router;
