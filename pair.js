const express = require('express');
const path = require('path');
const pino = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason
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

app.get('/pair.html', (req, res) => {
    res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.get('/pair', async (req, res) => {
    const number = String(req.query.number || '')
        .replace(/\D/g, '');

    if (!/^\d{7,15}$/.test(number)) {
        return res.status(400).json({
            ok: false,
            message: 'Enter a valid number with country code'
        });
    }

    let wa;
    let id;

    try {
        const session = await createSession();
        id = session.id;

        const { state, saveCreds } =
            await useMultiFileAuthState(session.creds_x);

        _pair_x.set(id, {
            status: 'starting',
            sessionId: null,
            message: 'Starting WhatsApp connection'
        });

        wa = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Safari'),
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sessions.set(id, wa);

        let code_Req = false;
        wa.ev.on('creds.update', saveCreds);
        wa.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;
            if (qr && !wa.authState.creds.registered && !code_Req) {
                code_Req = true;

                try {
                    const code = await wa.requestPairingCode(number);
                    _pair_x.set(id, {
                        status: 'waiting',
                        code,
                        sessionId: null,
                        message: 'Waiting for WhatsApp pairing'
                    });

                    if (!res.headersSent) {
                        res.json({
                            ok: true,
                            requestId: id,
                            code
                        });
                    }
                } catch (error) {
                    console.error(error);

                    _pair_x.set(id, {
                        status: 'error',
                        message: 'Could not generate pairing code'
                    });

                    if (!res.headersSent) {
                        res.status(500).json({
                            ok: false,
                            message: 'Pairing code generation failed'
                        });
                    }

                    sessions.delete(id);
                    wa.end(error);
                }
            }

            if (connection === 'open') {
                try {
                    await saveCreds();
                    _pair_x.set(id, {
                        status: 'connected',
                        sessionId: id,
                        message: 'WhatsApp connected successfully'
                    });
                    console.log(id);
                    await wa.sendMessage(wa.user.id, {
                        text:
                            '*ECHO SESSION*\n\n' +
                            'Your session saved\n\n' +
                            `Session ID: ${id}\n\n` +
                            '*Keep this ID private*'
                    });

                } catch (error) {
                    console.error(error);
                }
            }

            if (connection === 'close') {
                const status =
                    lastDisconnect?.error?.output?.statusCode;

                sessions.delete(id);

                if (status === DisconnectReason.loggedOut) {
                    _pair_x.set(id, {
                        status: 'logged_out',
                        sessionId: id,
                        message: 'WhatsApp logged out. Pair again'
                    });
                } else {
                    _pair_x.set(id, {
                        status: 'disconnected',
                        sessionId: id,
                        message: 'Connection disconnected. Saved files retained'
                    });
                }
                console.log(id, status);
            }
        });

    } catch (error) {
        console.error(error);
        if (id) {
            sessions.delete(id);
            _pair_x.set(id, {
                status: 'error',
                message: 'Server error'
            });
        }

        if (!res.headersSent) {
            res.status(500).json({
                ok: false,
                message: 'Pairing service unavailable'
            });
        }
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

    const status = _pair_x.get(id);
    if (!status) {
        return res.status(404).json({
            ok: false,
            message: 'Session not found'
        });
    }

    res.json({
        ok: true,
        status: status.status,
        sessionId: status.sessionId,
        message: status.message
    });
});

app.listen(PORT, () => {
    console.log(`Server running on: ${PORT}`);
});
    
