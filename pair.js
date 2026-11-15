
const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const {
    default: WASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const {
    create
} = require('./Func/session');

const app = express();
const root = process.cwd();
const port = process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function ToMyId(len = 16) {
    let res = '';
    const chars = '0123456789abcdef';

    for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return res;
}

async function rmFile(dir) {
    if (fs.existsSync(dir)) {
        await fs.promises.rm(dir, {
            recursive: true,
            force: true
        });
    }
}

app.get('/pair', async (req, res) => {
    let num = String(req.query.number || '').replace(/[^0-9]/g, '');

    if (!num || num.length < 8 || num.length > 15) {
        return res.status(400).json({
            status: false,
            message: 'Enter a valid phone number'
        });
    }

    const id = ToMyId();
    const dir = path.join(root, 'session', id);

    await fs.promises.mkdir(dir, {
        recursive: true
    });

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(dir);

    let completed = false;

    const logger = pino({
        level: 'fatal'
    });

    const wa = WASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                logger
            )
        },
        logger,
        browser: Browsers.macOS('Safari'),
        downloadHistory: false,
        syncFullHistory: false
    });

    wa.ev.on('creds.update', saveCreds);

    wa.ev.on('connection.update', async (update) => {
        const {
            connection,
            lastDisconnect
        } = update;

        if (connection === 'open' && !completed) {
            completed = true;

            await delay(3000);

            const {
                id: sessionId
            } = await create(dir);

            await wa.sendMessage(wa.user.id, {
                text:
                    '*WhatsApp Connected Successfully!*\n\n' +
                    'Do not share your session ID with anyone.\n\n' +
                    '*Session ID:*\n' + sessionId
            });

            console.log('Session saved:', sessionId);

            await delay(1000);

            await wa.ws.close();
            await rmFile(dir);
        }

        if (connection === 'close' && !completed) {
            const statusCode =
                lastDisconnect?.error?.output?.statusCode;

            console.log('Pairing connection closed:', statusCode);

            if (statusCode === 401) {
                await rmFile(dir);
            }
        }
    });

    await delay(1500);

    const code = await wa.requestPairingCode(num);

    if (!res.headersSent) {
        res.json({
            status: true,
            code,
            message: 'Enter the code in WhatsApp Linked Devices'
        });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
    
