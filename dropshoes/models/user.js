const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, required: false, lowercase: true, trim: true },
    senha: { type: String, required: false },
    // Alterado para required: false para permitir pacientes sem telefone inicial
    telefone: {
        type: String,
        required: false, 
        unique: true,
        sparse: true // Permite múltiplos documentos sem telefone (ou nulos)
    },
    role: {
        type: String,
        enum: ['cliente', 'paciente', 'admin'],
        default: 'cliente'
    },
    permissions: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);