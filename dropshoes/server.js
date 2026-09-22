const path = require('path');
require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET;
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '');
const ADMIN_ROLES = ['admin1', 'admin2'];
const ORDER_STATUSES = ['pendente', 'aceito', 'em_preparo', 'pronto_entrega', 'recebido', 'cancelado'];
const mercadoPago = process.env.MERCADOPAGO_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN }) : null;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '100kb' }));

function autenticar(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Sua sessão terminou. Entre novamente.' });
  try { req.user = jwt.verify(token, JWT_SECRET); return next(); }
  catch { return res.status(401).json({ erro: 'Sua sessão terminou. Entre novamente.' }); }
}
const soAdmin = (req, res, next) => ADMIN_ROLES.includes(req.user.role) ? next() : res.status(403).json({ erro: 'Acesso exclusivo da administração.' });
const soAdmin1 = (req, res, next) => req.user.role === 'admin1' ? next() : res.status(403).json({ erro: 'O fluxo de caixa é acessível somente pelo Admin 1 (dono geral).' });
function calcularTaxaEntrega(cep) {
  const valor = String(cep || '').replace(/\D/g, '');
  if (!/^14\d{6}$/.test(valor)) throw new Error('Informe um CEP válido de Ribeirão Preto (8 números).');
  const faixa = Number(valor.slice(0, 3));
  if (faixa >= 140 && faixa <= 142) return Number(process.env.DELIVERY_FEE_CENTRO || 6);
  if (faixa >= 143 && faixa <= 145) return Number(process.env.DELIVERY_FEE_BAIRROS || 8);
  if (faixa >= 146 && faixa <= 149) return Number(process.env.DELIVERY_FEE_DISTANTE || 10);
  throw new Error('No momento entregamos apenas em Ribeirão Preto.');
}

app.post('/api/cadastro', async (req, res) => {
  const { nome, email, telefone, senha } = req.body;
  if (!nome?.trim() || !email?.trim() || !senha || senha.length < 6) return res.status(400).json({ erro: 'Informe nome, e-mail e uma senha de pelo menos 6 caracteres.' });
  const { data: existente } = await supabase.from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (existente) return res.status(409).json({ erro: 'Este e-mail já está cadastrado. Faça login.' });
  const { data, error } = await supabase.from('profiles').insert([{ nome: nome.trim(), email: email.trim().toLowerCase(), telefone: telefone?.trim() || null, senha, role: 'cliente' }]).select('id,nome,email,role').single();
  if (error) return res.status(400).json({ erro: error.message });
  return res.status(201).json({ mensagem: 'Cadastro realizado.', usuario: data });
});
app.post('/api/login', async (req, res) => {
  const identificador = String(req.body.identificador || '').trim(); const senha = String(req.body.senha || '');
  if (!identificador || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  const coluna = identificador.includes('@') ? 'email' : 'nome';
  const { data: usuario, error } = await supabase.from('profiles').select('id,nome,senha,role').eq(coluna, identificador).maybeSingle();
  if (error || !usuario || usuario.senha !== senha) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  const role = ADMIN_ROLES.includes(usuario.role) ? usuario.role : 'cliente';
  return res.json({ token: jwt.sign({ id: usuario.id, role }, JWT_SECRET, { expiresIn: '8h' }), role, nome: usuario.nome });
});
app.get('/api/meu-perfil', autenticar, async (req, res) => {
  const { data: perfil, error } = await supabase.from('profiles').select('nome,email,telefone,role').eq('id', req.user.id).single();
  if (error) return res.status(404).json({ erro: 'Perfil não encontrado.' }); res.json({ perfil });
});
app.get('/api/taxa-entrega', autenticar, (req, res) => { try { res.json({ taxa: calcularTaxaEntrega(req.query.cep), cidade: 'Ribeirão Preto' }); } catch (error) { res.status(400).json({ erro: error.message }); } });

app.get('/api/produtos', autenticar, async (req, res) => { const { data, error } = await supabase.from('products').select('*').order('nome'); if (error) return res.status(400).json({ erro: error.message }); res.json(data); });
app.post('/api/produtos', autenticar, soAdmin, salvarProduto);
app.put('/api/produtos/:id', autenticar, soAdmin, salvarProduto);
async function salvarProduto(req, res) {
  const { nome, preco, categoria, descricao, imagem_url, imagem, isEspecial } = req.body;
  if (!nome?.trim() || nome.trim().length < 3 || nome.trim().length > 100 || !Number.isFinite(Number(preco)) || Number(preco) <= 0 || Number(preco) > 9999.99 || !categoria || String(categoria).length > 80) return res.status(400).json({ erro: 'Informe nome (3 a 100 caracteres), categoria e preço válido.' });
  const produto = { nome: nome.trim(), preco: Number(preco), categoria: categoria || null, descricao: descricao || null, imagem_url: imagem_url || imagem || null, isEspecial: Boolean(isEspecial) };
  const consulta = req.params.id ? supabase.from('products').update(produto).eq('id', req.params.id) : supabase.from('products').insert([produto]);
  const { data, error } = await consulta.select().single(); if (error) return res.status(400).json({ erro: error.message }); res.status(req.params.id ? 200 : 201).json(data);
}
app.delete('/api/produtos/:id', autenticar, soAdmin, async (req, res) => { const { error } = await supabase.from('products').delete().eq('id', req.params.id); if (error) return res.status(400).json({ erro: error.message }); res.status(204).end(); });
app.get('/api/fluxo-caixa', autenticar, soAdmin1, async (req, res) => { const { data, error } = await supabase.from('fluxo_caixa').select('*').order('data', { ascending: false }); if (error) return res.status(400).json({ erro: error.message }); res.json(data); });
app.post('/api/fluxo-caixa', autenticar, soAdmin1, async (req, res) => { const { descricao, tipo, valor, data } = req.body; const { data: nova, error } = await supabase.from('fluxo_caixa').insert([{ descricao, tipo, valor, data }]).select().single(); if (error) return res.status(400).json({ erro: error.message }); res.status(201).json(nova); });
app.delete('/api/fluxo-caixa/:id', autenticar, soAdmin1, async (req, res) => { const { error } = await supabase.from('fluxo_caixa').delete().eq('id', req.params.id); if (error) return res.status(400).json({ erro: error.message }); res.status(204).end(); });

app.post('/api/pedidos', autenticar, async (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ erro: 'Pedidos devem ser feitos pela conta de cliente.' });
  const { itens, observacao_geral, endereco, numero_casa, bairro, cep, pagamento } = req.body;
  if (!Array.isArray(itens) || !itens.length) return res.status(400).json({ erro: 'Adicione ao menos um item ao carrinho.' });
  if (!endereco?.trim() || !numero_casa?.trim() || !bairro?.trim() || !cep?.trim()) return res.status(400).json({ erro: 'Preencha rua, número, bairro e CEP para a entrega.' });
  let taxa; try { taxa = calcularTaxaEntrega(cep); } catch (error) { return res.status(400).json({ erro: error.message }); }
  const ids = itens.map(item => item.produto_id); const { data: produtos, error: produtosErro } = await supabase.from('products').select('id,preco').in('id', ids);
  if (produtosErro || produtos?.length !== new Set(ids).size) return res.status(400).json({ erro: 'Um produto do carrinho não está mais disponível.' });
  const mapa = new Map(produtos.map(p => [String(p.id), p])); let subtotal = 0; let itensConfirmados;
  try { itensConfirmados = itens.map(item => { const produto = mapa.get(String(item.produto_id)); const quantidade = Number(item.quantidade); if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) throw new Error('Quantidade inválida.'); subtotal += Number(produto.preco) * quantidade; return { produto_id: produto.id, quantidade, preco_unitario: Number(produto.preco), observacao_item: String(item.observacao_item || '').slice(0, 300) }; }); } catch (error) { return res.status(400).json({ erro: error.message }); }
  const { data: pedido, error } = await supabase.from('pedidos').insert([{ usuario_id: req.user.id, valor: subtotal + taxa, subtotal, taxa_entrega: taxa, status: 'pendente', observacao_geral: observacao_geral?.slice(0, 500) || null, endereco: endereco.trim(), numero_casa: numero_casa.trim(), bairro: bairro.trim(), cep: String(cep).replace(/\D/g, ''), pagamento: pagamento || 'a_combinar' }]).select().single();
  if (error) return res.status(400).json({ erro: error.message }); const { error: itensErro } = await supabase.from('itens_pedido').insert(itensConfirmados.map(item => ({ ...item, pedido_id: pedido.id })));
  if (itensErro) { await supabase.from('pedidos').delete().eq('id', pedido.id); return res.status(400).json({ erro: itensErro.message }); }
  let payment_url = null;
  if (pagamento === 'site' && mercadoPago) {
    try {
      const preference = new Preference(mercadoPago);
      const resultado = await preference.create({ body: { external_reference: String(pedido.id), items: [{ id: String(pedido.id), title: `Pedido Delícias da Lucy #${pedido.id}`, quantity: 1, unit_price: Number(pedido.valor), currency_id: 'BRL' }] } });
      payment_url = resultado.init_point;
    } catch (pagamentoErro) { console.error('Falha ao criar checkout:', pagamentoErro.message); }
  }
  res.status(201).json({ mensagem: 'Pedido recebido.', pedido, payment_url });
});
app.get('/api/meus-pedidos', autenticar, async (req, res) => { const { data, error } = await supabase.from('pedidos').select('*, itens_pedido(*, products(nome))').eq('usuario_id', req.user.id).order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: error.message }); res.json(data); });
app.get('/api/pedidos', autenticar, soAdmin, async (req, res) => { const { data, error } = await supabase.from('pedidos').select('*, itens_pedido(*, products(nome)), profiles(nome,telefone)').order('data_criacao', { ascending: false }); if (error) return res.status(400).json({ erro: error.message }); res.json(data); });
app.patch('/api/pedidos/:id/status', autenticar, soAdmin, async (req, res) => {
  const proximo = req.body.status;
  if (!ORDER_STATUSES.includes(proximo) || proximo === 'recebido') return res.status(400).json({ erro: 'Status de pedido inválido.' });
  const { data: atual, error: erroBusca } = await supabase.from('pedidos').select('id,status').eq('id', req.params.id).single();
  if (erroBusca) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  const transicoes = { pendente: ['aceito', 'cancelado'], aceito: ['em_preparo', 'cancelado'], em_preparo: ['pronto_entrega', 'cancelado'], pronto_entrega: [], recebido: [], cancelado: [] };
  if (!transicoes[atual.status]?.includes(proximo)) return res.status(400).json({ erro: 'Este status não pode ser aplicado neste momento.' });
  const alteracao = { status: proximo };
  if (proximo === 'pronto_entrega') alteracao.pronto_em = new Date().toISOString();
  const { data, error } = await supabase.from('pedidos').update(alteracao).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ erro: error.message }); res.json({ pedido: data });
});
app.post('/api/pedidos/:id/confirmar-recebimento', autenticar, async (req, res) => {
  if (req.user.role !== 'cliente') return res.status(403).json({ erro: 'Somente o cliente pode confirmar o recebimento.' });
  const { data: pedido, error: erroBusca } = await supabase.from('pedidos').select('id,status').eq('id', req.params.id).eq('usuario_id', req.user.id).single();
  if (erroBusca) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (pedido.status !== 'pronto_entrega') return res.status(400).json({ erro: 'Este pedido ainda não está em entrega.' });
  const { data, error } = await supabase.from('pedidos').update({ status: 'recebido', recebido_em: new Date().toISOString() }).eq('id', pedido.id).select().single();
  if (error) return res.status(400).json({ erro: error.message }); res.json({ pedido: data });
});

app.use(express.static(path.join(__dirname, 'public')));
const page = (...parts) => (req, res) => res.sendFile(path.join(__dirname, 'public', ...parts));
app.get('/', page('tela de login', 'login cliente.html')); app.get('/login', page('tela de login', 'login.html')); app.get('/login-cliente', page('tela de login', 'login cliente.html')); app.get('/cadastro', page('tela de login', 'cadastro.html')); app.get('/cadastro-cliente', page('tela de login', 'cadastro cliente.html'));
app.get('/admin/principal', page('tela admin', 'principal.html')); app.get('/admin/produtos', page('tela admin', 'produtos.html')); app.get('/admin/fluxo-caixa', page('tela admin', 'fluxo de caixa.html')); app.get('/admin/meu-perfil', page('tela admin', 'meu perfil.html')); app.get('/cliente/principal', page('tela cliente', 'principal.html')); app.get('/cliente/produtos', page('tela cliente', 'Produtos.html')); app.get('/cliente/carrinho', page('tela cliente', 'carrino cliente.html')); app.get('/cliente/meu-perfil', page('tela cliente', 'meu perfil cliente.html'));
app.listen(process.env.PORT || 3000, () => console.log('Servidor iniciado.'));
