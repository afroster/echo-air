
const form = document.getElementById('pairForm');
const number = document.getElementById('number');
const generateBtn = document.getElementById('generateBtn');
const message = document.getElementById('message');
const result = document.getElementById('result');
const pairCode = document.getElementById('pairCode');
const copyBtn = document.getElementById('copyBtn');
const themeBtn = document.getElementById('themeBtn');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone = number.value.replace(/\D/g, '');

    if (phone.length < 8 || phone.length > 15) {
        message.style.display = 'block';
        message.textContent = 'Enter a valid phone number.';
        return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    message.style.display = 'none';
    result.style.display = 'none';

    try {
        const response = await fetch(
            `/pair?number=${encodeURIComponent(phone)}`
        );

        const data = await response.json();

        if (!response.ok || !data.status) {
            throw new Error(data.message || 'Unable to generate code.');
        }

        pairCode.textContent = data.code;
        result.style.display = 'block';

        message.style.display = 'block';
        message.style.color = '#36c98a';
        message.textContent = 'Pairing code generated successfully.';

    } catch (err) {
        message.style.display = 'block';
        message.style.color = '#f07878';
        message.textContent = err.message;
    }

    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate code';
});

copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(pairCode.textContent);

    copyBtn.textContent = 'Copied';

    setTimeout(() => {
        copyBtn.textContent = 'Copy';
    }, 2000);
});

themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');

    themeBtn.textContent =
        document.body.classList.contains('light')
            ? 'Dark mode'
            : 'Light mode';
});
            
