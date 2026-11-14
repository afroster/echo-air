
const express = require('express');
const path = require('path');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const { createSession } = require('./Func/session');

const app = express();
const PORT = process.env.PORT || 8000;
const ROOT = process.cwd();

const logger = pino({ level: 'silent' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

const sessions = new Map();
const pair_x = new Map();

app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/pair', async (req, res) => {
    const number = String(req.query.number || '').replace(/\D/g, '');

    if (!/^\d{7,15}$/.test(number)) {
        return res.status(400).json({
            ok: false,
            message: 'Enter a valid number with country code'
        });
    }

    let wa;
    let id;
    let responseSent = false;
    let codeRequested = false;
    let connectionClosed = false;
    let pairTimer = null;
    let safetyTimer = null;

    const sendResponse = (status, data) => {
        if (!responseSent && !res.headersSent) {
            responseSent = true;
            res.status(status).json(data);
        }
    };

    try {
        const session = await createSession();

        id = session.id;

        if (!/^echo~[a-f0-9]{96}$/.test(id)) {
            throw new Error('Invalid session ID generated');
        }

        pair_x.set(id, {
            status: 'starting',
            sessionId: null,
            message: 'Starting WhatsApp connection'
        });

        const { state, saveCreds } =
            await useMultiFileAuthState(session.creds_x);

        wa = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    logger
                )
            },
            logger,
            browser: Browsers.macOS('Safari'),
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sessions.set(id, wa);

        wa.ev.on('creds.update', saveCreds);

        wa.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            console.log('Connection update:', connection);

            // Request pairing code after socket initialization.
            if (
                connection === 'connecting' &&
                !codeRequested &&
                !state.creds.registered
            ) {
                codeRequested = true;

                pairTimer = setTimeout(async () => {
                    if (connectionClosed) return;

                    try {
                        const code = await wa.requestPairingCode(number);

                        if (connectionClosed) return;

                        pair_x.set(id, {
                            status: 'waiting',
                            code,
                            sessionId: null,
                            message: 'Waiting for WhatsApp pairing'
                        });

                        sendResponse(200, {
                            ok: true,
                            requestId: id,
                            code
                        });

                        console.log('Pairing code generated:', id);

                    } catch (error) {
                        console.error('Pairing code error:', error);

                        pair_x.set(id, {
                            status: 'error',
                            sessionId: null,
                            message: error.message
                        });

                        sendResponse(500, {
                            ok: false,
                            message: error.message
                        });

                        sessions.delete(id);

                        try {
                            wa.end(error);
                        } catch (_) {}
                    }
                }, 3000);
            }

            // WhatsApp connected.
            if (connection === 'open') {
                if (pairTimer) clearTimeout(pairTimer);
                if (safetyTimer) clearTimeout(safetyTimer);

                try {
                    await saveCreds();

                    pair_x.set(id, {
                        status: 'connected',
                        sessionId: id,
                        message: 'WhatsApp connected successfully'
                    });

                    console.log('WhatsApp connected:', id);

                    await wa.sendMessage(wa.user.id, {
                        text:
                            '*ECHO SESSION*\n\n' +
                            'Your session has been saved.\n\n' +
                            `Session ID: ${id}\n\n` +
                            '*Keep this ID private.*'
                    });

                } catch (error) {
                    console.error('Connection save error:', error);
                }
            }

            // WhatsApp disconnected.
            if (connection === 'close') {
                connectionClosed = true;

                if (pairTimer) clearTimeout(pairTimer);
                if (safetyTimer) clearTimeout(safetyTimer);

                const status =
                    lastDisconnect?.error?.output?.statusCode;

                sessions.delete(id);

                if (status === DisconnectReason.loggedOut) {
                    pair_x.set(id, {
                        status: 'logged_out',
                        sessionId: id,
                        message: 'WhatsApp logged out. Pair again.'
                    });
                } else {
                    pair_x.set(id, {
                        status: 'disconnected',
                        sessionId: null,
                        message: 'WhatsApp connection disconnected',
                        disconnectCode: status || null
                    });
                }

                console.error(
                    'WhatsApp connection closed:',
                    status,
                    lastDisconnect?.error
                );

                sendResponse(503, {
                    ok: false,
                    message: 'WhatsApp disconnected before pairing',
                    disconnectCode: status || null
                });
            }
        });

        // Safety timeout.
        safetyTimer = setTimeout(() => {
            if (!responseSent && !connectionClosed) {
                pair_x.set(id, {
                    status: 'timeout',
                    sessionId: null,
                    message: 'Connection timed out'
                });

                sendResponse(504, {
                    ok: false,
                    message: 'WhatsApp connection timed out'
                });

                console.error('Pairing timeout:', id);
            }
        }, 30000);

    } catch (error) {
        console.error('Pair route error:', error);

        if (pairTimer) clearTimeout(pairTimer);
        if (safetyTimer) clearTimeout(safetyTimer);

        if (id) {
            sessions.delete(id);

            pair_x.set(id, {
                status: 'error',
                sessionId: null,
                message: error.message
            });
        }

        sendResponse(500, {
            ok: false,
            message: error.message || 'Pairing service unavailable'
        });
    }
});

// Pairing status.
app.get('/pair-status', (req, res) => {
    const id = String(req.query.id || '');

    if (!/^echo~[a-f0-9]{96}$/.test(id)) {
        return res.status(400).json({
            ok: false,
            message: 'Invalid session ID'
        });
    }

    const status = pair_x.get(id);

    if (!status) {
        return res.status(404).json({
            ok: false,
            message: 'Session not found'
        });
    }

    return res.json({
        ok: true,
        status: status.status,
        sessionId: status.sessionId,
        message: status.message
    });
});

app.use('/api', (req, res) => {
    res.status(404).json({
        ok: false,
        message: 'API route not found'
    });
});

app.listen(PORT, () => {
    console.log(`Echo server running on port ${PORT}`);
});
    
