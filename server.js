const express = require('express');
const path = require('path');

const app = express();

const x_pair = require('./pair');

app.use(express.static(path.join(__dirname, 'public')));

app.use('/pair', x_pair);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Running on port ${PORT}`);
});
