// middlewares/auth.js

const verificarToken = (req, res, next) => {
    console.log("Middleware de autenticação chamado");
    next();
};

const ehAdmin = (req, res, next) => {
    console.log("Middleware de admin chamado");
    next();
};

// Adicione esta função para resolver o erro
const temPermissao = (permissao) => {
    return (req, res, next) => {
        console.log(`Verificando permissão: ${permissao}`);
        // Aqui você adicionaria sua lógica de validação real
        next();
    };
};

// Exporte a nova função junto com as outras
module.exports = { verificarToken, ehAdmin, temPermissao };