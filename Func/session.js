const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function createSession() {
    const id = 'echo~' + crypto.randomBytes(48).toString('hex');
    const creds_x = path.join(
        process.cwd(),
        'session',
        id
    );

    await fs.promises.mkdir(creds_x, {
        recursive: true
    });

    return {
        id,
        creds_x
    };
}

module.exports = { createSession };
