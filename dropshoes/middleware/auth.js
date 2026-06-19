const jwt = require('jsonwebtoken');

// 1. Verifica se o token é válido e decodifica os dados do usuário
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ erro: "Token de acesso não fornecido." });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Agora req.user contém { id, role, permissions }
        next();
    } catch (err) {
        res.status(403).json({ erro: "Token inválido ou expirado." });
    }
};

// 2. Verifica se o usuário é ADMIN (acesso geral)
const ehAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ erro: "Acesso negado: Requer privilégios de administrador." });
    }
};

// 3. NOVA FUNÇÃO: Verifica se o usuário possui uma permissão específica
const temPermissao = (permissao) => {
    return (req, res, next) => {
        if (req.user && req.user.role === 'admin' && req.user.permissions.includes(permissao)) {
            next();
        } else {
            res.status(403).json({ erro: `Acesso negado: Requer permissão '${permissao}'.` });
        }
    };
};

module.exports = { verificarToken, ehAdmin, temPermissao };