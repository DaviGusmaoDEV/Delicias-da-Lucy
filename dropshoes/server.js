const path = require('path');
require('dotenv').config();
const express = require('express');
const { criarClienteSupabase } = require('./config/supabase');
const { limitarAutenticacao } = require('./middleware/limite-autenticacao');
const cors = require('cors');
const { criarAutenticacao } = require('./config/autenticacao');
const helmet = require('helmet');
const { MercadoPagoConfig, Preference } = require('mercadopago');

function criarApp({ db, secret = process.env.JWT_SECRET, pagamentoCliente } = {}) {
const app = express();
const JWT_SECRET = secret;
const supabase = db || criarClienteSupabase();
const { cadastro, login, autenticar } = criarAutenticacao({ db: supabase, secret: JWT_SECRET });
if (!supabase) console.warn('Configure SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY para habilitar login e cadastro seguros.');
const ADMIN_ROLES = ['admin1', 'admin2'];
const ORDER_STATUSES = ['pendente', 'aceito', 'em_preparo', 'pronto_entrega', 'recebido', 'cancelado'];
const mercadoPago = pagamentoCliente || (process.env.MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) : null);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));
// Configure somente a quantidade real de proxies controlados da hospedagem.
const proxies = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxies) && proxies > 0) app.set('trust proxy', proxies);
const limiteAuth = limitarAutenticacao();

app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Express 4 precisa encaminhar rejeições assíncronas ao middleware de erro.
const rota = (metodo, url, ...handlers) => app[metodo](url, ...handlers.map(handler =>
  (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next)));


const soAdmin = (req, res, next) => ADMIN_ROLES.includes(req.user.role) ? next() : res.status(403).json({ erro: 'Acesso exclusivo da administração.' });
const soAdmin1 = (req, res, next) => req.user.role === 'admin1' ? next() : res.status(403).json({ erro: 'O fluxo de caixa é acessível somente pelo Admin 1 (dono geral).' });
function calcularTaxaEntrega(cep) {
  const valor = String(cep || '').replace(/\D/g, '');
  if (!/^14\d{6}$/.test(valor)) throw new Error('Informe um CEP válido de Ribeirão Preto (8 números).');
  const faixa = Number(valor.slice(0, 3));
  const taxaValida = (valor) => { const taxa = Number(valor); if (!Number.isFinite(taxa) || taxa < 0) throw new Error('Taxa de entrega indisponível. Entre em contato com o restaurante.'); return Math.round(taxa * 100) / 100; };
  if (faixa >= 140 && faixa <= 142) return taxaValida(process.env.DELIVERY_FEE_CENTRO || 6);
  if (faixa >= 143 && faixa <= 145) return taxaValida(process.env.DELIVERY_FEE_BAIRROS || 8);
  if (faixa >= 146 && faixa <= 149) return taxaValida(process.env.DELIVERY_FEE_DISTANTE || 10);
  throw new Error('No momento entregamos apenas em Ribeirão Preto.');
}

rota('post', '/api/cadastro', limiteAuth, cadastro);
rota('post', '/api/login', limiteAuth, login);
rota('get', '/api/meu-perfil', autenticar, async (req, res) => {
  const { data: perfil, error } = await supabase.from('profiles').select('nome,email,telefone,role').eq('id', req.user.id).single();
  if (error || !perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' }); res.json({ perfil });
});
rota('get', '/api/taxa-entrega', autenticar, (req, res) => { try { res.json({ taxa: calcularTaxaEntrega(req.query.cep), cidade: 'Ribeirão Preto' }); } catch (error) { res.status(400).json({ erro: error.message }); } });

rota('get', '/api/produtos', autenticar, async (req, res) => { const { data, error } = await supabase.from('products').select('*').order('nome'); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('post', '/api/produtos', autenticar, soAdmin, salvarProduto);
rota('put', '/api/produtos/:id', autenticar, soAdmin, salvarProduto);
async function salvarProduto(req, res) {
  const { nome, preco, categoria, descricao, imagem_url, imagem, isEspecial } = req.body;
  if (typeof nome !== 'string' || !nome.trim() || nome.trim().length < 3 || nome.trim().length > 100 || typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0.01 || Number(preco) > 9999.99 || typeof categoria !== 'string' || !categoria.trim() || categoria.length > 80 || (descricao != null && typeof descricao !== 'string') || (isEspecial !== undefined && typeof isEspecial !== 'boolean')) return res.status(400).json({ erro: 'Informe nome (3 a 100 caracteres), categoria e preço válido.' });
  if ([imagem_url, imagem].some(url => url != null && (typeof url !== 'string' || !/^https?:\/\//i.test(url)))) return res.status(400).json({ erro: 'Informe uma URL de imagem HTTP ou HTTPS válida.' });
  const produto = { nome: nome.trim(), preco: Math.round(Number(preco) * 100) / 100, categoria: categoria.trim(), isEspecial: Boolean(isEspecial) };
  if (descricao !== undefined) produto.descricao = descricao || null;
  if (imagem_url !== undefined || imagem !== undefined) produto.imagem_url = imagem_url || imagem || null;
  const consulta = req.params.id ? supabase.from('products').update(produto).eq('id', req.params.id) : supabase.from('products').insert([produto]);
  const { data, error } = await consulta.select().single(); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.status(req.params.id ? 200 : 201).json(data);
}
rota('delete', '/api/produtos/:id', autenticar, soAdmin, async (req, res) => { const { error } = await supabase.from('products').delete().eq('id', req.params.id); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.status(204).end(); });
rota('get', '/api/fluxo-caixa', autenticar, soAdmin1, async (req, res) => { const { data, error } = await supabase.from('fluxo_caixa').select('*').order('data', { ascending: false }); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
async function salvarTransacao(req, res) {
  const { descricao, tipo, valor, data } = req.body;
  const dataValida = typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(Date.parse(data)) && new Date(data).toISOString().slice(0, 10) === data;
  if (typeof descricao !== 'string' || !descricao.trim() || descricao.length > 300 || !['receita', 'despesa', 'total-despesa-funcionario'].includes(tipo) || typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0.01 || valor > 99999999 || !dataValida) return res.status(400).json({ erro: 'Informe descrição, tipo, valor positivo e data válida.' });
  const transacao = { descricao: descricao.trim(), tipo, valor: Math.round(valor * 100) / 100, data };
  const consulta = req.params.id ? supabase.from('fluxo_caixa').update(transacao).eq('id', req.params.id) : supabase.from('fluxo_caixa').insert([transacao]);
  const { data: registro, error } = await consulta.select().single();
  if (error) return res.status(400).json({ erro: 'Não foi possível salvar a transação.' });
  res.status(req.params.id ? 200 : 201).json(registro);
}
rota('post', '/api/fluxo-caixa', autenticar, soAdmin1, salvarTransacao);
rota('put', '/api/fluxo-caixa/:id', autenticar, soAdmin1, salvarTransacao);
rota('delete', '/api/fluxo-caixa/:id', autenticar, soAdmin1, async (req, res) => { const { error } = await supabase.from('fluxo_caixa').delete().eq('id', req.params.id); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.status(204).end(); });

rota('post', '/api/pedidos', autenticar, async (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ erro: 'Pedidos devem ser feitos pela conta de cliente.' });
  const { itens, observacao_geral, endereco, numero_casa, bairro, cep, pagamento } = req.body;
  if (!Array.isArray(itens) || !itens.length || itens.length > 100 || itens.some(item => !item || !['string', 'number'].includes(typeof item.produto_id)) || new Set(itens.map(item => String(item.produto_id))).size !== itens.length) return res.status(400).json({ erro: 'Adicione ao menos um item ao carrinho.' });
  if ([endereco, numero_casa, bairro, cep].some(campo => typeof campo !== 'string' || !campo.trim() || campo.length > 250) || (observacao_geral != null && typeof observacao_geral !== 'string')) return res.status(400).json({ erro: 'Preencha rua, número, bairro e CEP para a entrega.' });
  if (pagamento !== undefined && !['a_combinar', 'site', 'whatsapp'].includes(pagamento)) return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
  let taxa; try { taxa = calcularTaxaEntrega(cep); } catch (error) { return res.status(400).json({ erro: error.message }); }
  const ids = itens.map(item => item.produto_id); const { data: produtos, error: produtosErro } = await supabase.from('products').select('id,preco').in('id', ids);
  if (produtosErro || produtos?.length !== new Set(ids).size) return res.status(400).json({ erro: 'Um produto do carrinho não está mais disponível.' });
  const mapa = new Map(produtos.map(p => [String(p.id), p])); let subtotal = 0; let itensConfirmados;
  try { itensConfirmados = itens.map(item => { const produto = mapa.get(String(item.produto_id)); const quantidade = item.quantidade; if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new Error('Quantidade inválida.'); const preco = Number(produto?.preco); if (!Number.isFinite(preco) || preco <= 0) throw new Error('Preço de produto inválido.'); subtotal += Math.round(preco * 100) * quantidade; return { produto_id: produto.id, quantidade, preco_unitario: Number(produto.preco), observacao_item: String(item.observacao_item || '').slice(0, 300) }; }); } catch (error) { return res.status(400).json({ erro: error.message }); }
  subtotal /= 100;
  const { data: pedido, error } = await supabase.from('pedidos').insert([{ usuario_id: req.user.id, valor: Math.round((subtotal + taxa) * 100) / 100, subtotal, taxa_entrega: taxa, status: 'pendente', observacao_geral: observacao_geral?.slice(0, 500) || null, endereco: endereco.trim(), numero_casa: numero_casa.trim(), bairro: bairro.trim(), cep: String(cep).replace(/\D/g, ''), pagamento: pagamento || 'a_combinar' }]).select().single();
  if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' });
  try {
    const { error: itensErro } = await supabase.from('itens_pedido').insert(itensConfirmados.map(item => ({ ...item, pedido_id: pedido.id })));
    if (itensErro) throw new Error('Itens não persistidos');
  } catch {
    const { error: rollbackErro } = await supabase.from('pedidos').delete().eq('id', pedido.id);
    if (rollbackErro) console.error('Falha ao remover pedido incompleto:', pedido.id);
    return res.status(503).json({ erro: 'Não foi possível salvar os itens do pedido. Tente novamente em instantes.' });
  }
  let payment_url = null;
  if (pagamento === 'site' && mercadoPago) {
    try {
      const preference = new Preference(mercadoPago);
      const resultado = await preference.create({ body: { external_reference: String(pedido.id), items: [{ id: String(pedido.id), title: `Pedido Delícias da Lucy #${pedido.id}`, quantity: 1, unit_price: Number(pedido.valor), currency_id: 'BRL' }] } });
      payment_url = resultado.init_point;
    } catch (pagamentoErro) { console.error('Falha ao criar checkout do pedido:', pedido.id); }
  }
  res.status(201).json({ mensagem: 'Pedido recebido.', pedido, payment_url });
});
rota('get', '/api/meus-pedidos', autenticar, async (req, res) => { const { data, error } = await supabase.from('pedidos').select('*, itens_pedido(*, products(nome))').eq('usuario_id', req.user.id).order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('get', '/api/pedidos', autenticar, soAdmin, async (req, res) => { const { data, error } = await supabase.from('pedidos').select('*, itens_pedido(*, products(nome)), profiles(nome,telefone)').order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('patch', '/api/pedidos/:id/status', autenticar, soAdmin, async (req, res) => {
  const proximo = req.body.status;
  if (!ORDER_STATUSES.includes(proximo) || proximo === 'recebido') return res.status(400).json({ erro: 'Status de pedido inválido.' });
  const { data: atual, error: erroBusca } = await supabase.from('pedidos').select('id,status').eq('id', req.params.id).single();
  if (erroBusca) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const transicoes = { pendente: ['aceito', 'cancelado'], aceito: ['em_preparo', 'cancelado'], em_preparo: ['pronto_entrega', 'cancelado'], pronto_entrega: [], recebido: [], cancelado: [] };
  if (!transicoes[atual.status]?.includes(proximo)) return res.status(400).json({ erro: 'Este status não pode ser aplicado neste momento.' });
  const alteracao = { status: proximo };
  if (proximo === 'pronto_entrega') alteracao.pronto_em = new Date().toISOString();
  const { data, error } = await supabase.from('pedidos').update(alteracao).eq('id', req.params.id).eq('status', atual.status).select().maybeSingle();
  if (error) return res.status(400).json({ erro: 'Não foi possível atualizar o pedido.' }); if (!data) return res.status(409).json({ erro: 'O pedido mudou. Atualize a página e tente novamente.' }); res.json({ pedido: data });
});
rota('post', '/api/pedidos/:id/confirmar-recebimento', autenticar, async (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ erro: 'Somente o cliente pode confirmar o recebimento.' });
  const { data: pedido, error: erroBusca } = await supabase.from('pedidos').select('id,status').eq('id', req.params.id).eq('usuario_id', req.user.id).single();
  if (erroBusca) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.status !== 'pronto_entrega') return res.status(400).json({ erro: 'Este pedido ainda não está em entrega.' });
  const { data, error } = await supabase.from('pedidos').update({ status: 'recebido', recebido_em: new Date().toISOString() }).eq('id', pedido.id).eq('status', 'pronto_entrega').select().maybeSingle();
  if (error) return res.status(400).json({ erro: 'Não foi possível atualizar o pedido.' }); if (!data) return res.status(409).json({ erro: 'O pedido mudou. Atualize a página e tente novamente.' }); res.json({ pedido: data });
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
entrada('/', 'login cliente.html');
entrada(['/login', '/login.html', '/admin/login'], 'login.html');
entrada(['/login-cliente', '/login-cliente.html', encodeURI('/login cliente.html'), '/cliente/login'], 'login cliente.html');
// O cadastro público cria somente clientes; administradores usam contas existentes.
entrada(['/cadastro', '/cadastro-cliente', '/cliente/cadastro', '/cadastro.html', '/cadastro-cliente.html', encodeURI('/cadastro cliente.html')], 'cadastro cliente.html');
rota('get', '/admin/principal', page('tela admin', 'principal.html')); rota('get', '/admin/produtos', page('tela admin', 'produtos.html')); rota('get', '/admin/fluxo-caixa', page('tela admin', 'fluxo de caixa.html')); rota('get', '/admin/meu-perfil', page('tela admin', 'meu perfil.html')); rota('get', '/cliente/principal', page('tela cliente', 'principal.html')); rota('get', '/cliente/produtos', page('tela cliente', 'Produtos.html')); rota('get', '/cliente/carrinho', page('tela cliente', 'carrino cliente.html')); rota('get', '/cliente/meu-perfil', page('tela cliente', 'meu perfil cliente.html'));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  const status = erro.type === 'entity.too.large' ? 413 : erro.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ erro: status === 400 ? 'JSON inválido.' : status === 413 ? 'Requisição muito grande.' : 'Não foi possível concluir a operação. Tente novamente.' });
});
return app;
}
if (require.main === module) criarApp().listen(process.env.PORT || 3000, () => console.log('Servidor iniciado.'));
module.exports = { criarApp };
