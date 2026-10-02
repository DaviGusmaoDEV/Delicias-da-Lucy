const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

const ler = arquivo => fs.readFileSync(path.join(__dirname, '../public', arquivo), 'utf8');

async function servidorComEscolhas(t, grupos = []) {
  const db = bancoSimulado();
  db.tabelas.produto_grupos_escolha.push(...grupos);
  db.tabelas.produto_opcoes_escolha.push(
    { id: 'e1', grupo_id: 'g1', nome: 'Presunto', ativo: true, ordem: 0 },
    { id: 'e2', grupo_id: 'g1', nome: 'Mussarela', ativo: true, ordem: 1 },
    { id: 'e3', grupo_id: 'g1', nome: 'Bacon', ativo: true, ordem: 2 },
    { id: 'off', grupo_id: 'g1', nome: 'Inativa', ativo: false, ordem: 3 },
    { id: 'outro', grupo_id: 'g2', nome: 'Outro produto', ativo: true, ordem: 0 }
  );
  db.tabelas.produto_grupos_escolha.push({ id: 'g2', produto_id: 'p2', nome: 'Outro', min_escolhas: 0, max_escolhas: 1, ativo: true, ordem: 0 });
  db.tabelas.products.push({ id: 'p2', nome: 'Outro', preco: 10, ativo: true }, { id: 'p3', nome: 'Sem escolhas', preco: 10, ativo: true });
  const app = criarApp({ db, secret: 'segredo-escolhas-012345678901234567890123', entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (url, method = 'GET', body, token) => {
    const resposta = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: resposta.status, body: await resposta.json().catch(() => null) };
  };
  const email = `escolhas-${Date.now()}@example.test`;
  await req('/api/cadastro', 'POST', { nome: 'Cliente', email, senha: 'senha-segura' });
  const login = await req('/api/login', 'POST', { identificador: email, senha: 'senha-segura' });
  return { db, req, token: login.body?.token };
}

test('produto sem escolhas continua sem opções e produto configurado retorna grupos ativos', async t => {
  const { req } = await servidorComEscolhas(t, [{ id: 'g1', produto_id: 'p1', nome: 'Ingredientes', min_escolhas: 1, max_escolhas: 2, ativo: true, ordem: 0 }]);
  const escolhas = await req('/api/produtos/p1/escolhas');
  assert.equal(escolhas.status, 200);
  assert.equal(escolhas.body[0].nome, 'Ingredientes');
  assert.deepEqual(escolhas.body[0].opcoes.map(opcao => opcao.nome), ['Bacon', 'Mussarela', 'Presunto']);
  const vazio = await req('/api/produtos/p3/escolhas');
  assert.deepEqual(vazio.body, []);
});

test('pedido valida min/max, produto/grupo/opção e mantém escolhas no snapshot sem alterar preço', async t => {
  const { db, req, token } = await servidorComEscolhas(t, [{ id: 'g1', produto_id: 'p1', nome: 'Ingredientes', min_escolhas: 1, max_escolhas: 2, ativo: true, ordem: 0 }]);
  const base = { cliente_nome: 'Cliente', cliente_telefone: '16999991234', endereco: 'Rua Teste', numero_casa: '10', bairro: 'Ipiranga', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro', taxa_entrega: 0 };
  const criar = escolhas => req('/api/pedidos', 'POST', { ...base, checkout_chave: `00000000-0000-4000-8000-${String(Math.random()).slice(2, 14).padEnd(12, '0')}`, itens: [{ produto_id: 'p1', quantidade: 1, escolhas_ids: escolhas, adicionais_ids: [] }] }, token);
  assert.equal((await criar([])).status, 400);
  assert.equal((await criar(['e1', 'e2', 'e3'])).status, 400);
  assert.equal((await criar(['off'])).status, 400);
  assert.equal((await criar(['outro'])).status, 400);
  assert.equal((await criar(['e1', 'e1'])).status, 400);
  const criado = await req('/api/pedidos', 'POST', { ...base, checkout_chave: '00000000-0000-4000-8000-000000000001', itens: [{ produto_id: 'p1', quantidade: 1, escolhas_ids: ['e1', 'e2'], escolhas_snapshot: [{ id: 'e1', nome: 'NOME ADULTERADO', grupo_nome: 'GRUPO ADULTERADO' }], adicionais_ids: [] }] }, token);
  assert.equal(criado.status, 201);
  assert.equal(criado.body.pedido.subtotal, 12.35);
  assert.deepEqual(db.tabelas.itens_pedido[0].escolhas_snapshot.map(escolha => escolha.nome), ['Presunto', 'Mussarela']);
  assert.equal(db.tabelas.itens_pedido[0].preco_adicionais_unitario, 0);
});

test('dois grupos contam separadamente e grupo opcional aceita zero escolhas', async t => {
  const { db, req, token } = await servidorComEscolhas(t, [
    { id: 'g1', produto_id: 'p1', nome: 'Ingredientes', min_escolhas: 1, max_escolhas: 2, ativo: true, ordem: 0 },
    { id: 'g3', produto_id: 'p1', nome: 'Molhos', min_escolhas: 0, max_escolhas: 1, ativo: true, ordem: 1 },
    { id: 'g4', produto_id: 'p1', nome: 'Obrigatório', min_escolhas: 1, max_escolhas: 1, ativo: true, ordem: 2 }
  ]);
  db.tabelas.produto_opcoes_escolha.push({ id: 'e4', grupo_id: 'g4', nome: 'Ovo', ativo: true, ordem: 0 });
  const base = { cliente_nome: 'Cliente', cliente_telefone: '16999991234', endereco: 'Rua Teste', numero_casa: '10', bairro: 'Ipiranga', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'cartao', taxa_entrega: 0, subtotal_esperado: 12.35 };
  const pedido = await req('/api/pedidos', 'POST', { ...base, checkout_chave: '00000000-0000-4000-8000-000000000098', itens: [{ produto_id: 'p1', quantidade: 1, escolhas_ids: ['e1', 'e4'], adicionais_ids: [] }] }, token);
  assert.equal(pedido.status, 201);
  assert.deepEqual(db.tabelas.itens_pedido[0].escolhas_snapshot.map(escolha => escolha.nome), ['Presunto', 'Ovo']);
});

test('migration reconstrói snapshot e preserva campos comerciais da RPC vigente', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/migration-escolhas-incluidas-produto.sql'), 'utf8');
  assert.match(sql, /opcao_encontrada\s*:=\s*found/);
  assert.match(sql, /jsonb_array_elements\(coalesce\(item->'escolhas_ids'/);
  assert.match(sql, /jsonb_build_object\(\s*'id', opcao_id[\s\S]*'nome', opcao_nome[\s\S]*'grupo_nome', grupo_nome/);
  assert.doesNotMatch(sql, /item->'escolhas_snapshot'/);
  assert.match(sql, /tipo_pagamento_entrega, troco_para, checkout_chave, pagamento_status/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /numero_pedido/); // preservado pelo default e pelo RETURNING * da tabela pedidos.
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
});

test('duas configurações do mesmo produto permanecem em linhas separadas', async t => {
  const { db, req, token } = await servidorComEscolhas(t, [{ id: 'g1', produto_id: 'p1', nome: 'Ingredientes', min_escolhas: 1, max_escolhas: 2, ativo: true, ordem: 0 }]);
  const pedido = await req('/api/pedidos', 'POST', {
    cliente_nome: 'Cliente', cliente_telefone: '16999991234', endereco: 'Rua Teste', numero_casa: '10', bairro: 'Ipiranga', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'cartao', taxa_entrega: 0,
    checkout_chave: '00000000-0000-4000-8000-000000000099',
    itens: [
      { produto_id: 'p1', quantidade: 1, escolhas_ids: ['e1'], adicionais_ids: [] },
      { produto_id: 'p1', quantidade: 1, escolhas_ids: ['e2'], adicionais_ids: [] }
    ]
  }, token);
  assert.equal(pedido.status, 201);
  assert.equal(db.tabelas.itens_pedido.length, 2);
  assert.deepEqual(db.tabelas.itens_pedido.map(item => item.escolhas_snapshot[0].id), ['e1', 'e2']);
});

test('identidade do carrinho considera escolhas, e bilhete/perfil preservam separação dos conceitos', () => {
  const carrinho = ler('js/carrinho.js');
  assert.match(carrinho, /identidadeItem[\s\S]*escolhas/);
  assert.match(carrinho, /escolhas_ids/);
  const perfil = ler('js/perfil.js');
  assert.match(perfil, /Escolhas incluídas/);
  const admin = ler('js/pedidos-admin.js');
  assert.match(admin, /Escolhas:/);
  assert.match(admin, /Adicionais:/);
  const bilhete = ler('js/bilhete.js');
  assert.match(bilhete, /ESCOLHAS:/);
  assert.match(bilhete, /ADICIONAIS:/);
  assert.match(bilhete, /OBSERVAÇÃO:/);
});

test('contratos de cliente e Admin expõem a configuração sem alterar identificadores existentes', () => {
  const cardapio = ler('tela cliente/Produtos.html');
  const carrinho = ler('tela cliente/carrino cliente.html');
  const admin = ler('tela admin/produtos.html');
  for (const texto of ['seletor-escolhas-incluidas', 'lista-escolhas-incluidas', 'contador-escolhas']) assert.match(cardapio, new RegExp(texto));
  assert.match(carrinho, /carrinho-item-escolhas/);
  assert.match(admin, /editor-escolhas-produto/);
  assert.match(admin, /adicionar-opcao-escolha/);
});
