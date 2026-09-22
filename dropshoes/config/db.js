const mongoose = require('mongoose');

const conectarDB = async () => {

    if (!process.env.MONGODB_URI) {
        throw new Error("A variável MONGODB_URI não foi encontrada!");
    }

    await mongoose.connect(process.env.MONGODB_URI);
};

module.exports = conectarDB;