const express = require('express');
const path = require('path');

const pairingRouter = require('./pair');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/pair', pairingRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
