
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const sessionPath = path.join(root, 'sessions');

async function create(source) {
    await fs.promises.mkdir(sessionPath, {
        recursive: true
    });

    const id = 'echo~' + crypto.randomBytes(8).toString('hex');
    const destination = path.join(sessionPath, id);

    await fs.promises.cp(source, destination, {
        recursive: true
    });

    return { id };
}

async function get(id) {
    if (!/^echo~[a-f0-9]{16}$/.test(id)) {
        throw new Error('Invalid session ID');
    }

    const dir = path.join(sessionPath, id);

    if (!fs.existsSync(dir)) {
        throw new Error('Session not found');
    }

    return {
        content: dir
    };
}

module.exports = {
    create,
    get
};

