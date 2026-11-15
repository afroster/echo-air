const express = require('express');
const path = require('path');

const pairingRouter = require('./pair');
const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/pair', pairingRouter);

app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});
