const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { lerCookie, opcoesCookie } = require('../middleware/seguranca');
const telefoneValido = valor => typeof valor === 'string' && /^(?:55)?\d{10,11}$/.test(valor.replace(/[\s()+-]/g, ''));
function criarVisitantes({ db, secret, autenticar }) {
  function sessao(req) {
    try { return jwt.verify(lerCookie(req, 'lucy_visitante') || '', secret, { algorithms: ['HS256'], audience: 'lucy:visitante' }).id; } catch { return null; }
  }
  async function registrar(req, res) {
    if (!db || !secret) return res.status(503).json({ erro: 'Cadastro indisponível no momento.' });
    const { nome, telefone, cep } = req.body || {};
    if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 100 || !telefoneValido(telefone) || typeof cep !== 'string' || !/^\d{5}-?\d{3}$/.test(cep.trim())) return res.status(400).json({ erro: 'Informe nome, telefone com DDD e CEP válido.' });
    const id = sessao(req) || randomUUID();
    const valores = { nome: nome.trim(), telefone: telefone.replace(/\D/g, ''), cep: cep.replace(/\D/g, '') };
    // O telefone nunca serve para localizar ou assumir a sessão de outra pessoa.
    const { data: atual, error: buscaErro } = await db.from('clientes_visitantes').select('id').eq('id', id).maybeSingle();
    if (buscaErro) return res.status(503).json({ erro: 'Não foi possível salvar seus dados.' });
    const query = atual ? db.from('clientes_visitantes').update(valores).eq('id', id) : db.from('clientes_visitantes').insert([{ id, ...valores }]);
    const { error } = await query.select('id').single();
    if (error) return res.status(503).json({ erro: 'Não foi possível salvar seus dados.' });
    const token = jwt.sign({ id }, secret, { algorithm: 'HS256', audience: 'lucy:visitante', expiresIn: '30d' });
    res.cookie('lucy_visitante', token, { ...opcoesCookie(), maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.status(201).json({ perfil: { ...valores, role: 'visitante' } });
  }
  async function autenticarCompra(req, res, next) {
    if (req.headers.authorization || lerCookie(req, 'lucy_sessao')) return autenticar(req, res, next);
    const id = sessao(req);
    if (!id) return res.status(401).json({ erro: 'Preencha seus dados para continuar.' });
    if (!db) return res.status(503).json({ erro: 'Serviço indisponível.' });
    const { data, error } = await db.from('clientes_visitantes').select('id,nome,telefone,cep').eq('id', id).maybeSingle();
    if (error) return res.status(503).json({ erro: 'Serviço indisponível.' });
    if (!data) return res.status(401).json({ erro: 'Preencha seus dados para continuar.' });
    req.user = { id, role: 'visitante' }; req.visitante = data; next();
  }
  return { registrar, autenticarCompra };
}
function pedidosDoComprador(query, user) { return query.eq(user.role === 'visitante' ? 'visitante_id' : 'usuario_id', user.id); }
module.exports = { criarVisitantes, pedidosDoComprador, telefoneValido };
