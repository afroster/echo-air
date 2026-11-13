const $ = id => document.getElementById(id);
const receiveSession = $('receiveSession');
let requestId = null;
let currentMethod = null;
let currentValue = '';
let pollTimer = null;
let polling = false;

receiveSession.addEventListener('change', () => {
    const enabled = receiveSession.checked;

    $('sessionNotice').classList.toggle('success', enabled);
    $('sessionNotice').classList.toggle('warning', !enabled);

    $('sessionNotice').querySelector('.notice-icon').textContent =
        enabled ? '✓' : '!';

    $('noticeText').textContent = enabled
        ? 'Your session ID will be sent to your WhatsApp number after successful connection.'
        : 'You will not receive the session ID on WhatsApp, so copy it from here.';
});

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    $(pageId).classList.add('active');
}

function stopPolling() {
    polling = false;

    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function resetRequest(stopBackend = true) {
    stopPolling();

    if (stopBackend && requestId) {
        fetch('/api/stop/' + encodeURIComponent(requestId), {
            method: 'POST'
        }).catch(() => {});
    }

    requestId = null;
    currentValue = '';
    currentMethod = null;

    $('codeBox').style.display = 'none';
    $('qrBox').style.display = 'none';

    $('codeValue').textContent = '';
    $('qrSessionValue').textContent = '';
    $('qrImage').removeAttribute('src');
    $('qrImage').style.display = 'block';
    $('qrSessionValue').style.display = 'none';
    $('qrCopyBtn').style.display = 'none';

    $('generateBtn').disabled = false;
    $('generateBtn').textContent = 'Generate Pairing Code';
}

function openPairing() {
    resetRequest();
    showPage('pairPage');
    $('status').textContent = 'Your pairing code will appear here.';
}

function openQR() {
    resetRequest();
    showPage('qrPage');
    startQR();
}

function goHome() {
    resetRequest();
    showPage('homePage');
}

async function createRequest(endpoint, payload) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Unable to start connection');
    }

    if (!result.id) {
        throw new Error('Server did not return a request ID');
    }

    requestId = result.id;
    polling = true;

    checkStatus();

    return result;
}

function normalizePhoneNumber(value) {
    return value.trim().replace(/[\s\-().]/g, '');
}

function validPhoneFormat(value) {
    return /^\+?[0-9]{7,15}$/.test(value);
}

async function startPairing() {
    if (polling) return;

    const phone = normalizePhoneNumber($('phone').value);
    const status = $('status');

    if (!phone) {
        status.textContent = 'Please enter your WhatsApp phone number.';
        return;
    }

    if (!validPhoneFormat(phone)) {
        status.textContent =
            'Invalid number format. Include your country code, e.g. +263771234567.';
        return;
    }

    resetRequest();
    currentMethod = 'pair';

    $('generateBtn').disabled = true;
    $('generateBtn').textContent = 'Generating...';

    status.textContent = 'Starting WhatsApp connection...';

    try {
        await createRequest('/api/pair', {
            number: phone,
            receiveSession: receiveSession.checked
        });
    } catch (error) {
        status.textContent = error.message;
        $('generateBtn').disabled = false;
        $('generateBtn').textContent = 'Generate Pairing Code';
    }
}

async function startQR() {
    if (polling) return;

    currentMethod = 'qr';
    $('qrStatus').textContent = 'Starting QR connection...';

    try {
        await createRequest('/api/qr', {
            receiveSession: receiveSession.checked
        });
    } catch (error) {
        $('qrStatus').textContent = error.message;
        stopPolling();
    }
}

async function checkStatus() {
    if (!requestId || !polling) return;

    const id = requestId;

    try {
        const response = await fetch(
            '/api/status/' + encodeURIComponent(id)
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Unable to retrieve connection status');
        }

        if (id !== requestId) return;

        if (currentMethod === 'pair') {
            handlePairStatus(data);
        } else {
            handleQRStatus(data);
        }

        if (['connected', 'error', 'stopped', 'disconnected'].includes(data.status)) {
            if (data.status === 'error') {
                showError(data.error || 'Connection failed');
            }

            if (data.status === 'disconnected') {
                showError('WhatsApp disconnected. Please try again.');
            }

            stopPolling();

            $('generateBtn').disabled = false;
            $('generateBtn').textContent = 'Generate Pairing Code';

            return;
        }

        pollTimer = setTimeout(checkStatus, 1200);

    } catch (error) {
        if (id !== requestId) return;

        showError(error.message);
        stopPolling();

        $('generateBtn').disabled = false;
        $('generateBtn').textContent = 'Generate Pairing Code';
    }
}

function showError(message) {
    if (currentMethod === 'pair') {
        $('status').textContent = message;
    } else {
        $('qrStatus').textContent = message;
    }
}

function handlePairStatus(data) {
    
    if (data.code) {
        currentValue = data.code;

        $('codeTitle').textContent = 'YOUR PAIRING CODE';
        $('codeValue').textContent = data.code;
        $('copyBtn').textContent = 'Copy Pairing Code';

        $('codeBox').style.display = 'block';

        $('status').textContent =
            'Pairing code generated. Enter it in WhatsApp Linked Devices.';

        return;
    }

    if (data.status === 'connected') {
        $('codeBox').style.display = 'block';

        const sessionId = data.sessionId || data.session_id;

        if (sessionId) {
            currentValue = sessionId;

            $('codeTitle').textContent = 'YOUR SESSION ID';
            $('codeValue').textContent = sessionId;
            $('copyBtn').textContent = 'Copy Session ID';
            $('copyBtn').style.display = 'block';

            $('status').textContent = 'WhatsApp connected successfully!';
        } else if (data.delivered) {
            currentValue = '';

            $('codeTitle').textContent = 'SESSION SENT';
            $('codeValue').textContent = 'Successfully sent to WhatsApp';
            $('copyBtn').style.display = 'none';

            $('status').textContent = 'Check your WhatsApp messages.';
        } else {
            $('status').textContent = 'WhatsApp connected successfully.';
            $('codeBox').style.display = 'none';
        }

        return;
    }

    if (data.status === 'connecting') {
        $('status').textContent = 'Connecting to WhatsApp...';
    } else if (data.status === 'waiting') {
        $('status').textContent = 'Waiting for pairing code...';
    }
}

function handleQRStatus(data) {
    if (data.qr) {
        $('qrImage').src = data.qr;
        $('qrImage').style.display = 'block';
        $('qrSessionValue').style.display = 'none';
        $('qrCopyBtn').style.display = 'none';
        $('qrTitle').textContent = 'SCAN THIS QR CODE';
        $('qrBox').style.display = 'block';

        $('qrStatus').textContent =
            'Open WhatsApp, select Linked Devices, and scan this QR code.';
    }

    if (data.status === 'connected') {
        const sessionId = data.sessionId || data.session_id;

        if (data.delivered) {
            $('qrBox').style.display = 'none';
            $('qrStatus').textContent =
                'Connected successfully. Your session was sent to WhatsApp.';
        } else if (sessionId) {
            currentValue = sessionId;

            $('qrImage').style.display = 'none';
            $('qrTitle').textContent = 'YOUR SESSION ID';
            $('qrSessionValue').textContent = sessionId;
            $('qrSessionValue').style.display = 'block';
            $('qrCopyBtn').style.display = 'block';
            $('qrBox').style.display = 'block';

            $('qrStatus').textContent = 'WhatsApp connected successfully.';
        }
    } else if (data.status === 'connecting') {
        $('qrStatus').textContent = 'Connecting to WhatsApp...';
    }
}

async function copyResult() {
    if (!currentValue) return;

    try {
        await navigator.clipboard.writeText(currentValue);
    } catch {
        const input = document.createElement('textarea');
        input.value = currentValue;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
    }

    const button = currentMethod === 'pair'
        ? $('copyBtn')
        : $('qrCopyBtn');

    const original = button.textContent;
    button.textContent = 'Copied ✓';

    setTimeout(() => {
        button.textContent = original;
    }, 1800);
}

$('qrMethod').addEventListener('click', openQR);
$('pairMethod').addEventListener('click', openPairing);
$('pairBack').addEventListener('click', goHome);
$('qrBack').addEventListener('click', goHome);
$('generateBtn').addEventListener('click', startPairing);
$('copyBtn').addEventListener('click', copyResult);
$('qrCopyBtn').addEventListener('click', copyResult);
