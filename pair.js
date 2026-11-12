const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');
const axios = require('axios');
const QRCode = require('qrcode');
const { parsePhoneNumber } = require('awesome-phonenumber');

const {
    default: makeWASocket,
    Browsers,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const x_url = 'https://api.jsonbin.io/v3/b';
const x_key = '$2a$10$PKR5l2Sy5qLdSI5czPDOauuJJHKMpBwpZjV2fdv.ngWPB5DOTJKwO';
const active = new Map();

class Pair {
    constructor(options = {}, callbacks = {}) {
        this.id = options.id || crypto.randomUUID();
        this.method = options.method || 'pair';
        this.number = options.number || '';
        this.receiveSession = options.receiveSession === true;

        this.authDir = path.join(__dirname, 'sessions', this.id);
        this.callbacks = callbacks;

        this.sock = null;
        this.binId = null;
        this.uploaded = false;
        this.pairingRequested = false;
        this.finished = false;
        this.closed = false;

        this.saving = Promise.resolve();
        this.backupTimer = null;
    }

    emit(name, value) {
        this.callbacks[name]?.(value);
    }

    async upload(data) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': x_key,
                'X-Bin-Private': 'true',
                'X-Bin-Name': `Echo-${this.id}`
            },
            timeout: 30000
        };

        if (this.binId) {
            await axios.put(
                `${x_url}/${this.binId}`,
                data,
                config
            );
        } else {
            const response = await axios.post(
                x_url,
                data,
                config
            );

            this.binId = response.data.metadata.id;
        }

        return `echo~${this.binId}`;
    }

    async getFiles() {
        const files = {};
        const read = dir => {
            for (const item of fs.readdirSync(dir, {
                withFileTypes: true
            })) {
                const file = path.join(dir, item.name);
                if (item.isDirectory()) {
                    read(file);
                } else {
                    const name = path.relative(this.authDir, file);
                    files[name] = fs.readFileSync(file).toString('base64');
                }
            }
        };

        read(this.authDir);
        if (!files['creds.json']) {
            throw new Error('empty');
        }

        return files;
    }

    async saveSession() {
        const task = this.saving.then(async () => {
            const files = await this.getFiles();
            const data = {
                app: 'echo',
                version: 1,
                files,
                updatedAt: new Date().toISOString()
            };

            return this.upload(data);
        });

        this.saving = task.catch(() => {});

        return task;
    }

    async sendSession(session_id) {
        if (!this.sock?.user) {
            throw new Error('not connected');
        }

        await this.sock.sendMessage(this.sock.user.id, {
            text:
                '*ECHO SESSION*\n\n' +
                'Your WhatsApp session is ready\n\n' +
                `\`${session_id}\`\n\n` +
                'Keep this session ID private'
        });
    }

    async finish() {
        if (this.finished) return;
        this.finished = true;

        try { const session_id = await this.saveSession();
            if (this.receiveSession) {
                await this.sendSession(session_id);
                this.emit('onConnected', {
                    delivered: true
                });
            } else {
                this.emit('onConnected', {
                    session_id
                });
            }

            this.uploaded = true;
            console.log(`[${this.id}] session saved`);
            this.startBackup();

        } catch (error) {
            this.finished = false;
            this.emit(error.message);
        }
    }

    startBackup() {
        if (this.backupTimer) return;
        this.backupTimer = setInterval(async () => {
            if (this.closed || !this.uploaded) return;

            try {
                await this.saveSession();
            } catch (error) {
                this.emit(error.message);
            }
        }, 20000);
    }

    async start() {
        if (!x_key) {
            throw new Error('JSONBIN_KEY is missing');
        }

        if (!['pair', 'qr'].includes(this.method)) {
            throw new Error('Invalid connection method');
        }

        if (this.method === 'pair') {
            const phone = parsePhoneNumber(this.number);
            if (!phone.valid) {
                throw new Error('Invalid WhatsApp phone number');
            }

            this.number = phone.number.e164.replace(/\D/g, '');
        }

        fs.mkdirSync(this.authDir, {
            recursive: true
        });

        const { state, saveCreds } =
        await useMultiFileAuthState(this.authDir);
        this.sock = makeWASocket({
            auth: state,
            logger: pino({level: "fatal"}).child({level: "fatal"}),
            browser: Browsers.macOS("Safari"),
            downloadHistory: false,
            syncFullHistory: false
        });

        this.sock.ev.on('creds.update', async () => {
            try {
                await saveCreds();
                if (this.uploaded) {
                    await this.saveSession();
                }
            } catch (error) {
                this.emit(error.message);
            }
        });

        this.sock.ev.on('connection.update', async update => {
            const { connection, qr, lastDisconnect } = update;

            if (qr && this.method === 'qr') {
                try {
                    const image = await QRCode.toDataURL(qr);
                    this.emit('onQr', image);
                } catch (error) {
                    this.emit(error.message);
                }
            }

            if (
                connection === 'connecting' &&
                this.method === 'pair' &&
                !state.creds.registered &&
                !this.pairingRequested
            ) {
                this.pairingRequested = true;

                try {
                    const code = await this.sock.requestPairingCode(
                        this.number
                    );

                    this.emit('onCode', code);
                } catch (error) {
                    this.pairingRequested = false;
                    this.emit(error.message);
                }
            }

            if (connection === 'open') {
                try {
                    await saveCreds();
                    await this.finish();
                } catch (error) {
                    this.emit(error.message);
                }
            }

            if (connection === 'close') {
                const status =
                    lastDisconnect?.error?.output?.statusCode;

                if (this.backupTimer) {
                    clearInterval(this.backupTimer);
                    this.backupTimer = null;
                }

                if (status === DisconnectReason.loggedOut) {
                    this.emit('onError', 'WhatsApp logged out');
                } else {
                    this.emit('onDisconnect', {
                        status,
                        reconnect: true
                    });
                }
            }
        });

        return this.sock;
    }

    async stop() {
        this.closed = true;

        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = null;
        }

        try {
            this.sock?.end(undefined);
        } catch {}

        active.delete(this.id);
    }
}

async function startPairing(options = {}, callbacks = {}) {
    const id = options.id || crypto.randomUUID();
    const pair = new Pair({
        ...options,
        id
    }, callbacks);

    active.set(id, pair);
    try {
        await pair.start();
        return {
            id,
            sock: pair.sock
        };
    } catch (error) {
        active.delete(id);
        throw error;
    }
}

module.exports = {
    startPairing,
    active
};
