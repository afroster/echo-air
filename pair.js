
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
                    keys: makeCacheableSignalKeyStore(state.keys, pino({level: "fatal"}).child({level: "fatal"})),
                },
                logger: pino({level: "fatal"}).child({level: "fatal"}),
                browser: Browsers.macOS("Safari"),
                downloadHistory: false,
                syncFullHistory: false,      
                markOnlineOnConnect: false
        });

        sessions.set(id, wa);

        let codeRequested = false;

        wa.ev.on('creds.update', saveCreds);

        wa.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

        
            if (connection === 'open') {
                try {
                    await saveCreds();

                    pair_x.set(id, {
                        status: 'connected',
                        sessionId: id,
                        message: 'WhatsApp connected successfully'
                    });

                    console.log('WhatsApp connected successfully');

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

            if (connection === 'close') {
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
                        sessionId: id,
                        message: 'Connection disconnected.'
                    });
                }

                if (!responseSent) {
                    sendResponse(503, {
                        ok: false,
                        message: 'WhatsApp disconnected before pairing code generation'
                    });
                }

                console.log('WhatsApp connection closed:', status);
            }
        });

        setTimeout(async () => {
            if (codeRequested) return;
            codeRequested = true;

            try {
                if (state.creds.registered) {
                    throw new Error('Session is already registered');
                }

                const code = await wa.requestPairingCode(number);

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

            } catch (error) {
                console.error('Pairing code error:', error);

                pair_x.set(id, {
                    status: 'error',
                    sessionId: null,
                    message: error.message || 'Could not generate pairing code'
                });

                sendResponse(500, {
                    ok: false,
                    message: error.message || 'Pairing code generation failed'
                });

                sessions.delete(id);

                try {
                    wa.end(error);
                } catch (_) {}
            }
        }, 3000);

    } catch (error) {
        console.error('Pair route error:', error);

        if (id) {
            sessions.delete(id);

            pair_x.set(id, {
                status: 'error',
                sessionId: null,
                message: 'Server error'
            });
        }

        sendResponse(500, {
            ok: false,
            message: 'Pairing service unavailable'
        });
    }
});


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
    console.log(`Server running on port ${PORT}`);
});
        
