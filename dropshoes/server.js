const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { criarClienteSupabase } = require('./config/supabase');
const { limitarAutenticacao } = require('./middleware/limite-autenticacao');
const { protecoes, opcoesCookie, validarProducao } = require('./middleware/seguranca');
const { criarAutenticacao } = require('./config/autenticacao');

const { MercadoPagoConfig } = require('mercadopago');
const { criarPagamentos, urlCheckoutValida } = require('./services/pagamentos');
const { criarInfinitePay } = require('./services/infinitepay');
const { criarVisitantes, pedidosDoComprador, telefoneValido } = require('./services/visitantes');
const { criarEntrega } = require('./services/entrega');

function criarApp({ db, secret = process.env.JWT_SECRET, pagamentoCliente, pagamentos: pagamentosTeste, entrega: entregaTeste } = {}) {
validarProducao(secret);
const app = express();
const JWT_SECRET = secret;
const supabase = db || criarClienteSupabase();
const { cadastro, login, autenticar } = criarAutenticacao({ db: supabase, secret: JWT_SECRET });
const { registrar: registrarVisitante, autenticarCompra } = criarVisitantes({ db: supabase, secret: JWT_SECRET, autenticar });
if (!supabase) console.warn('Configure SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY para habilitar login e cadastro seguros.');
const ADMIN_ROLES = ['admin1', 'admin2'];
const ORDER_STATUSES = ['pendente', 'aceito', 'em_preparo', 'pronto_entrega', 'recebido', 'cancelado'];
const mercadoPago = pagamentoCliente || (process.env.MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) : null);
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
const entrega = entregaTeste || criarEntrega();
const pagamentos = pagamentosTeste || criarPagamentos({ cliente: mercadoPago, db: supabase });
const infinitePay = pagamentosTeste ? null : criarInfinitePay({ db: supabase });
const pagamentosAtivos = pagamentosTeste || (process.env.PAYMENT_PROVIDER === 'infinitepay' ? infinitePay : pagamentos);
rota('post', '/api/webhooks/mercadopago', pagamentos.notificar);
if (infinitePay) rota('post', '/api/webhooks/infinitepay', infinitePay.notificar);

rota('post', '/api/cadastro-cliente', limiteAuth, registrarVisitante);
rota('post', '/api/cadastro', limiteAuth, cadastro);
rota('post', '/api/login', limiteAuth, login);
rota('post', '/api/logout', (req, res) => { res.clearCookie('lucy_sessao', opcoesCookie()); res.clearCookie('lucy_visitante', opcoesCookie()); res.sendStatus(204); });
rota('get', '/api/meu-perfil', autenticarCompra, async (req, res) => {
  if (req.visitante) return res.json({ perfil: { nome: req.visitante.nome, telefone: req.visitante.telefone, cep: req.visitante.cep, role: 'visitante' } });
  const { data: perfil, error } = await supabase.from('profiles').select('nome,email,telefone,role').eq('id', req.user.id).single();
  if (error || !perfil) return res.status(404).json({ erro: 'Perfil não encontrado.' }); res.json({ perfil });
});
rota('get', '/api/taxa-entrega', limiteEntrega, async (req, res) => { try { res.json(await entrega(req.query.cep)); } catch (error) { res.status(400).json({ erro: error.message }); } });

rota('get', '/api/produtos', async (req, res) => { const { data, error } = await supabase.from('products').select('id,nome,preco,categoria,descricao,imagem_url,isEspecial').order('nome'); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('post', '/api/produtos', autenticar, soAdmin, salvarProduto);
rota('put', '/api/produtos/:id', autenticar, soAdmin, salvarProduto);
async function salvarProduto(req, res) {
  const { nome, preco, categoria, descricao, imagem_url, imagem, isEspecial } = req.body;
  if (typeof nome !== 'string' || !nome.trim() || nome.trim().length < 3 || nome.trim().length > 100 || typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0.01 || Number(preco) > 9999.99 || typeof categoria !== 'string' || !categoria.trim() || categoria.length > 80 || (descricao != null && (typeof descricao !== 'string' || descricao.length > 2000)) || (isEspecial !== undefined && typeof isEspecial !== 'boolean')) return res.status(400).json({ erro: 'Informe nome (3 a 100 caracteres), categoria e preço válido.' });
  if ([imagem_url, imagem].some(url => url != null && (typeof url !== 'string' || !/^https?:\/\//i.test(url)))) return res.status(400).json({ erro: 'Informe uma URL de imagem HTTP ou HTTPS válida.' });
  const produto = { nome: nome.trim(), preco: Math.round(Number(preco) * 100) / 100, categoria: categoria.trim(), isEspecial: Boolean(isEspecial) };
  if (descricao !== undefined) produto.descricao = descricao?.trim() || null;
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

rota('post', '/api/pedidos', limitePedidos, autenticarCompra, async (req, res) => {
  if (!['cliente', 'visitante'].includes(req.user.role)) return res.status(403).json({ erro: 'Pedidos devem ser feitos pela conta de cliente.' });
  const { itens, observacao_geral, endereco, numero_casa, bairro, cep, pagamento, checkout_chave, cliente_nome, cliente_telefone } = req.body;
  if (typeof cliente_nome !== 'string' || cliente_nome.trim().length < 2 || cliente_nome.trim().length > 100 || !telefoneValido(cliente_telefone)) return res.status(400).json({ erro: 'Informe seu nome e telefone com DDD.' });
  if (!Array.isArray(itens) || !itens.length || itens.length > 100 || itens.some(item => !item || !['string', 'number'].includes(typeof item.produto_id)) || new Set(itens.map(item => String(item.produto_id))).size !== itens.length) return res.status(400).json({ erro: 'Adicione ao menos um item ao carrinho.' });
  if ([endereco, numero_casa, bairro, cep].some(campo => typeof campo !== 'string' || !campo.trim() || campo.length > 250) || (observacao_geral != null && typeof observacao_geral !== 'string')) return res.status(400).json({ erro: 'Preencha rua, número, bairro e CEP para a entrega.' });
  if (pagamento !== 'site') return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
  if (!pagamentosAtivos?.disponivel) return res.status(503).json({ erro: 'Pagamento online indisponível. Tente novamente mais tarde.' });
  if (typeof checkout_chave !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkout_chave)) return res.status(400).json({ erro: 'Atualize o carrinho e tente novamente.' });
  const { data: existente, error: buscaErro } = await pedidosDoComprador(supabase.from('pedidos').select('*').eq('checkout_chave', checkout_chave), req.user).maybeSingle();
  if (buscaErro) return res.status(503).json({ erro: 'Não foi possível consultar seu pedido.' });
  if (existente) return responderCheckout(existente, res);
  let taxa; try { taxa = (await entrega(cep)).taxa; } catch (error) { return res.status(400).json({ erro: error.message }); }
  const ids = itens.map(item => item.produto_id); const { data: produtos, error: produtosErro } = await supabase.from('products').select('id,preco').in('id', ids);
  if (produtosErro || produtos?.length !== new Set(ids).size) return res.status(400).json({ erro: 'Um produto do carrinho não está mais disponível.' });
  const mapa = new Map(produtos.map(p => [String(p.id), p])); let subtotal = 0; let itensConfirmados;
  try { itensConfirmados = itens.map(item => { const produto = mapa.get(String(item.produto_id)); const quantidade = item.quantidade; if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new Error('Quantidade inválida.'); const preco = Number(produto?.preco); if (!Number.isFinite(preco) || preco <= 0) throw new Error('Preço de produto inválido.'); subtotal += Math.round(preco * 100) * quantidade; return { produto_id: produto.id, quantidade, preco_unitario: Number(produto.preco), observacao_item: String(item.observacao_item || '').slice(0, 300) }; }); } catch (error) { return res.status(400).json({ erro: error.message }); }
  subtotal /= 100;
  const { data: pedido, error } = await supabase.rpc('criar_pedido_com_itens', { p_pedido: { usuario_id: req.user.role === 'cliente' ? req.user.id : null, visitante_id: req.user.role === 'visitante' ? req.user.id : null, cliente_nome: cliente_nome.trim(), cliente_telefone: cliente_telefone.replace(/\D/g, ''), valor: Math.round((subtotal + taxa) * 100) / 100, subtotal, taxa_entrega: taxa, status: 'pendente', observacao_geral: observacao_geral?.slice(0, 500) || null, endereco: endereco.trim(), numero_casa: numero_casa.trim(), bairro: bairro.trim(), cep: String(cep).replace(/\D/g, ''), pagamento: 'site', checkout_chave, pagamento_status: 'pending' }, p_itens: itensConfirmados });
  if (error || !pedido) return res.status(503).json({ erro: 'Não foi possível salvar o pedido. Tente novamente.' });
  return responderCheckout(pedido, res);
});
async function responderCheckout(pedido, res) {
  if (pedido.pago_em || pedido.status === 'cancelado') return res.status(409).json({ erro: 'Este pedido já foi pago ou cancelado. Confira seus pedidos.' });
  // Não cria checkout para uma gravação incompleta ou ainda em andamento.
  const { data: itens, error: erroItens } = await supabase.from('itens_pedido').select('pedido_id').eq('pedido_id', pedido.id);
  if (erroItens || !itens?.length) return res.status(503).json({ erro: 'Seu pedido está sendo preparado para pagamento. Tente novamente.' });
  try {
    const payment_url = pedido.payment_url || await pagamentosAtivos.checkout(pedido);
    if (!urlCheckoutValida(payment_url)) throw new Error('URL de pagamento inválida');
    if (!pedido.payment_url) {
      const { error } = await supabase.from('pedidos').update({ payment_url }).eq('id', pedido.id);
      if (error) throw new Error('persistência');
    }
    return res.status(201).json({ mensagem: 'Aguardando pagamento.', pedido, payment_url });
  } catch { return res.status(503).json({ erro: 'Não foi possível abrir o pagamento. Tente novamente; seu pedido será reutilizado.' }); }
}
rota('post', '/api/pedidos/:id/pagar', limitePedidos, autenticarCompra, async (req, res) => {
  const { data: pedido, error } = await pedidosDoComprador(supabase.from('pedidos').select('*').eq('id', req.params.id), req.user).maybeSingle();
  if (error || !pedido || !['cliente', 'visitante'].includes(req.user.role) || pedido.pagamento !== 'site') return res.status(404).json({ erro: 'Pedido não encontrado.' });
  return responderCheckout(pedido, res);
});
rota('get', '/api/meus-pedidos', autenticarCompra, async (req, res) => { const { data, error } = await pedidosDoComprador(supabase.from('pedidos').select('*, itens_pedido(*, products(nome))'), req.user).order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: 'Não foi possível concluir a operação. Verifique os dados e tente novamente.' }); res.json(data); });
rota('get', '/api/pedidos', autenticar, soAdmin, async (req, res) => {
  const { data: dia, status = '', pagina = '0' } = req.query;
  if (typeof status !== 'string' || (status && !ORDER_STATUSES.includes(status)) || typeof pagina !== 'string' || !/^\d{1,5}$/.test(pagina)) return res.status(400).json({ erro: 'Filtro de pedidos inválido.' });
  let consulta = supabase.from('pedidos').select('*, itens_pedido(*, products(nome)), profiles(nome,telefone)');
  if (dia !== undefined) {
    if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia)) || new Date(dia).toISOString().slice(0, 10) !== dia) return res.status(400).json({ erro: 'Selecione uma data válida.' });
    // Turno local: 18h inclusivo até meia-noite exclusiva, em UTC-3.
    const inicio = new Date(`${dia}T18:00:00-03:00`);
    const fim = new Date(inicio.getTime() + 6 * 60 * 60 * 1000);
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
  const transicoes = { pendente: ['aceito', 'cancelado'], aceito: ['em_preparo', 'cancelado'], em_preparo: ['pronto_entrega', 'cancelado'], pronto_entrega: [], recebido: [], cancelado: [] };
  if (!transicoes[atual.status]?.includes(proximo)) return res.status(400).json({ erro: 'Este status não pode ser aplicado neste momento.' });
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
rota('get', '/', (req, res) => res.redirect('/tela cliente/Produtos.html'));
entrada(['/login', '/login.html', '/admin/login'], 'login.html');
entrada(['/login-cliente', '/login-cliente.html', encodeURI('/login cliente.html'), '/cliente/login'], 'login cliente.html');
// O cadastro público cria somente clientes; administradores usam contas existentes.
entrada(['/cadastro', '/cadastro-cliente', '/cliente/cadastro', '/cadastro.html', '/cadastro-cliente.html', encodeURI('/cadastro cliente.html')], 'cadastro cliente.html');
rota('get', '/admin/principal', page('tela admin', 'principal.html')); rota('get', '/admin/produtos', page('tela admin', 'produtos.html')); rota('get', '/admin/fluxo-caixa', page('tela admin', 'fluxo de caixa.html')); rota('get', '/admin/meu-perfil', page('tela admin', 'meu perfil.html')); rota('get', '/cliente/principal', page('tela cliente', 'principal.html')); rota('get', '/cliente/produtos', page('tela cliente', 'Produtos.html')); rota('get', '/cliente/carrinho', page('tela cliente', 'carrino cliente.html')); rota('get', '/cliente/meu-perfil', page('tela cliente', 'meu perfil cliente.html'));
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
module.exports = { criarApp };
