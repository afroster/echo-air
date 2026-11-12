require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { parsePhoneNumber } = require('awesome-phonenumber');
const { startPairing, active } = require('./pair');

const app = express();


app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const requests = new Map();
const REQUEST_TIMEOUT = 15 * 60 * 1000;
function createRequest(options, res) {
    const id = crypto.randomUUID();

    const request = {
        id,
        method: options.method,
        status: 'connecting',
        code: null,
        qr: null,
        session_id: null,
        delivered: false,
        error: null,
        createdAt: Date.now()
    };

    requests.set(id, request);

    res.json({ id });

    startPairing({
        id,
        method: options.method,
        number: options.number,
        receiveSession: options.receiveSession
    }, {
        onCode: code => {
            request.code = code;
            request.status = 'waiting';
        },

        onQr: qr => {
            request.qr = qr;
            request.status = 'waiting';
        },

        onConnected: result => {
            request.status = 'connected';
            request.session_id = result.session_id || null;
            request.delivered = result.delivered === true;
        },

        onDisconnect: data => {
            request.status = 'disconnected';
            request.disconnect = data;
        },

        onError: error => {
            request.status = 'error';
            request.error = error;
        }
    }).catch(error => {
        request.status = 'error';
        request.error = error.message;
    });
}

app.post('/api/pair', (req, res) => {
    try {
        const { number, receiveSession = false } = req.body;
        if (typeof number !== 'string' || !number.trim()) {
            return res.status(400).json({
                error: 'WhatsApp number is required'
            });
        }

        if (typeof receiveSession !== 'boolean') {
            return res.status(400).json({
                error: 'Invalid session delivery option'
            });
        }

        const phone = parsePhoneNumber(number.trim());
        if (!phone.valid) {
            return res.status(400).json({
                error: 'Enter a valid phone number with country code'
            });
        }

        createRequest({
            method: 'pair',
            number: phone.number.e164.replace(/\D/g, ''),
            receiveSession
        }, res);

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.post('/api/qr', (req, res) => {
    try {
        const { receiveSession = false } = req.body;

        if (typeof receiveSession !== 'boolean') {
            return res.status(400).json({
                error: 'Invalid session delivery option'
            });
        }

        createRequest({
            method: 'qr',
            receiveSession
        }, res);

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.get('/api/status/:id', (req, res) => {
    const request = requests.get(req.params.id);

    if (!request) {
        return res.status(404).json({
            error: 'Pairing request not found or expired'
        });
    }

    res.json({
        id: request.id,
        method: request.method,
        status: request.status,
        code: request.code,
        qr: request.qr,
        session_id: request.session_id,
        delivered: request.delivered,
        error: request.error
    });
});

app.post('/api/stop/:id', async (req, res) => {
    const request = requests.get(req.params.id);

    if (!request) {
        return res.status(404).json({
            error: 'Pairing request not found'
        });
    }

    const pair = active.get(req.params.id);
    if (pair) {
        await pair.stop();
    }

    request.status = 'stopped';

    res.json({
        success: true,
        message: 'Pairing stopped.'
    });
});

setInterval(() => {
    const now = Date.now();
    for (const [id, request] of requests) {
        if (now - request.createdAt > REQUEST_TIMEOUT) {
            active.get(id)?.stop();
            requests.delete(id);
        }
    }
}, 60000);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
