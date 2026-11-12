
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pino = require('pino');
const axios = require('axios');
const QRCode = require('qrcode');
const { parsePhoneNumber } = require('awesome-phonenumber');

const JSONBIN_URL = 'https://api.jsonbin.io/v3/b';
const JSONBIN_KEY = '$2a$10$PKR5l2Sy5qLdSI5czPDOauuJJHKMpBwpZjV2fdv.ngWPB5DOTJKwO';

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
        this.finished = false;
        this.closed = false;

        this.pairingRequested = false;
        this.requestingCode = false;
        this.codeAttempts = 0;

        this.codeTimer = null;
        this.backupTimer = null;

        this.saving = Promise.resolve();
    }

    emit(name, value) {
        if (typeof this.callbacks[name] === 'function') {
            this.callbacks[name](value);
        }
    }

    async upload(data) {
        const config = {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_KEY,
                'X-Bin-Private': 'true',
                'X-Bin-Name': `Echo-${this.id}`
            },
            timeout: 30000
        };

        if (this.binId) {
            await axios.put(
                `${JSONBIN_URL}/${this.binId}`,
                data,
                config
            );
        } else {
            const response = await axios.post(
                JSONBIN_URL,
                data,
                config
            );

            this.binId = response.data.metadata.id;
        }

        return `echo~${this.binId}`;
    }

    async getFiles() {
        const files = {};

        const readDirectory = directory => {
            for (const item of fs.readdirSync(directory, {
                withFileTypes: true
            })) {
                const filePath = path.join(directory, item.name);

                if (item.isDirectory()) {
                    readDirectory(filePath);
                    continue;
                }

                const fileName = path.relative(this.authDir, filePath);

                files[fileName] = fs.readFileSync(filePath).toString('base64');
            }
        };

        readDirectory(this.authDir);

        if (!files['creds.json']) {
            throw new Error('WhatsApp credentials not found');
        }

        return files;
    }

    async saveSession() {
        const task = this.saving.then(async () => {
            const files = await this.getFiles();

            return this.upload({
                app: 'echo',
                version: 1,
                files,
                updatedAt: new Date().toISOString()
            });
        });

        this.saving = task.catch(() => {});

        return task;
    }

    async sendSession(sessionId) {
        if (!this.sock?.user) {
            throw new Error('WhatsApp connection is not ready');
        }

        await this.sock.sendMessage(this.sock.user.id, {
            text:
                '*ECHO SESSION*\n\n' +
                'Your WhatsApp session is ready.\n\n' +
                `\`${sessionId}\`\n\n` +
                'Keep this session ID private.'
        });
    }

    async finish() {
        if (this.finished || this.closed) return;

        this.finished = true;

        try {
            const sessionId = await this.saveSession();

            if (this.receiveSession) {
                await this.sendSession(sessionId);

                this.emit('onConnected', {
                    delivered: true
                });
            } else {
                this.emit('onConnected', {
                    sessionId
                });
            }

            this.uploaded = true;

            console.log(`[${this.id}] Session saved successfully`);

            this.startBackup();

        } catch (error) {
            this.finished = false;
            this.emit('onError', error.message);
        }
    }

    startBackup() {
        if (this.backupTimer) return;

        this.backupTimer = setInterval(async () => {
            if (this.closed || !this.uploaded) return;

            try {
                await this.saveSession();
            } catch (error) {
                this.emit('onError', error.message);
            }
        }, 20000);
    }

    async requestCode() {
        if (
            this.method !== 'pair' ||
            this.pairingRequested ||
            this.requestingCode ||
            this.closed ||
            !this.sock
        ) {
            return;
        }

        this.requestingCode = true;

        try {
            const code = await this.sock.requestPairingCode(this.number);

            this.pairingRequested = true;

            if (this.codeTimer) {
                clearInterval(this.codeTimer);
                this.codeTimer = null;
            }

            console.log(`[${this.id}] Pairing code generated`);

            this.emit('onCode', code);

        } catch (error) {
            this.codeAttempts++;

            console.log(
                `[${this.id}] Pairing attempt ${this.codeAttempts}: ${error.message}`
            );

            if (this.codeAttempts >= 15) {
                if (this.codeTimer) {
                    clearInterval(this.codeTimer);
                    this.codeTimer = null;
                }

                this.emit('onError', 'Unable to generate pairing code. Please try again.');
            }

        } finally {
            this.requestingCode = false;
        }
    }

    async start() {
        if (!JSONBIN_KEY) {
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
       const baileys = await import('@whiskeysockets/baileys');

        const makeWASocket = baileys.default;
        const {
            Browsers,
            useMultiFileAuthState,
            DisconnectReason
        } = baileys;

        const { state, saveCreds } = await useMultiFileAuthState(
            this.authDir
        );

        this.sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'fatal' }),
            browser: Browsers.macOS('Safari'),
            syncFullHistory: false,
            downloadHistory: false
        });

        this.sock.ev.on('creds.update', async () => {
            try {
                await saveCreds();

                if (this.uploaded) {
                    await this.saveSession();
                }
            } catch (error) {
                this.emit('onError', error.message);
            }
        });

        this.sock.ev.on('connection.update', async update => {
            const { connection, qr, lastDisconnect } = update;

            if (this.closed) return;

            if (qr && this.method === 'qr') {
                try {
                    const image = await QRCode.toDataURL(qr);
                    this.emit('onQr', image);
                } catch (error) {
                    this.emit('onError', error.message);
                }
            }

            if (
                connection === 'connecting' &&
                this.method === 'pair' &&
                !state.creds.registered
            ) {
                await this.requestCode();
            }

            if (connection === 'open') {
                try {
                    await saveCreds();
                    await this.finish();
                } catch (error) {
                    this.emit('onError', error.message);
                }
            }

            if (connection === 'close') {
                const status = lastDisconnect?.error?.output?.statusCode;

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

            if (this.method === 'pair' && !state.creds.registered) {
            this.codeTimer = setInterval(() => {
                this.requestCode();
            }, 1500);
        }

        return this.sock;
    }

    async stop() {
        this.closed = true;

        if (this.codeTimer) {
            clearInterval(this.codeTimer);
            this.codeTimer = null;
        }

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
            
