const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const Busboy = require('busboy');
const sharp = require('sharp');
const crypto = require('crypto');
const { criarClienteSupabase } = require('./config/supabase');
const { limitarAutenticacao } = require('./middleware/limite-autenticacao');
const { protecoes, opcoesCookie, validarProducao } = require('./middleware/seguranca');
const { criarAutenticacao } = require('./config/autenticacao');

const { criarPagamentos, urlCheckoutValida } = require('./services/pagamentos');
const { criarInfinitePay } = require('./services/infinitepay');
const { criarVisitantes, pedidosDoComprador, telefoneValido } = require('./services/visitantes');
const { criarEntrega, normalizarBairro } = require('./services/entrega');

function criarApp({ db, secret = process.env.JWT_SECRET, pagamentoCliente, pagamentos: pagamentosTeste, entrega: entregaTeste, storage: storageTeste } = {}) {
validarProducao(secret);
const app = express();
const JWT_SECRET = secret;
const supabase = db || criarClienteSupabase();
const { cadastro, login, autenticar } = criarAutenticacao({ db: supabase, secret: JWT_SECRET });
const { registrar: registrarVisitante, autenticarCompra, autenticarOuCriarCompra } = criarVisitantes({ db: supabase, secret: JWT_SECRET, autenticar });
if (!supabase) console.warn('Configure SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY) para habilitar login e cadastro seguros.');
const ADMIN_ROLES = ['admin1', 'admin2'];
const ORDER_STATUSES = ['pendente', 'aceito', 'em_preparo', 'pronto_entrega', 'recebido', 'cancelado'];
const dataIsoValida = valor => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor;
protecoes(app);
app.use(express.json({ limit: '100kb' }));
// Configure somente a quantidade real de proxies controlados da hospedagem.
const proxies = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxies) && proxies > 0) app.set('trust proxy', proxies);
const limiteAuth = limitarAutenticacao();
const limitePedidos = limitarAutenticacao({ maximo: 20, janela: 15 * 60 * 1000 });
const limiteEntrega = limitarAutenticacao({ maximo: 60, janela: 60 * 1000 });
app.use('/api', (req, res, next) => {
  if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ erro: 'Dados inválidos.' });
  next();
});

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Express 4 precisa encaminhar rejeições assíncronas ao middleware de erro.
const rota = (metodo, url, ...handlers) => app[metodo](url, ...handlers.map(handler =>
  (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next)));


const soAdmin = (req, res, next) => ADMIN_ROLES.includes(req.user.role) ? next() : res.status(403).json({ erro: 'Acesso exclusivo da administração.' });
const soAdmin1 = (req, res, next) => req.user.role === 'admin1' ? next() : res.status(403).json({ erro: 'O fluxo de caixa é acessível somente pelo Admin 1 (dono geral).' });
const IMAGENS_BUCKET = String(process.env.SUPABASE_PRODUCT_IMAGE_BUCKET || 'produtos').trim() || 'produtos';
const IMAGEM_MAX_BYTES = 10 * 1024 * 1024;
const IMAGENS_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const armazenamentoImagens = storageTeste || supabase?.storage;
const erroImagem = (mensagem, status = 400) => Object.assign(new Error(mensagem), { status });
function lerImagemMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: IMAGEM_MAX_BYTES } }); }
    catch { return reject(erroImagem('Formato de envio de imagem inválido.')); }
    let arquivo = null;
    let arquivoExcedeuLimite = false;
    let recebeuOutroArquivo = false;
    parser.on('file', (_campo, stream, info) => {
      if (arquivo) recebeuOutroArquivo = true;
      const partes = [];
      let tamanho = 0;
      arquivo = { mime: info.mimeType, nome: info.filename, stream };
      stream.on('data', parte => { tamanho += parte.length; partes.push(parte); });
      stream.on('limit', () => { arquivoExcedeuLimite = true; });
      stream.on('end', () => { arquivo.buffer = Buffer.concat(partes); arquivo.tamanho = tamanho; });
    });
    parser.on('error', () => reject(erroImagem('Não foi possível ler a imagem enviada.')));
    parser.on('finish', () => {
      if (arquivoExcedeuLimite || (arquivo && arquivo.tamanho > IMAGEM_MAX_BYTES)) return reject(erroImagem('Essa imagem é muito grande. Escolha uma imagem de até 10 MB.', 413));
      if (recebeuOutroArquivo) return reject(erroImagem('Envie somente uma imagem por vez.'));
      if (!arquivo || !arquivo.buffer?.length) return reject(erroImagem('Escolha uma imagem para enviar.'));
      if (!IMAGENS_MIMES.has(String(arquivo.mime).toLowerCase())) return reject(erroImagem('Formato de imagem não suportado. Use JPG, PNG ou WebP.'));
      resolve(arquivo);
    });
    req.pipe(parser);
  });
}
async function prepararImagem(buffer, mime) {
  try {
    return await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  } catch { throw erroImagem('Não foi possível processar essa imagem.'); }
}
function caminhoStorage(url) {
  if (typeof url !== 'string' || !url) return null;
  const prefixo = `/storage/v1/object/public/${IMAGENS_BUCKET}/`;
  try {
    const urlObj = new URL(url);
    const indice = urlObj.pathname.indexOf(prefixo);
    return indice >= 0 ? decodeURIComponent(urlObj.pathname.slice(indice + prefixo.length)) : null;
  } catch { return url.startsWith(`${IMAGENS_BUCKET}/`) ? url.slice(IMAGENS_BUCKET.length + 1) : null; }
}
function obterBucketImagens() {
  if (!armazenamentoImagens || typeof armazenamentoImagens.from !== 'function') throw erroImagem('Armazenamento de imagens indisponível. Configure o bucket produtos.', 503);
  return armazenamentoImagens.from(IMAGENS_BUCKET);
}
const buscarTaxaBairro = async ({ cidade, uf, chaveNormalizada }) => {
  const { data, error } = await supabase.from('delivery_bairro_taxas')
    .select('nome,taxa,ativo')
    .eq('cidade', cidade)
    .eq('uf', uf)
    .eq('chave_normalizada', chaveNormalizada)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return data;
};
const entrega = entregaTeste || criarEntrega({ buscarTaxaBairro });
const pagamentos = pagamentosTeste || criarPagamentos({ db: supabase, payerEmail: process.env.MERCADOPAGO_PAYER_EMAIL });
const infinitePay = pagamentosTeste ? null : criarInfinitePay({ db: supabase });
const provedorPagamentoPadrao = String(process.env.PAYMENT_PROVIDER || 'infinitepay').trim().toLowerCase();
const provedores = pagamentosTeste ? { infinitepay: pagamentosTeste, mercadopago_pix: pagamentosTeste } : { infinitepay: infinitePay, mercadopago_pix: pagamentos };
const normalizarProvedor = valor => ({ mercadopago: 'mercadopago_pix', mercado_pago: 'mercadopago_pix', pix: 'mercadopago_pix', mercadopago_pix: 'mercadopago_pix', infinitepay: 'infinitepay' }[String(valor || '').trim().toLowerCase()] || null);
const centavos = valor => Math.round(Number(valor) * 100);
const reaisDeCentavos = valor => Number(valor) / 100;
const adicionaisIdsNormalizados = valor => {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw new Error('Adicionais inválidos.');
  const ids = valor.map(id => String(id)).filter(Boolean);
  if (ids.length !== new Set(ids).size) throw new Error('Adicional duplicado.');
  return ids.sort((a, b) => a.localeCompare(b));
};
const identidadeItem = (produtoId, adicionaisIds) => `${String(produtoId)}|${adicionaisIds.join(',')}`;
const pagamentoPixPublico = pagamento => pagamento && ({ provider: 'mercadopago_pix', qr_code: pagamento.qr_code, qr_code_base64: pagamento.qr_code_base64, payment_id: pagamento.payment_id, order_id: pagamento.order_id, status: pagamento.status, expires_at: pagamento.expires_at });
const pedidoPagamentoPixPublico = pedido => ({ id: pedido.id, numero_pedido: pedido.numero_pedido ?? null, valor: pedido.valor, status: pedido.status, pagamento: pedido.pagamento, pagamento_status: pedido.pagamento_status, pagamento_provedor: 'mercadopago_pix' });
rota('post', '/api/webhooks/mercadopago', pagamentos.notificar);
if (infinitePay) rota('post', '/api/webhooks/infinitepay', infinitePay.notificar);
rota('post', '/api/admin/pedidos/:id/reconciliar-mercadopago', limitePedidos, autenticar, soAdmin1, async (req, res) => {
  try {
    res.json(await pagamentos.reconciliar(req.params.id, req.body?.order_id));
  } catch (error) {
    console.error(JSON.stringify({ evento: 'mercadopago_reconciliacao', resultado: 'falha', pedido_id: String(req.params.id), codigo: error?.status_reconciliacao ? 'validacao' : 'provedor_ou_banco', status_http: Number.isInteger(error?.status_http) ? error.status_http : undefined }));
    res.status(error?.status_reconciliacao || 503).json({ erro: error?.status_reconciliacao ? error.message : 'Não foi possível consultar ou reconciliar a Order.' });
  }
});

rota('post', '/api/cadastro-cliente', limiteAuth, registrarVisitante);
rota('post', '/api/cadastro', limiteAuth, cadastro);
rota('post', '/api/login', limiteAuth, login);
rota('post', '/api/logout', (req, res) => { res.clearCookie('lucy_sessao', opcoesCookie()); res.clearCookie('lucy_visitante', opcoesCookie()); res.sendStatus(204); });
rota('get', '/api/meu-perfil', autenticarCompra, async (req, res) => {
  if (req.visitante) return res.json({ perfil: { nome: req.visitante.nome, telefone: req.visitante.telefone, cep: req.visitante.cep, role: 'visitante' } });
  const { data: perfil, error } = await supabase.from('profiles').select('nome,email,telefone,role').eq('id', req.user.id).single();
  if (error || !perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' }); res.json({ perfil });
});
rota('get', '/api/taxa-entrega', limiteEntrega, async (req, res) => { try { res.json(await entrega(req.query.cep, req.query)); } catch (error) { res.status(400).json({ erro: error.message }); } });
rota('get', '/api/endereco', limiteEntrega, async (req, res) => { try { if (typeof entrega.consultarEndereco !== 'function') throw new Error('Consulta de CEP indisponível.'); res.json(await entrega.consultarEndereco(req.query.cep)); } catch (error) { res.status(400).json({ erro: error.message }); } });

rota('get', '/api/produtos', async (req, res) => { const { data, error } = await supabase.from('products').select('id,nome,preco,categoria,descricao,imagem_url,isEspecial,ativo').eq('ativo', true).order('nome'); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('get', '/api/admin/produtos', autenticar, soAdmin, async (_req, res) => { const { data, error } = await supabase.from('products').select('id,nome,preco,categoria,descricao,imagem_url,isEspecial,ativo').order('nome'); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data || []); });
rota('get', '/api/produtos/:id/adicionais', async (req, res) => {
  const produto = await supabase.from('products').select('id,ativo').eq('id', req.params.id).maybeSingle();
  if (produto.error) return res.status(503).json({ erro: 'Não foi possível carregar os adicionais.' });
  if (!produto.data || produto.data.ativo === false) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const relacoes = await supabase.from('produto_adicionais').select('adicional_id,ativo').eq('produto_id', req.params.id).eq('ativo', true);
  if (relacoes.error) return res.status(400).json({ erro: 'Não foi possível carregar os adicionais.' });
  const ids = [...new Set((relacoes.data || []).map(relacao => String(relacao.adicional_id)))];
  if (!ids.length) return res.json([]);
  const { data, error } = await supabase.from('adicionais').select('id,nome,preco').in('id', ids).eq('ativo', true).order('nome');
  if (error) return res.status(400).json({ erro: 'Não foi possível carregar os adicionais.' });
  res.json((data || []).filter(adicional => typeof adicional.nome === 'string' && Number.isFinite(Number(adicional.preco)) && Number(adicional.preco) >= 0));
});
rota('get', '/api/admin/adicionais', autenticar, soAdmin, async (_req, res) => {
  const [adicionais, relacoes] = await Promise.all([
    supabase.from('adicionais').select('id,nome,preco,ativo').order('nome'),
    supabase.from('produto_adicionais').select('adicional_id').eq('ativo', true)
  ]);
  const { data, error } = adicionais;
  if (error || relacoes.error) return res.status(503).json({ erro: 'Não foi possível carregar os adicionais.' });
  const contagens = new Map();
  for (const relacao of relacoes.data || []) contagens.set(String(relacao.adicional_id), (contagens.get(String(relacao.adicional_id)) || 0) + 1);
  res.json((data || []).map(adicional => ({ ...adicional, produtos_associados: contagens.get(String(adicional.id)) || 0 })));
});
rota('post', '/api/admin/adicionais', autenticar, soAdmin1, async (req, res) => {
  const { nome, preco, ativo = true } = req.body;
  if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120 || typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0 || preco > 999999 || typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Informe nome, preço válido e status.' });
  const { data, error } = await supabase.from('adicionais').insert([{ nome: nome.trim(), preco: Math.round(preco * 100) / 100, ativo }]).select('id,nome,preco,ativo').single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ erro: error.code === '23505' ? 'Já existe um adicional com esse nome.' : 'Não foi possível salvar o adicional.' });
  res.status(201).json(data);
});
rota('patch', '/api/admin/adicionais/:id', autenticar, soAdmin1, async (req, res) => {
  const alteracoes = {};
  if (req.body.nome !== undefined) { if (typeof req.body.nome !== 'string' || !req.body.nome.trim() || req.body.nome.trim().length > 120) return res.status(400).json({ erro: 'Nome de adicional inválido.' }); alteracoes.nome = req.body.nome.trim(); }
  if (req.body.preco !== undefined) { if (typeof req.body.preco !== 'number' || !Number.isFinite(req.body.preco) || req.body.preco < 0 || req.body.preco > 999999) return res.status(400).json({ erro: 'Preço de adicional inválido.' }); alteracoes.preco = Math.round(req.body.preco * 100) / 100; }
  if (req.body.ativo !== undefined) { if (typeof req.body.ativo !== 'boolean') return res.status(400).json({ erro: 'Status inválido.' }); alteracoes.ativo = req.body.ativo; }
  if (!Object.keys(alteracoes).length) return res.status(400).json({ erro: 'Nenhuma alteração informada.' });
  const { data, error } = await supabase.from('adicionais').update(alteracoes).eq('id', req.params.id).select('id,nome,preco,ativo').single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ erro: error.code === '23505' ? 'Já existe um adicional com esse nome.' : 'Não foi possível atualizar o adicional.' });
  res.json(data);
});
rota('get', '/api/admin/produtos/:id/adicionais', autenticar, soAdmin, async (req, res) => {
  const produto = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
  if (produto.error) return res.status(503).json({ erro: 'Não foi possível carregar as associações.' });
  if (!produto.data) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const [adicionais, relacoes] = await Promise.all([
    supabase.from('adicionais').select('id,nome,preco,ativo').order('nome'),
    supabase.from('produto_adicionais').select('adicional_id,ativo').eq('produto_id', req.params.id)
  ]);
  if (adicionais.error || relacoes.error) return res.status(503).json({ erro: 'Não foi possível carregar as associações.' });
  const estado = new Map((relacoes.data || []).map(relacao => [String(relacao.adicional_id), relacao.ativo !== false]));
  res.json((adicionais.data || []).map(adicional => ({ ...adicional, associado: estado.get(String(adicional.id)) === true })));
});
rota('get', '/api/admin/adicionais/:id/produtos', autenticar, soAdmin, async (req, res) => {
  const adicional = await supabase.from('adicionais').select('id').eq('id', req.params.id).maybeSingle();
  if (adicional.error) return res.status(503).json({ erro: 'Não foi possível carregar as associações.' });
  if (!adicional.data) return res.status(404).json({ erro: 'Adicional não encontrado.' });
  const relacoes = await supabase.from('produto_adicionais').select('produto_id,ativo').eq('adicional_id', req.params.id);
  if (relacoes.error) return res.status(503).json({ erro: 'Não foi possível carregar as associações.' });
  res.json({ produto_ids: (relacoes.data || []).filter(relacao => relacao.ativo !== false).map(relacao => String(relacao.produto_id)) });
});
rota('put', '/api/admin/produtos/:id/adicionais', autenticar, soAdmin1, async (req, res) => {
  const ids = req.body.adicional_ids;
  if (!Array.isArray(ids) || ids.some(id => id == null) || new Set(ids.map(String)).size !== ids.length) return res.status(400).json({ erro: 'Lista de adicionais inválida.' });
  const produto = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
  if (produto.error) return res.status(503).json({ erro: 'Não foi possível atualizar as associações.' });
  if (!produto.data) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const existentes = await supabase.from('produto_adicionais').select('adicional_id,ativo').eq('produto_id', req.params.id);
  if (existentes.error) return res.status(503).json({ erro: 'Não foi possível atualizar as associações.' });
  const adicionais = ids.length ? await supabase.from('adicionais').select('id').in('id', ids) : { data: [], error: null };
  if (adicionais.error) return res.status(503).json({ erro: 'Não foi possível validar os adicionais.' });
  if ((adicionais.data || []).length !== new Set(ids.map(String)).size) return res.status(400).json({ erro: 'Um adicional informado não existe.' });
  const desejados = new Set(ids.map(String));
  for (const relacao of existentes.data || []) {
    const ativo = desejados.has(String(relacao.adicional_id));
    if (relacao.ativo !== ativo) {
      const atualizado = await supabase.from('produto_adicionais').update({ ativo }).eq('produto_id', req.params.id).eq('adicional_id', relacao.adicional_id);
      if (atualizado.error) return res.status(400).json({ erro: 'Não foi possível atualizar as associações.' });
    }
  }
  const existentesIds = new Set((existentes.data || []).map(relacao => String(relacao.adicional_id)));
  const novos = ids.filter(id => !existentesIds.has(String(id))).map(adicional_id => ({ produto_id: req.params.id, adicional_id, ativo: true }));
  if (novos.length) { const inseridos = await supabase.from('produto_adicionais').insert(novos); if (inseridos.error) return res.status(400).json({ erro: 'Não foi possível atualizar as associações.' }); }
  res.json({ adicional_ids: ids });
});
rota('put', '/api/admin/adicionais/:id/produtos', autenticar, soAdmin1, async (req, res) => {
  const ids = req.body.produto_ids;
  if (!Array.isArray(ids) || ids.some(id => id == null) || new Set(ids.map(String)).size !== ids.length) return res.status(400).json({ erro: 'Lista de produtos inválida.' });
  const adicional = await supabase.from('adicionais').select('id').eq('id', req.params.id).maybeSingle();
  if (adicional.error) return res.status(503).json({ erro: 'Não foi possível validar o adicional.' });
  if (!adicional.data) return res.status(404).json({ erro: 'Adicional não encontrado.' });
  const produtos = ids.length ? await supabase.from('products').select('id').in('id', ids) : { data: [], error: null };
  if (produtos.error) return res.status(503).json({ erro: 'Não foi possível validar os produtos.' });
  if ((produtos.data || []).length !== new Set(ids.map(String)).size) return res.status(400).json({ erro: 'Um produto informado não existe.' });
  const existentes = await supabase.from('produto_adicionais').select('produto_id,ativo').eq('adicional_id', req.params.id);
  if (existentes.error) return res.status(503).json({ erro: 'Não foi possível carregar as associações.' });
  const desejados = new Set(ids.map(String));
  const alterados = [];
  const inseridos = [];
  try {
    for (const relacao of existentes.data || []) {
      const ativo = desejados.has(String(relacao.produto_id));
      if (relacao.ativo !== ativo) {
        const atualizado = await supabase.from('produto_adicionais').update({ ativo }).eq('produto_id', relacao.produto_id).eq('adicional_id', req.params.id);
        if (atualizado.error) throw atualizado.error;
        alterados.push({ produto_id: relacao.produto_id, ativo: relacao.ativo !== false });
      }
    }
    const existentesIds = new Set((existentes.data || []).map(relacao => String(relacao.produto_id)));
    const novos = ids.filter(id => !existentesIds.has(String(id))).map(produto_id => ({ produto_id, adicional_id: req.params.id, ativo: true }));
    if (novos.length) {
      const resultado = await supabase.from('produto_adicionais').insert(novos);
      if (resultado.error) throw resultado.error;
      inseridos.push(...novos);
    }
  } catch {
    // Compensa alterações já aplicadas para que uma falha não deixe a seleção pela metade.
    for (const relacao of alterados) await supabase.from('produto_adicionais').update({ ativo: relacao.ativo }).eq('produto_id', relacao.produto_id).eq('adicional_id', req.params.id);
    for (const relacao of inseridos) await supabase.from('produto_adicionais').delete().eq('produto_id', relacao.produto_id).eq('adicional_id', req.params.id);
    return res.status(400).json({ erro: 'Não foi possível atualizar as associações.' });
  }
  res.json({ produto_ids: ids });
});
rota('get', '/api/admin/taxas-entrega', autenticar, soAdmin, async (_req, res) => {
  const { data, error } = await supabase.from('delivery_bairro_taxas').select('id,cidade,uf,nome,taxa,ativo').order('nome');
  if (error) return res.status(503).json({ erro: 'Não foi possível carregar as taxas.' });
  res.json(data || []);
});
rota('post', '/api/admin/taxas-entrega', autenticar, soAdmin1, async (req, res) => {
  const { cidade, uf, nome, taxa, ativo = true } = req.body;
  const chave = typeof nome === 'string' ? normalizarBairro(nome) : '';
  if (typeof cidade !== 'string' || !cidade.trim() || cidade.trim().length > 120 || typeof uf !== 'string' || !/^[A-Za-z]{2}$/.test(uf.trim()) || !chave || typeof taxa !== 'number' || !Number.isFinite(taxa) || taxa < 0 || typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Informe cidade, UF, bairro e taxa válida.' });
  const { data, error } = await supabase.from('delivery_bairro_taxas').insert([{ cidade: cidade.trim(), uf: uf.trim().toUpperCase(), nome: nome.trim(), chave_normalizada: chave, taxa: Math.round(taxa * 100) / 100, ativo }]).select('id,cidade,uf,nome,taxa,ativo').single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ erro: error.code === '23505' ? 'Já existe uma taxa para este bairro.' : 'Não foi possível salvar a taxa.' });
  res.status(201).json(data);
});
rota('patch', '/api/admin/taxas-entrega/:id', autenticar, soAdmin1, async (req, res) => {
  const alteracoes = {};
  if (req.body.cidade !== undefined) { if (typeof req.body.cidade !== 'string' || !req.body.cidade.trim() || req.body.cidade.trim().length > 120) return res.status(400).json({ erro: 'Cidade inválida.' }); alteracoes.cidade = req.body.cidade.trim(); }
  if (req.body.uf !== undefined) { if (typeof req.body.uf !== 'string' || !/^[A-Za-z]{2}$/.test(req.body.uf.trim())) return res.status(400).json({ erro: 'UF inválida.' }); alteracoes.uf = req.body.uf.trim().toUpperCase(); }
  if (req.body.nome !== undefined) { if (typeof req.body.nome !== 'string' || !req.body.nome.trim() || !normalizarBairro(req.body.nome)) return res.status(400).json({ erro: 'Bairro inválido.' }); alteracoes.nome = req.body.nome.trim(); alteracoes.chave_normalizada = normalizarBairro(req.body.nome); }
  if (req.body.taxa !== undefined) { if (typeof req.body.taxa !== 'number' || !Number.isFinite(req.body.taxa) || req.body.taxa < 0) return res.status(400).json({ erro: 'Taxa inválida.' }); alteracoes.taxa = Math.round(req.body.taxa * 100) / 100; }
  if (req.body.ativo !== undefined) { if (typeof req.body.ativo !== 'boolean') return res.status(400).json({ erro: 'Status inválido.' }); alteracoes.ativo = req.body.ativo; }
  if (!Object.keys(alteracoes).length) return res.status(400).json({ erro: 'Nenhuma alteração informada.' });
  const { data, error } = await supabase.from('delivery_bairro_taxas').update(alteracoes).eq('id', req.params.id).select('id,cidade,uf,nome,taxa,ativo').single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ erro: error.code === '23505' ? 'Já existe uma taxa para este bairro.' : 'Não foi possível atualizar a taxa.' });
  res.json(data);
});
// A política existente permite que ambos os administradores mantenham produtos.
// As novas regras comerciais (adicionais, associações e taxas) permanecem
// restritas ao Admin 1.
rota('post', '/api/produtos', autenticar, soAdmin, salvarProduto);
rota('put', '/api/produtos/:id', autenticar, soAdmin, salvarProduto);
rota('post', '/api/admin/produtos/:id/imagem', autenticar, soAdmin, async (req, res) => {
  const consulta = await supabase.from('products').select('id,imagem_url').eq('id', req.params.id).maybeSingle();
  if (consulta.error) return res.status(503).json({ erro: 'Não foi possível carregar o produto.' });
  if (!consulta.data) return res.status(404).json({ erro: 'Produto não encontrado.' });
  let arquivo;
  try { arquivo = await lerImagemMultipart(req); } catch (erro) { return res.status(erro.status || 400).json({ erro: erro.message }); }
  let processada;
  try { processada = await prepararImagem(arquivo.buffer, arquivo.mime); } catch (erro) { return res.status(erro.status || 400).json({ erro: erro.message }); }
  const caminhoNovo = `${String(req.params.id)}/${crypto.randomUUID()}.webp`;
  let bucket;
  try { bucket = obterBucketImagens(); } catch (erro) { return res.status(erro.status || 503).json({ erro: erro.message }); }
  let enviada;
  try { enviada = await bucket.upload(caminhoNovo, processada, { contentType: 'image/webp', cacheControl: '31536000', upsert: false }); }
  catch { return res.status(503).json({ erro: 'Não foi possível enviar a imagem.' }); }
  if (enviada.error) return res.status(503).json({ erro: 'Não foi possível enviar a imagem.' });
  let publico;
  try { publico = bucket.getPublicUrl(caminhoNovo)?.data?.publicUrl; } catch { publico = null; }
  if (!publico) { await bucket.remove([caminhoNovo]).catch(() => {}); return res.status(503).json({ erro: 'Não foi possível preparar a imagem.' }); }
  let atualizado;
  try { atualizado = await supabase.from('products').update({ imagem_url: publico }).eq('id', req.params.id).select('id,imagem_url').single(); }
  catch { await bucket.remove([caminhoNovo]).catch(() => {}); return res.status(503).json({ erro: 'Não foi possível salvar a referência da imagem.' }); }
  if (atualizado.error || !atualizado.data) {
    await bucket.remove([caminhoNovo]).catch(() => {});
    return res.status(400).json({ erro: 'Não foi possível salvar a referência da imagem.' });
  }
  const caminhoAntigo = caminhoStorage(consulta.data.imagem_url);
  let aviso;
  if (caminhoAntigo && caminhoAntigo !== caminhoNovo) {
    try { const removida = await bucket.remove([caminhoAntigo]); if (removida.error) aviso = 'Produto atualizado, mas ocorreu um problema ao limpar a imagem antiga.'; }
    catch { aviso = 'Produto atualizado, mas ocorreu um problema ao limpar a imagem antiga.'; }
  }
  res.json({ ...atualizado.data, ...(aviso ? { aviso } : {}) });
});
rota('delete', '/api/admin/produtos/:id/imagem', autenticar, soAdmin, async (req, res) => {
  const consulta = await supabase.from('products').select('id,imagem_url').eq('id', req.params.id).maybeSingle();
  if (consulta.error) return res.status(503).json({ erro: 'Não foi possível carregar o produto.' });
  if (!consulta.data) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const atualizado = await supabase.from('products').update({ imagem_url: null }).eq('id', req.params.id).select('id,imagem_url').single();
  if (atualizado.error || !atualizado.data) return res.status(400).json({ erro: 'Não foi possível remover a imagem.' });
  const caminhoAntigo = caminhoStorage(consulta.data.imagem_url);
  let aviso;
  if (caminhoAntigo) {
    try { const removida = await obterBucketImagens().remove([caminhoAntigo]); if (removida.error) aviso = 'Imagem removida do produto, mas o arquivo antigo precisa de limpeza manual.'; }
    catch { aviso = 'Imagem removida do produto, mas o arquivo antigo precisa de limpeza manual.'; }
  }
  res.json({ ...atualizado.data, ...(aviso ? { aviso } : {}) });
});
async function salvarProduto(req, res) {
  const { nome, preco, categoria, descricao, imagem_url, imagem, isEspecial, ativo } = req.body;
  if (typeof nome !== 'string' || !nome.trim() || nome.trim().length < 3 || nome.trim().length > 100 || typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0.01 || Number(preco) > 9999.99 || typeof categoria !== 'string' || !categoria.trim() || categoria.length > 80 || (descricao != null && (typeof descricao !== 'string' || descricao.length > 2000)) || (isEspecial !== undefined && typeof isEspecial !== 'boolean') || (ativo !== undefined && typeof ativo !== 'boolean')) return res.status(400).json({ erro: 'Informe nome (3 a 100 caracteres), categoria e preço válido.' });
  if ([imagem_url, imagem].some(url => url != null && (typeof url !== 'string' || !/^https?:\/\//i.test(url)))) return res.status(400).json({ erro: 'Informe uma URL de imagem HTTP ou HTTPS válida.' });
  const produto = { nome: nome.trim(), preco: Math.round(Number(preco) * 100) / 100, categoria: categoria.trim(), isEspecial: Boolean(isEspecial) };
  // Produtos novos começam disponíveis; em edições, só altera o status
  // quando ele foi explicitamente informado.
  if (ativo !== undefined || !req.params.id) produto.ativo = ativo !== false;
  if (descricao !== undefined) produto.descricao = descricao?.trim() || null;
  if (imagem_url !== undefined || imagem !== undefined) produto.imagem_url = imagem_url || imagem || null;
  const consulta = req.params.id ? supabase.from('products').update(produto).eq('id', req.params.id) : supabase.from('products').insert([produto]);
  const { data, error } = await consulta.select().single(); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.status(req.params.id ? 200 : 201).json(data);
}
// Compatibilidade legada: DELETE nunca apaga mais o registro; desativa-o.
// A interface administrativa usa PUT para deixar explícito o ciclo de vida.
rota('delete', '/api/produtos/:id', autenticar, soAdmin, async (req, res) => { const { error } = await supabase.from('products').update({ ativo: false }).eq('id', req.params.id); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.status(204).end(); });
rota('get', '/api/fluxo-caixa', autenticar, soAdmin1, async (req, res) => {
  const { inicio, fim } = req.query;
  if ((inicio !== undefined && !dataIsoValida(inicio)) || (fim !== undefined && !dataIsoValida(fim)) || (inicio && fim && inicio > fim)) return res.status(400).json({ erro: 'Período de caixa inválido.' });
  let consulta = supabase.from('fluxo_caixa').select('id,descricao,tipo,valor,data,pedido_id').order('data', { ascending: false });
  if (inicio) consulta = consulta.gte('data', inicio);
  if (fim) consulta = consulta.lte('data', fim);
  const { data, error } = await consulta;
  if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' });
  res.json(data);
});
async function salvarTransacao(req, res) {
  const { descricao, tipo, valor, data } = req.body;
  const dataValida = dataIsoValida(data);
  if (typeof descricao !== 'string' || !descricao.trim() || descricao.length > 300 || !['receita', 'despesa', 'total-despesa-funcionario'].includes(tipo) || typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0.01 || valor > 99999999 || !dataValida) return res.status(400).json({ erro: 'Informe descrição, tipo, valor positivo e data válida.' });
  const transacao = { descricao: descricao.trim(), tipo, valor: Math.round(valor * 100) / 100, data };
  const consulta = req.params.id ? supabase.from('fluxo_caixa').update(transacao).eq('id', req.params.id).is('pedido_id', null) : supabase.from('fluxo_caixa').insert([transacao]);
  const { data: registro, error } = await consulta.select().single();
  if (error || !registro) return res.status(409).json({ erro: 'Transação não encontrada ou vinculada a pagamento. Lançamentos automáticos não podem ser editados.' });
  res.status(req.params.id ? 200 : 201).json(registro);
}
rota('post', '/api/fluxo-caixa', autenticar, soAdmin1, salvarTransacao);
rota('put', '/api/fluxo-caixa/:id', autenticar, soAdmin1, salvarTransacao);
rota('delete', '/api/fluxo-caixa/:id', autenticar, soAdmin1, async (req, res) => {
  const { data, error } = await supabase.from('fluxo_caixa').delete().eq('id', req.params.id).is('pedido_id', null).select('id').maybeSingle();
  if (error || !data) return res.status(409).json({ erro: 'Transação não encontrada ou vinculada a pagamento. Lançamentos automáticos não podem ser excluídos.' });
  res.status(204).end();
});

rota('post', '/api/pedidos', limitePedidos, autenticarOuCriarCompra, async (req, res) => {
  if (!['cliente', 'visitante'].includes(req.user.role)) return res.status(403).json({ erro: 'Pedidos devem ser feitos pela conta de cliente.' });
  const { itens, observacao_geral, endereco, numero_casa, bairro, cep, pagamento, checkout_chave, cliente_nome, cliente_telefone } = req.body;
  const tipoPagamentoEntrega = pagamento === 'entrega' ? req.body.tipo_pagamento_entrega : null;
  const trocoParaInformado = req.body.troco_para;
  const trocoParaConsiderado = pagamento === 'entrega' && tipoPagamentoEntrega === 'dinheiro' ? trocoParaInformado : null;
  const subtotalEsperado = req.body.subtotal_esperado;
  let emailPedido = '';
  if (!emailPedido && req.user.role === 'cliente') {
    const { data: perfilEmail, error: erroPerfilEmail } = await supabase.from('profiles').select('email').eq('id', req.user.id).maybeSingle();
    if (erroPerfilEmail) return res.status(503).json({ erro: 'Não foi possível recuperar os dados do seu perfil.' });
    emailPedido = String(perfilEmail?.email || '').trim().toLowerCase();
  }
  const pagamentoOnline = pagamento === 'site';
  const provedorSolicitado = pagamentoOnline ? (normalizarProvedor(req.body.provedor_pagamento || req.body.payment_provider) || normalizarProvedor(provedorPagamentoPadrao) || 'infinitepay') : null;
  const pagamentosAtivos = pagamentoOnline ? provedores[provedorSolicitado] : null;
  if (typeof cliente_nome !== 'string' || cliente_nome.trim().length < 2 || cliente_nome.trim().length > 100 || !telefoneValido(cliente_telefone)) return res.status(400).json({ erro: 'Informe seu nome e telefone com DDD.' });
  if (!Array.isArray(itens) || !itens.length || itens.length > 100 || itens.some(item => !item || !['string', 'number'].includes(typeof item.produto_id))) return res.status(400).json({ erro: 'Adicione ao menos um item ao carrinho.' });
  let identidades;
  try {
    identidades = itens.map(item => identidadeItem(item.produto_id, adicionaisIdsNormalizados(item.adicionais_ids)));
  } catch (error) { return res.status(400).json({ erro: error.message }); }
  if (new Set(identidades).size !== identidades.length) return res.status(400).json({ erro: 'Há itens iguais repetidos no carrinho.' });
  if ([endereco, numero_casa, bairro, cep].some(campo => typeof campo !== 'string' || !campo.trim() || campo.length > 250) || (observacao_geral != null && typeof observacao_geral !== 'string')) return res.status(400).json({ erro: 'Preencha rua, número, bairro e CEP para a entrega.' });
  if (!['site', 'entrega'].includes(pagamento)) return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
  if (pagamento === 'entrega' && !['dinheiro', 'cartao'].includes(tipoPagamentoEntrega)) return res.status(400).json({ erro: 'Escolha se o pagamento na entrega será em dinheiro ou cartão.' });
  if (trocoParaConsiderado !== null && trocoParaConsiderado !== undefined && (typeof trocoParaConsiderado !== 'number' || !Number.isFinite(trocoParaConsiderado) || trocoParaConsiderado <= 0 || trocoParaConsiderado > 99999999.99 || Math.abs(trocoParaConsiderado - Math.round(trocoParaConsiderado * 100) / 100) > 1e-9)) return res.status(400).json({ erro: 'Informe um valor de troco válido.' });
  if (pagamentoOnline && !pagamentosAtivos?.disponivel) return res.status(503).json({ erro: 'Pagamento online indisponível. Tente novamente mais tarde.' });
  if (typeof checkout_chave !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkout_chave)) return res.status(400).json({ erro: 'Atualize o carrinho e tente novamente.' });
  const { data: existente, error: buscaErro } = await pedidosDoComprador(supabase.from('pedidos').select('*').eq('checkout_chave', checkout_chave), req.user).maybeSingle();
  if (buscaErro) return res.status(503).json({ erro: 'Não foi possível consultar seu pedido.' });
  // A escolha "entrega" não pode cair no checkout online mesmo se uma versão
  // anterior da RPC do banco tiver persistido o campo pagamento como "site".
  if (existente) return pagamento === 'entrega' || existente.pagamento === 'entrega'
    ? confirmarPedidoEntrega(existente, res)
    : responderCheckout(existente, res, provedorSolicitado, pagamentosAtivos);
  let taxa; try { taxa = (await entrega(cep, { endereco, bairro, numero_casa })).taxa; } catch (error) { return res.status(400).json({ erro: error.message }); }
  const ids = itens.map(item => item.produto_id); const { data: produtos, error: produtosErro } = await supabase.from('products').select('id,nome,preco,ativo').in('id', ids).eq('ativo', true);
  if (produtosErro || produtos?.length !== new Set(ids).size) return res.status(400).json({ erro: 'Um produto do carrinho não está mais disponível.' });
  const mapa = new Map(produtos.map(p => [String(p.id), p]));
  const todosAdicionais = itens.flatMap(item => { try { return adicionaisIdsNormalizados(item.adicionais_ids); } catch { return []; } });
  const idsAdicionais = [...new Set(todosAdicionais)];
  let adicionais = [];
  let relacionamentos = [];
  if (idsAdicionais.length) {
    const [resultadoAdicionais, resultadoRelacionamentos] = await Promise.all([
      supabase.from('adicionais').select('id,nome,preco,ativo').in('id', idsAdicionais),
      supabase.from('produto_adicionais').select('produto_id,adicional_id,ativo').in('produto_id', ids)
    ]);
    if (resultadoAdicionais.error || resultadoRelacionamentos.error) return res.status(503).json({ erro: 'Os adicionais ainda não estão disponíveis para este pedido.' });
    adicionais = resultadoAdicionais.data || [];
    relacionamentos = resultadoRelacionamentos.data || [];
  }
  const mapaAdicionais = new Map(adicionais.map(item => [String(item.id), item]));
  const mapaPermitidos = new Map();
  for (const relacao of relacionamentos) {
    if (relacao.ativo !== false) {
      const chave = String(relacao.produto_id);
      if (!mapaPermitidos.has(chave)) mapaPermitidos.set(chave, new Set());
      mapaPermitidos.get(chave).add(String(relacao.adicional_id));
    }
  }
  let subtotalCentavos = 0; let itensConfirmados;
  try {
    itensConfirmados = itens.map(item => {
      const produto = mapa.get(String(item.produto_id));
      const quantidade = item.quantidade;
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new Error('Quantidade inválida.');
      const precoBaseCentavos = centavos(produto?.preco);
      if (!Number.isInteger(precoBaseCentavos) || precoBaseCentavos <= 0) throw new Error('Preço de produto inválido.');
      const idsDoItem = adicionaisIdsNormalizados(item.adicionais_ids);
      const permitidos = mapaPermitidos.get(String(produto.id)) || new Set();
      const snapshotAdicionais = idsDoItem.map(id => {
        const adicional = mapaAdicionais.get(id);
        if (!adicional || adicional.ativo !== true) throw new Error('Adicional inexistente ou inativo.');
        if (!permitidos.has(id)) throw new Error('Adicional não permitido para este produto.');
        const preco = centavos(adicional.preco);
        if (!Number.isInteger(preco) || preco < 0) throw new Error('Preço de adicional inválido.');
        return { id: adicional.id, nome: adicional.nome, preco: reaisDeCentavos(preco) };
      });
      const adicionaisCentavos = snapshotAdicionais.reduce((soma, adicional) => soma + centavos(adicional.preco), 0);
      const unitarioCentavos = precoBaseCentavos + adicionaisCentavos;
      const subtotalItemCentavos = unitarioCentavos * quantidade;
      subtotalCentavos += subtotalItemCentavos;
      return {
        produto_id: produto.id,
        quantidade,
        produto_nome_snapshot: String(produto.nome || '').slice(0, 150),
        preco_base_unitario: reaisDeCentavos(precoBaseCentavos),
        adicionais_snapshot: snapshotAdicionais,
        preco_adicionais_unitario: reaisDeCentavos(adicionaisCentavos),
        preco_unitario: reaisDeCentavos(unitarioCentavos),
        observacao_item: String(item.observacao_item || '').slice(0, 300)
      };
    });
  } catch (error) { return res.status(400).json({ erro: error.message }); }
  const subtotal = reaisDeCentavos(subtotalCentavos);
  const trocoParaCentavos = trocoParaConsiderado == null ? null : centavos(trocoParaConsiderado);
  const totalCentavos = subtotalCentavos + centavos(taxa);
  if (trocoParaCentavos !== null && (!Number.isSafeInteger(trocoParaCentavos) || trocoParaCentavos < totalCentavos)) return res.status(400).json({ erro: 'O valor para troco não pode ser menor que o total do pedido.' });
  if (subtotalEsperado !== undefined && (typeof subtotalEsperado !== 'number' || !Number.isFinite(subtotalEsperado) || centavos(subtotalEsperado) !== subtotalCentavos)) return res.status(409).json({ erro: 'Os preços foram atualizados. Revise o carrinho.' });
  const trocoPara = trocoParaCentavos === null ? null : reaisDeCentavos(trocoParaCentavos);
  const { data: pedido, error } = await supabase.rpc('criar_pedido_com_itens', { p_pedido: { usuario_id: req.user.role === 'cliente' ? req.user.id : null, visitante_id: req.user.role === 'visitante' ? req.user.id : null, cliente_nome: cliente_nome.trim(), cliente_email: emailPedido || null, cliente_telefone: cliente_telefone.replace(/\D/g, ''), valor: Math.round((subtotal + taxa) * 100) / 100, subtotal, taxa_entrega: taxa, status: 'pendente', observacao_geral: observacao_geral?.slice(0, 500) || null, endereco: endereco.trim(), numero_casa: numero_casa.trim(), bairro: bairro.trim(), cep: String(cep).replace(/\D/g, ''), pagamento, tipo_pagamento_entrega: tipoPagamentoEntrega, troco_para: trocoPara, checkout_chave, pagamento_status: 'pending' }, p_itens: itensConfirmados });
  if (error || !pedido) return res.status(503).json({ erro: 'Não foi possível salvar o pedido. Tente novamente.' });
  if (pagamento === 'entrega') return confirmarPedidoEntrega(pedido, res);
  if (provedorSolicitado === 'mercadopago_pix') {
    const { error: erroProvedor } = await supabase.from('pedidos').update({ pagamento_provedor: provedorSolicitado, cliente_email: emailPedido || null }).eq('id', pedido.id);
    if (erroProvedor) return res.status(503).json({ erro: 'Não foi possível preparar o pagamento. A migração de pagamentos ainda precisa ser aplicada.' });
  }
  pedido.pagamento_provedor = provedorSolicitado;
  pedido.cliente_email = emailPedido || null;
  return responderCheckout(pedido, res, provedorSolicitado, pagamentosAtivos);
});
async function confirmarPedidoEntrega(pedido, res) {
  // A migração atual da RPC já grava "entrega". Esta atualização protege os
  // pedidos criados enquanto uma versão anterior da função ainda estava ativa.
  if (pedido.pagamento !== 'entrega') {
    const { data: atualizado, error } = await supabase.from('pedidos')
      .update({ pagamento: 'entrega' }).eq('id', pedido.id).select().single();
    if (error || !atualizado) {
      console.error(JSON.stringify({ evento: 'pedido_entrega', resultado: 'falha', etapa: 'persistir_pagamento', pedido_id: String(pedido.id), erro: String(error?.code || error?.name || 'Error').slice(0, 60), mensagem: String(error?.message || 'registro não atualizado').slice(0, 160) }));
      return res.status(503).json({ erro: 'Não foi possível registrar a forma de pagamento. Tente novamente.' });
    }
    pedido = atualizado;
  }
  return responderPedidoEntrega(pedido, res);
}
function responderPedidoEntrega(pedido, res) {
  return res.status(201).json({ mensagem: 'Pedido realizado. O pagamento será feito na entrega.', tipo_pagamento: 'entrega', pedido: { ...pedido, pagamento: 'entrega' } });
}
async function responderCheckout(pedido, res, provedorSolicitado, pagamentosAtivos) {
  if (pedido.pago_em || pedido.status === 'cancelado') return res.status(409).json({ erro: 'Este pedido já foi pago ou cancelado. Confira seus pedidos.' });
  // Não cria checkout para uma gravação incompleta ou ainda em andamento.
  const { data: itens, error: erroItens } = await supabase.from('itens_pedido').select('pedido_id').eq('pedido_id', pedido.id);
  if (erroItens || !itens?.length) return res.status(503).json({ erro: 'Seu pedido está sendo preparado para pagamento. Tente novamente.' });
  const provedor = normalizarProvedor(pedido.pagamento_provedor) || provedorSolicitado || 'infinitepay';
  const pagamento = provedores[provedor] || pagamentosAtivos;
  if (!pagamento?.disponivel) return res.status(503).json({ erro: 'Pagamento online indisponível. Tente novamente mais tarde.' });
  let payment_url = pedido.payment_url;
  let dadosPagamento;
  if (payment_url && !urlCheckoutValida(payment_url)) {
    console.error(JSON.stringify({ evento: 'pedido_checkout', resultado: 'falha', etapa: 'validar_url_persistida', pedido_id: String(pedido.id), erro: 'URL inválida', mensagem: 'payment_url persistida não pertence ao checkout permitido' }));
    return res.status(503).json({ erro: 'Não foi possível abrir o pagamento. Tente novamente; seu pedido será reutilizado.' });
  }
  if (!payment_url) {
    try {
      dadosPagamento = await pagamento.checkout(pedido);
      if (typeof dadosPagamento === 'string') payment_url = dadosPagamento;
      else payment_url = dadosPagamento?.payment_url || null;
      if (provedor === 'infinitepay' && !urlCheckoutValida(payment_url)) throw new Error('URL de pagamento inválida');
      if (provedor === 'mercadopago_pix' && (!dadosPagamento?.qr_code || !dadosPagamento?.qr_code_base64)) throw new Error('Dados Pix inválidos');
    } catch (error) {
      console.error(JSON.stringify({ evento: 'pedido_checkout', resultado: 'falha', etapa: 'criar_checkout', pedido_id: String(pedido.id), erro: String(error?.name || 'Error').slice(0, 60), mensagem: String(error?.message || 'erro').slice(0, 160) }));
      return res.status(503).json({ erro: 'Não foi possível abrir o pagamento. Tente novamente; seu pedido será reutilizado.' });
    }
    const { error } = await supabase.from('pedidos').update({ ...(payment_url ? { payment_url } : {}), pagamento_provedor: provedor }).eq('id', pedido.id);
    if (error) {
      console.error(JSON.stringify({ evento: 'pedido_checkout', resultado: 'falha', etapa: 'persistir_url', pedido_id: String(pedido.id), erro: String(error.code || error.name || 'Error').slice(0, 60), mensagem: String(error.message || 'erro').slice(0, 160) }));
      return res.status(503).json({ erro: 'Não foi possível abrir o pagamento. Tente novamente; seu pedido será reutilizado.' });
    }
  }
  if (!dadosPagamento && provedor === 'mercadopago_pix') dadosPagamento = { provider: 'mercadopago_pix', payment_url: pedido.payment_url || null, qr_code: pedido.pagamento_qr_code, qr_code_base64: pedido.pagamento_qr_code_base64, payment_id: String(pedido.pagamento_id || '').replace(/^mercadopago:/, ''), order_id: pedido.pagamento_order_id || null, status: pedido.pagamento_status || 'pending', expires_at: pedido.pagamento_expira_em };
  const pagamentoResposta = provedor === 'mercadopago_pix' ? pagamentoPixPublico(dadosPagamento) : null;
  return res.status(201).json({ mensagem: 'Aguardando pagamento.', pedido: provedor === 'mercadopago_pix' ? pedidoPagamentoPixPublico(pedido) : pedido, payment_url: provedor === 'mercadopago_pix' ? undefined : payment_url, ...(pagamentoResposta ? { pagamento: pagamentoResposta } : {}) });
}
rota('post', '/api/pedidos/:id/pagar', limitePedidos, autenticarCompra, async (req, res) => {
  const { data: pedido, error } = await pedidosDoComprador(supabase.from('pedidos').select('*').eq('id', req.params.id), req.user).maybeSingle();
  if (error || !pedido || !['cliente', 'visitante'].includes(req.user.role) || pedido.pagamento !== 'site') return res.status(404).json({ erro: 'Pedido não encontrado.' });
  return responderCheckout(pedido, res, normalizarProvedor(pedido.pagamento_provedor) || 'infinitepay', provedores[normalizarProvedor(pedido.pagamento_provedor) || 'infinitepay']);
});
rota('get', '/api/pedidos/:id/pagamento', autenticarCompra, async (req, res) => {
  const { data: pedido, error } = await pedidosDoComprador(supabase.from('pedidos').select('*').eq('id', req.params.id), req.user).maybeSingle();
  if (error || !pedido || pedido.pagamento !== 'site' || normalizarProvedor(pedido.pagamento_provedor) !== 'mercadopago_pix') return res.status(404).json({ erro: 'Pagamento não encontrado.' });
  res.json({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido ?? null, valor: pedido.valor, pagamento: pagamentoPixPublico({ provider: 'mercadopago_pix', qr_code: pedido.pagamento_qr_code, qr_code_base64: pedido.pagamento_qr_code_base64, payment_id: String(pedido.pagamento_id || '').replace(/^mercadopago:/, ''), order_id: pedido.pagamento_order_id || null, status: pedido.pagamento_status || 'pending', expires_at: pedido.pagamento_expira_em }) });
});
rota('get', '/api/pedidos/:id/pagamento-status', autenticarCompra, async (req, res) => {
  const { data: pedido, error } = await pedidosDoComprador(supabase.from('pedidos').select('id,numero_pedido,valor,pagamento,pagamento_provedor,pagamento_status,status,pagamento_expira_em'), req.user).maybeSingle();
  if (error || !pedido || pedido.pagamento !== 'site') return res.status(404).json({ erro: 'Pedido não encontrado.' });
  res.json({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido ?? null, valor: pedido.valor, provider: normalizarProvedor(pedido.pagamento_provedor), payment_status: pedido.pagamento_status || 'pending', order_status: pedido.status, expires_at: pedido.pagamento_expira_em });
});
rota('get', '/api/meus-pedidos', autenticarCompra, async (req, res) => { const { data, error } = await pedidosDoComprador(supabase.from('pedidos').select('*, itens_pedido(*, products(nome))'), req.user).order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('get', '/api/pedidos', autenticar, soAdmin, async (req, res) => {
  const { data: dia, status = '', pagina = '0' } = req.query;
  if (typeof status !== 'string' || (status && !ORDER_STATUSES.includes(status)) || typeof pagina !== 'string' || !/^\d{1,5}$/.test(pagina)) return res.status(400).json({ erro: 'Filtro de pedidos inválido.' });
  let consulta = supabase.from('pedidos').select('*, itens_pedido(*, products(nome)), profiles(nome,telefone)');
  if (dia !== undefined) {
    if (!dataIsoValida(dia)) return res.status(400).json({ erro: 'Selecione uma data válida.' });
    // Exibe todos os pedidos do dia local selecionado. O painel não pode
    // esconder compras feitas fora do antigo turno fixo de 18h à meia-noite.
    const inicio = new Date(`${dia}T00:00:00-03:00`);
    const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
    consulta = consulta.gte('data_criacao', inicio.toISOString()).lt('data_criacao', fim.toISOString());
  }
  if (status) consulta = consulta.eq('status', status);
  const offset = Number(pagina) * 50;
  const { data, error } = await consulta.order('data_criacao', { ascending: false }).range(offset, offset + 50);
  if (error) return res.status(503).json({ erro: 'Não foi possível carregar os pedidos. Tente novamente.' });
  res.json({ pedidos: data.slice(0, 50), temMais: data.length > 50, pagina: Number(pagina) });
});
rota('patch', '/api/pedidos/:id/status', autenticar, soAdmin, async (req, res) => {
  const proximo = req.body.status;
  if (!ORDER_STATUSES.includes(proximo) || proximo === 'recebido') return res.status(400).json({ erro: 'Status de pedido inválido.' });
  const { data: atual, error: erroBusca } = await supabase.from('pedidos').select('id,status,pagamento,pagamento_status').eq('id', req.params.id).single();
  if (erroBusca || !atual) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (proximo !== 'cancelado' && atual.pagamento === 'site' && atual.pagamento_status !== 'approved') return res.status(409).json({ erro: 'Aguarde a confirmação do pagamento antes de preparar o pedido.' });
  const transicoes = { pendente: ['aceito', 'cancelado'], aceito: ['em_preparo', 'cancelado'], em_preparo: ['pronto_entrega', 'cancelado'], pronto_entrega: ['cancelado'], recebido: [], cancelado: [] };
  if (!transicoes[atual.status]?.includes(proximo)) return res.status(400).json({ erro: 'Este status não pode ser aplicado neste momento.' });
  if (proximo === 'cancelado' && atual.status === 'pronto_entrega' && (atual.pagamento !== 'entrega' || atual.pagamento_status === 'approved')) return res.status(409).json({ erro: 'Pedidos pagos ou já enviados por pagamento online não podem ser cancelados nesta etapa.' });
  const alteracao = { status: proximo };
  if (proximo === 'pronto_entrega') alteracao.pronto_em = new Date().toISOString();
  let atualizar = supabase.from('pedidos').update(alteracao).eq('id', req.params.id).eq('status', atual.status);
  if (proximo !== 'cancelado' && atual.pagamento === 'site') atualizar = atualizar.eq('pagamento_status', 'approved');
  const { data, error } = await atualizar.select().maybeSingle();
  if (error) return res.status(400).json({ erro: 'Não foi possível atualizar o pedido.' }); if (!data) return res.status(409).json({ erro: 'O pedido mudou. Atualize a página e tente novamente.' }); res.json({ pedido: data });
});
rota('post', '/api/pedidos/:id/confirmar-recebimento', autenticarCompra, async (req, res) => {
  if (!['cliente', 'visitante'].includes(req.user.role)) return res.status(403).json({ erro: 'Somente o cliente pode confirmar o recebimento.' });
  const { data: pedido, error: erroBusca } = await pedidosDoComprador(supabase.from('pedidos').select('id,status').eq('id', req.params.id), req.user).single();
  if (erroBusca || !pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.status !== 'pronto_entrega') return res.status(400).json({ erro: 'Este pedido ainda não está em entrega.' });
  const { data, error } = await supabase.rpc('confirmar_recebimento_pedido', { p_pedido_id: String(pedido.id), p_recebido_em: new Date().toISOString() });
  if (error) {
    console.error(JSON.stringify({ evento: 'pedido_recebimento', resultado: 'falha', pedido_id: String(pedido.id), codigo: String(error.code || 'rpc').slice(0, 60) }));
    if (['PGRST202', '42883'].includes(String(error.code))) return res.status(503).json({ erro: 'A atualização de recebimento ainda precisa ser aplicada no banco.' });
    return res.status(409).json({ erro: 'O pedido mudou. Atualize a página e tente novamente.' });
  }
  if (!data) return res.status(409).json({ erro: 'O pedido mudou. Atualize a página e tente novamente.' });
  res.json({ pedido: data });
});
rota('delete', '/api/pedidos/:id', autenticar, soAdmin1, async (req, res) => {
  const { data, error } = await supabase.rpc('excluir_pedido_cancelado', { p_pedido_id: String(req.params.id) });
  if (error) {
    console.error(JSON.stringify({ evento: 'pedido_exclusao', resultado: 'falha', pedido_id: String(req.params.id), codigo: String(error.code || 'rpc').slice(0, 60) }));
    if (['PGRST202', '42883'].includes(String(error.code))) return res.status(503).json({ erro: 'A exclusão de pedidos ainda precisa ser aplicada no banco.' });
    return res.status(409).json({ erro: 'Somente pedidos cancelados e sem lançamento financeiro podem ser excluídos.' });
  }
  if (!data) return res.status(404).json({ erro: 'Pedido cancelado não encontrado.' });
  res.sendStatus(204);
});

// Páginas administrativas também precisam de proteção no servidor. O frontend
// continua validando a sessão para atualizar a interface, mas não deve ser a
// única barreira quando alguém acessa uma URL direta.
app.use((req, res, next) => {
  let caminho;
  try { caminho = decodeURIComponent(req.path); } catch { return res.redirect('/login'); }
  const arquivoAdmin = caminho.startsWith('/tela admin/') && !caminho.endsWith('/login.html');
  const rotaAdmin = caminho.startsWith('/admin/') && caminho !== '/admin/login';
  if (!arquivoAdmin && !rotaAdmin) return next();
  const exigeAdmin1 = caminho.includes('fluxo de caixa') || caminho === '/admin/fluxo-caixa';
  let statusInterno = 200;
  let autorizado = false;
  const respostaInterna = {
    status(valor) { statusInterno = valor; return this; },
    json() { return this; }
  };
  return Promise.resolve(autenticar(req, respostaInterna, () => { autorizado = true; }))
    .then(() => {
      if (statusInterno >= 500) return res.status(503).send('Serviço temporariamente indisponível.');
      if (!autorizado || !ADMIN_ROLES.includes(req.user?.role)) return res.redirect('/login');
      if (exigeAdmin1 && req.user.role !== 'admin1') return res.redirect('/admin/principal');
      return next();
    })
    .catch(next);
});

app.use(express.static(path.join(__dirname, 'public')));
const page = (...parts) => (req, res, next) => res.sendFile(
  path.join(__dirname, 'public', ...parts), erro => { if (erro) next(erro); }
);
rota('get', '/vendor/sweetalert2.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/sweetalert2/dist/sweetalert2.all.min.js')));
rota('get', '/vendor/sweetalert2.esm.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules/sweetalert2/dist/sweetalert2.esm.all.min.js')));
// As entradas alternativas encaminham para o HTML real, mantendo a base dos
// caminhos relativos de CSS, scripts e navegação, inclusive com barra final.
const entrada = (rotas, arquivo) => rota('get', rotas, (req, res) =>
  res.redirect(302, `/tela de login/${arquivo}`));
rota('get', '/', (req, res) => res.redirect('/tela cliente/Produtos.html'));
entrada(['/login', '/login.html', '/admin/login'], 'login.html');
entrada(['/login-cliente', '/login-cliente.html', encodeURI('/login cliente.html'), '/cliente/login'], 'login cliente.html');
// O cadastro público cria somente clientes; administradores usam contas existentes.
entrada(['/cadastro', '/cadastro-cliente', '/cliente/cadastro', '/cadastro.html', '/cadastro-cliente.html', encodeURI('/cadastro cliente.html')], 'cadastro cliente.html');
rota('get', '/admin/principal', page('tela admin', 'principal.html')); rota('get', '/admin/dashboard', page('tela admin', 'Dashboard.html')); rota('get', '/admin/produtos', page('tela admin', 'produtos.html')); rota('get', '/admin/regras-comerciais', page('tela admin', 'regras comerciais.html')); rota('get', '/admin/fluxo-caixa', page('tela admin', 'fluxo de caixa.html')); rota('get', '/admin/meu-perfil', page('tela admin', 'meu perfil.html')); rota('get', '/cliente/principal', page('tela cliente', 'principal.html')); rota('get', '/cliente/produtos', page('tela cliente', 'Produtos.html')); rota('get', '/cliente/carrinho', page('tela cliente', 'carrino cliente.html')); rota('get', '/cliente/meu-perfil', page('tela cliente', 'meu perfil cliente.html'));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  const status = erro.type === 'entity.too.large' ? 413 : erro.type === 'entity.parse.failed' || erro instanceof URIError ? 400 : 500;
  console.error(JSON.stringify({ evento: 'erro_api', status, codigo: String(erro.code || erro.type || 'interno').slice(0, 60) }));
  res.status(status).json({ erro: status === 400 ? 'JSON inválido.' : status === 413 ? 'Requisição muito grande.' : 'Não foi possível concluir a operação. Tente novamente.' });
});
return app;
}
if (require.main === module) {
  const porta = process.env.PORT || 3000;
  const servidor = criarApp().listen(porta, () => console.log(`Servidor iniciado em http://localhost:${porta}`));
  servidor.on('error', erro => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`A porta ${porta} já está em uso. Encerre o servidor anterior com Ctrl+C no terminal em que ele está rodando ou escolha outra porta com PORT=3001 npm --prefix dropshoes start (na raiz do projeto).`);
    } else {
      console.error(`Não foi possível iniciar o servidor: ${erro.message}`);
    }
    process.exitCode = 1;
  });
}

// Quando importado pela Vercel, exporta a instância Express diretamente.
// A fábrica continua disponível para os testes e para o servidor local.
if (require.main !== module) {
  module.exports = criarApp();
  module.exports.criarApp = criarApp;
} else {
  module.exports = { criarApp };
}
