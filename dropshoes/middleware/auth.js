const { criarAutenticacao } = require('../config/autenticacao');
const { criarClienteSupabase } = require('../config/supabase');

// Compatibilidade com módulos antigos, usando a mesma verificação de perfil da API.
const verificarToken = (req, res, next) => criarAutenticacao({
  db: criarClienteSupabase(), secret: process.env.JWT_SECRET
}).autenticar(req, res, next);
const ehAdmin = (req, res, next) => ['admin1', 'admin2'].includes(req.user?.role)
  ? next() : res.status(403).json({ erro: 'Acesso exclusivo da administração.' });
const temPermissao = permissao => (req, res, next) => {
  if (req.user?.role === 'admin1' || (req.user?.role === 'admin2' && permissao === 'produtos')) return next();
  return res.status(403).json({ erro: 'Acesso não permitido.' });
};
module.exports = { verificarToken, ehAdmin, temPermissao };
