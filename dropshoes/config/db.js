const mongoose = require('mongoose');

const conectarDB = async () => {
    // Verifique se a variável está chegando aqui dentro
    console.log("Dentro do conectarDB, a URI é:", process.env.MONGODB_URI);

    if (!process.env.MONGODB_URI) {
        throw new Error("A variável MONGODB_URI não foi encontrada!");
    }

    await mongoose.connect(process.env.MONGODB_URI);
};

module.exports = conectarDB;