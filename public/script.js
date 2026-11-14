
const form = document.getElementById('pairForm');
const num_input = document.getElementById('number');
const generateBtn = document.getElementById('generateBtn');

const result = document.getElementById('result');
const pairCode = document.getElementById('pairCode');
const statusBox = document.getElementById('status');

const sessionBox = document.getElementById('sessionBox');
const sessionId = document.getElementById('sessionId');

let currentCode = '';
let currentSession = '';
let polling = false;

async function fetchJSON(url) {
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        console.error('Invalid server response:', text);

        throw new Error(
            `Server returned HTML instead of JSON (${response.status}). Check your backend route.`
        );
    }

    if (!response.ok) {
        throw new Error(data.message || `Server error: ${response.status}`);
    }

    return data;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const number = num_input.value.replace(/\D/g, '');

    if (!number || number.length < 7 || number.length > 15) {
        alert('Enter a valid phone number with country code');
        return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating code...';

    result.style.display = 'block';
    sessionBox.style.display = 'none';

    pairCode.textContent = 'WAIT...';
    statusBox.textContent = 'Connecting to WhatsApp...';
    statusBox.style.color = '#6be0a5';

    currentCode = '';
    currentSession = '';

    try {
        const data = await fetchJSON(
            `/pair?number=${encodeURIComponent(number)}`
        );

        if (!data.ok) {
            throw new Error(data.message || 'Pairing failed');
        }

        if (!data.code || !data.requestId) {
            throw new Error('Invalid pairing response from server');
        }

        currentCode = data.code;
        currentSession = data.requestId;

        pairCode.textContent = data.code;
        statusBox.textContent = 'Waiting for WhatsApp connection...';

        generateBtn.textContent = 'Code generated';
        num_input.disabled = true;

        checkStatus(data.requestId);

    } catch (error) {
        console.error('Pairing error:', error);

        statusBox.textContent = error.message;
        statusBox.style.color = '#ff8181';

        generateBtn.disabled = false;
        generateBtn.textContent = 'Try again →';
    }
});

async function checkStatus(id) {
    let attempts = 0;
    const maxAttempts = 180;

    polling = true;

    async function poll() {
        if (!polling) return;

        if (attempts++ >= maxAttempts) {
            statusBox.textContent = 'Status check timed out. Check your connection.';
            polling = false;
            generateBtn.disabled = false;
            generateBtn.textContent = 'Try again →';
            num_input.disabled = false;
            return;
        }

        try {
            const data = await fetchJSON(
                `/pair-status?id=${encodeURIComponent(id)}`
            );

            if (!data.ok) {
                throw new Error(data.message || 'Status unavailable');
            }

            if (data.status === 'connected') {
                polling = false;

                statusBox.textContent = '✓ Connected successfully';
                statusBox.style.color = '#6be0a5';

                if (data.sessionId) {
                    sessionId.textContent = data.sessionId;
                    sessionBox.style.display = 'block';
                }

                generateBtn.disabled = false;
                generateBtn.textContent = 'Connected ✓';
                return;
            }

            if (
                data.status === 'error' ||
                data.status === 'logged_out' ||
                data.status === 'disconnected'
            ) {
                polling = false;

                statusBox.textContent = data.message || 'Connection failed';
                statusBox.style.color = '#ff8585';

                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate another code →';
                num_input.disabled = false;
                return;
            }

            statusBox.textContent = data.message || 'Waiting for pairing...';

        } catch (error) {
            console.error('Status check error:', error);
            statusBox.textContent = 'Checking connection...';
        }

        if (polling) {
            setTimeout(poll, 2000);
        }
    }

    poll();
}


document.getElementById('copyCode').addEventListener('click', async () => {
    if (!currentCode) return;

    try {
        await navigator.clipboard.writeText(currentCode);
        document.getElementById('copyCode').textContent = 'Copied ✓';
    } catch {
        statusBox.textContent = 'Unable to copy code';
    }
});

document.getElementById('copySession').addEventListener('click', async () => {
    if (!sessionId.textContent) return;

    try {
        await navigator.clipboard.writeText(sessionId.textContent);
        document.getElementById('copySession').textContent = 'Copied ✓';
    } catch {
        statusBox.textContent = 'Unable to copy session ID';
    }
});
                      
