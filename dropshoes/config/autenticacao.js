const { opcoesCookie, lerCookie } = require('../middleware/seguranca');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('jsonwebtoken');
const scrypt = promisify(scryptCallback);
const ROLES = ['cliente', 'admin1', 'admin2'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(senha, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verificarSenha(senha, armazenada) {
  if (typeof armazenada !== 'string') return false;
  if (armazenada.startsWith('scrypt$')) {
    const partes = armazenada.split('$');
    if (partes.length !== 3 || !/^[a-f0-9]{32}$/.test(partes[1]) || !/^[a-f0-9]{128}$/.test(partes[2])) return false;
    return timingSafeEqual(await scrypt(senha, partes[1], 64), Buffer.from(partes[2], 'hex'));
  }
  // Compatibilidade temporária: contas antigas são migradas após autenticação.
  const digest = valor => createHash('sha256').update(valor).digest();
  return timingSafeEqual(digest(senha), digest(armazenada));
}

function criarAutenticacao({ db, secret }) {
  const indisponivel = res => res.status(503).json({ erro: 'Não foi possível acessar sua conta agora. Tente novamente em instantes.' });
  const invalido = res => res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  const pronto = () => db && secret;
  const cadastroIndisponivel = (res, erro) => {
    // Registra somente o código técnico, nunca dados de clientes ou credenciais.
    if (erro?.code) console.error('[cadastro] Falha ao gravar perfil:', erro.code);
    return res.status(503).json({ erro: 'Não foi possível criar seu perfil agora. Tente novamente em instantes.' });
  };

  async function cadastro(req, res) {
    if (!pronto()) return cadastroIndisponivel(res);
    const { nome, email, telefone = '', senha } = req.body || {};
    if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 100 ||
        typeof email !== 'string' || email.trim().length > 254 || !EMAIL.test(email.trim()) ||
        typeof senha !== 'string' || senha.length < 8 || senha.length > 128 ||
        typeof telefone !== 'string' || (telefone && !/^[\d\s()+-]{10,30}$/.test(telefone))) {
      return res.status(400).json({ erro: 'Informe nome, e-mail válido, telefone válido (se preenchido) e senha de 8 a 128 caracteres.' });
    }
    try {
      const emailNormalizado = email.trim().toLowerCase();
      const { data: existente, error: consultaErro } = await db.from('profiles').select('id').eq('email', emailNormalizado).maybeSingle();
      if (consultaErro) return cadastroIndisponivel(res, consultaErro);
      if (existente) return res.status(409).json({ erro: 'Este e-mail já está cadastrado. Faça login.' });
      // Lista explícita de campos: nenhum cargo ou metadado do cliente é aceito.
      const { data, error } = await db.from('profiles').insert([{
        nome: nome.trim(), email: emailNormalizado, telefone: telefone.trim() || null,
        senha: await hashSenha(senha), role: 'cliente'
      }]).select('id,nome,email,role').single();
      if (error?.code === '23505') return res.status(409).json({ erro: 'Este e-mail já está cadastrado. Faça login.' });
      if (error || !data) return cadastroIndisponivel(res, error);
      return res.status(201).json({ mensagem: 'Cadastro realizado. Entre com seu e-mail e senha.', usuario: data });
    } catch (erro) { return cadastroIndisponivel(res, erro); }
  }

  async function login(req, res) {
    if (!pronto()) return indisponivel(res);
    const { identificador, senha, acesso = 'cliente' } = req.body || {};
    if (typeof identificador !== 'string' || identificador.length > 254 || !EMAIL.test(identificador.trim()) ||
        typeof senha !== 'string' || !senha || senha.length > 128 || !['cliente', 'admin'].includes(acesso)) {
      return res.status(400).json({ erro: 'Informe e-mail e senha válidos.' });
    }
    try {
      const { data: usuario, error } = await db.from('profiles').select('id,nome,email,senha,role').eq('email', identificador.trim().toLowerCase()).maybeSingle();
      if (error) return indisponivel(res);
      if (!usuario || !ROLES.includes(usuario.role) || !(await verificarSenha(senha, usuario.senha))) return invalido(res);
      if ((acesso === 'admin') !== ['admin1', 'admin2'].includes(usuario.role)) {
        return res.status(403).json({ erro: acesso === 'admin' ? 'Esta conta não tem acesso administrativo. Use a entrada de clientes.' : 'Use a entrada de administradores para acessar esta conta.' });
      }
      if (!usuario.senha.startsWith('scrypt$')) {
        const { data: atualizada, error: migracaoErro } = await db.from('profiles').update({ senha: await hashSenha(senha) }).eq('id', usuario.id).eq('senha', usuario.senha).select('id').maybeSingle();
        if (migracaoErro || !atualizada) return indisponivel(res);
      }
      const token = jwt.sign({ id: usuario.id, role: usuario.role }, secret, { algorithm: 'HS256', expiresIn: '8h' });
      if (req.headers?.['x-session-mode'] === 'cookie') {
        res.cookie('lucy_sessao', token, { ...opcoesCookie(), maxAge: 8 * 60 * 60 * 1000 });
        return res.json({ role: usuario.role, nome: usuario.nome });
      }
      return res.json({ token, role: usuario.role, nome: usuario.nome });
    } catch { return indisponivel(res); }
  }

  async function autenticar(req, res, next) {
    if (!pronto()) return indisponivel(res);
    let payload;
    try {
      const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      payload = jwt.verify(match?.[1] || lerCookie(req, 'lucy_sessao') || '', secret, { algorithms: ['HS256'] });
      if (payload.aud || !payload.id) throw new Error('Sessão inválida');
    } catch { return res.status(401).json({ erro: 'Sua sessão terminou. Entre novamente.' }); }
    try {
      const { data, error } = await db.from('profiles').select('id,role').eq('id', payload.id).maybeSingle();
      if (error) return indisponivel(res);
      if (!data || !ROLES.includes(data.role)) return res.status(401).json({ erro: 'Sua sessão terminou. Entre novamente.' });
      req.user = data;
      return next();
    } catch { return indisponivel(res); }
  }
  return { cadastro, login, autenticar };
}

module.exports = { criarAutenticacao, hashSenha, verificarSenha };
