const helmet = require('helmet');
function validarProducao(secret, env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('Produção exige JWT_SECRET com pelo menos 32 bytes aleatórios.');
  let origem;
  try { origem = new URL(env.PUBLIC_BASE_URL); } catch { throw new Error('Produção exige PUBLIC_BASE_URL com a origem HTTPS do site.'); }
  if (origem.protocol !== 'https:' || origem.username || origem.password || origem.pathname !== '/' || origem.search || origem.hash) throw new Error('PUBLIC_BASE_URL deve conter somente a origem HTTPS do site.');
  if (!/^\d+$/.test(String(env.TRUST_PROXY_HOPS || '0'))) throw new Error('TRUST_PROXY_HOPS deve ser um inteiro não negativo.');
}
function origemPublica(env = process.env) {
  try { return env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).origin : null; } catch { return null; }
}
function configurarCors(res, origem) {
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Origin', origem);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Mode');
}
function protecoes(app, env = process.env) {
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'https:', 'data:'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"],
      frameAncestors: ["'none'"], formAction: ["'self'"],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null
    } },
    strictTransportSecurity: env.NODE_ENV === 'production' ? undefined : false,
    referrerPolicy: { policy: 'no-referrer' }
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.on('finish', () => {
      if ([401, 403, 429].includes(res.statusCode)) console.warn(JSON.stringify({ evento: 'acesso_negado', status: res.statusCode, metodo: req.method, rota: req.route?.path || 'api' }));
    });
    const origem = req.get('origin');
    const permitida = origem ? origemPermitida(origem, req, env) : false;
    if (origem && permitida) configurarCors(res, origem);
    if (req.method === 'OPTIONS') {
      if (origem && !permitida) return res.status(403).json({ erro: 'Origem não permitida.' });
      return res.sendStatus(204);
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site' || (origem && !permitida)) return res.status(403).json({ erro: 'Origem não permitida.' });
      const multipartImagem = req.is('multipart/form-data') && /^\/admin\/produtos\/[^/]+\/imagem$/.test(req.path);
      if ((Number(req.get('content-length')) > 0 || req.get('transfer-encoding')) && !req.is('application/json') && !multipartImagem) return res.status(415).json({ erro: 'Envie os dados em JSON.' });
    }
    next();
  });
}
const opcoesCookie = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
function lerCookie(req, nome) {
  const item = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${nome}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(nome.length + 1)); } catch { return null; }
}
function origemPermitida(origem, req, env = process.env) {
  let recebida;
  try { recebida = new URL(origem); } catch { return false; }
  const publica = origemPublica(env);
  // Em produção, a origem canônica é configurada explicitamente. Não dependa
  // de req.protocol: atrás do proxy da Vercel ele pode ser HTTP internamente.
  if (env.NODE_ENV === 'production') return Boolean(publica) && recebida.origin === publica;
  let atual;
  try { atual = new URL(`${req.protocol}://${req.get('host')}`); } catch { return false; }
  if (recebida.origin === atual.origin || (publica && recebida.origin === publica)) return true;
  if (env.NODE_ENV !== 'production') {
    const loopback = ['localhost', '127.0.0.1', '::1'];
    return loopback.includes(recebida.hostname) && loopback.includes(atual.hostname);
  }
  return false;
}
module.exports = { protecoes, opcoesCookie, lerCookie, validarProducao, origemPermitida, origemPublica };
