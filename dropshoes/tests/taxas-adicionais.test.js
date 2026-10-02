const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarEntrega, normalizarBairro } = require('../services/entrega');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');
const { once } = require('node:events');

function respostaCep(bairro) {
  return { ok: true, json: async () => ({ city: 'Ribeirão Preto', state: 'SP', street: 'Rua Teste', neighborhood: bairro }) };
}

test('normalização de bairro é determinística, sem fuzzy matching', () => {
  assert.equal(normalizarBairro(' Vila  Tibério '), 'vila tiberio');
  assert.equal(normalizarBairro('VILA TIBÉRIO'), 'vila tiberio');
  assert.notEqual(normalizarBairro('Vila Tibério'), normalizarBairro('Vila Virgínia'));
});

test('bairro oficial do CEP vence bairro adulterado pelo navegador', async () => {
  const entrega = criarEntrega({
    precoKm: 2,
    buscarTaxaBairro: async ({ chaveNormalizada }) => chaveNormalizada === 'vila virginia' ? { nome: 'Vila Virgínia', taxa: 10 } : null,
    consultar: async url => url.includes('brasilapi') ? respostaCep('Vila Virgínia') : (() => { throw new Error('rota não deveria ser consultada'); })()
  });
  const resultado = await entrega('14000-000', { bairro: 'Ipiranga', endereco: 'Rua Teste', numero_casa: '10' });
  assert.equal(resultado.taxa, 10);
  assert.equal(resultado.tipo, 'bairro');
  assert.equal(resultado.bairro, 'Vila Virgínia');
});

test('bairro não cadastrado e taxa inativa preservam fallback por distância', async () => {
  let rotas = 0;
  const entrega = criarEntrega({
    precoKm: 2,
    buscarTaxaBairro: async () => null,
    consultar: async url => {
      if (url.includes('brasilapi')) return respostaCep('Bairro Novo');
      if (url.includes('nominatim')) return { ok: true, json: async () => [{ lon: '-47.81', lat: '-21.14' }] };
      rotas++;
      return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: 3000 }] }) };
    }
  });
  const resultado = await entrega('14000-000', { bairro: 'Ipiranga', endereco: 'Rua Teste', numero_casa: '10' });
  assert.equal(resultado.tipo, 'distancia');
  assert.equal(resultado.taxa, 2);
  assert.equal(rotas, 1);
});

test('pedido reconstrói adicionais, ignora preços enviados e aceita produto repetido com combinações diferentes', async t => {
  const db = bancoSimulado();
  db.tabelas.adicionais.push(
    { id: 'a1', nome: 'Cheddar', preco: 5, ativo: true },
    { id: 'a2', nome: 'Ketchup', preco: 0.5, ativo: true },
    { id: 'a3', nome: 'Ovo', preco: 3, ativo: true },
    { id: 'inativo', nome: 'Inativo', preco: 2, ativo: false }
  );
  db.tabelas.produto_adicionais.push(
    { produto_id: 'p1', adicional_id: 'a1', ativo: true },
    { produto_id: 'p1', adicional_id: 'a2', ativo: true },
    { produto_id: 'p1', adicional_id: 'a3', ativo: true },
    { produto_id: 'p1', adicional_id: 'inativo', ativo: true }
  );
  const server = criarApp({ db, secret: 'segredo-adicionais-012345678901234567890123', entrega: async () => ({ taxa: 7, tipo: 'bairro', bairro: 'Ipiranga' }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (url, method, body, token) => {
    const resposta = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: resposta.status, body: await resposta.json().catch(() => null) };
  };
  const cadastro = await req('/api/cadastro', 'POST', { nome: 'Cliente', email: 'adicionais@example.test', senha: 'senha-segura' });
  assert.equal(cadastro.status, 201);
  const login = await req('/api/login', 'POST', { identificador: 'adicionais@example.test', senha: 'senha-segura' });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const corpo = {
    cliente_nome: 'Cliente', cliente_telefone: '16999991234', endereco: 'Rua Teste', numero_casa: '10', bairro: 'Ipiranga', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro',
    checkout_chave: '00000000-0000-4000-8000-000000009001', taxa_entrega: 0, subtotal: 0, valor: 0,
    itens: [
      { produto_id: 'p1', quantidade: 2, adicionais_ids: ['a1', 'a2'], preco_unitario: 0.01 },
      { produto_id: 'p1', quantidade: 1, adicionais_ids: ['a3'], preco_unitario: 0.01 }
    ]
  };
  const criado = await req('/api/pedidos', 'POST', corpo, token);
  assert.equal(criado.status, 201);
  assert.equal(criado.body.pedido.subtotal, 51.05); // (12,35 + 5 + 0,50)*2 + (12,35 + 3)
  assert.equal(criado.body.pedido.valor, 58.05);
  assert.equal(db.tabelas.itens_pedido[0].preco_unitario, 17.85);
  assert.equal(db.tabelas.itens_pedido[0].preco_base_unitario, 12.35);
  assert.deepEqual(db.tabelas.itens_pedido[0].adicionais_snapshot.map(item => item.nome), ['Cheddar', 'Ketchup']);
  const divergente = await req('/api/pedidos', 'POST', { ...corpo, checkout_chave: '00000000-0000-4000-8000-000000009099', subtotal_esperado: 0 }, token);
  assert.equal(divergente.status, 409);
  assert.match(divergente.body.erro, /preços foram atualizados/i);
});

test('adicional inexistente, inativo, não associado e duplicado são rejeitados', async t => {
  const db = bancoSimulado();
  db.tabelas.adicionais.push({ id: 'a1', nome: 'Cheddar', preco: 5, ativo: true }, { id: 'off', nome: 'Off', preco: 1, ativo: false });
  db.tabelas.produto_adicionais.push({ produto_id: 'p1', adicional_id: 'a1', ativo: true });
  const server = criarApp({ db, secret: 'segredo-adicionais-2-012345678901234567890123', entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (body, token) => { const r = await fetch(base + '/api/pedidos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); return r.status; };
  const cadastro = await fetch(base + '/api/cadastro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Cliente', email: 'adicionais2@example.test', senha: 'senha-segura' }) });
  assert.equal(cadastro.status, 201);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identificador: 'adicionais2@example.test', senha: 'senha-segura' }) });
  const token = (await login.json()).token;
  const basePedido = { cliente_nome: 'Cliente', cliente_telefone: '16999991234', endereco: 'Rua', numero_casa: '1', bairro: 'Centro', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro', itens: [{ produto_id: 'p1', quantidade: 1 }], taxa_entrega: 0 };
  for (const adicionais_ids of [['missing'], ['off'], ['a1', 'a1']]) {
    assert.equal(await req({ ...basePedido, adicionais_ids: undefined, itens: [{ produto_id: 'p1', quantidade: 1, adicionais_ids }], checkout_chave: `00000000-0000-4000-8000-000000009${String(adicionais_ids.length).padStart(2, '0')}` }, token), 400);
  }
});

test('API de adicionais retorna somente associações e registros ativos', async t => {
  const db = bancoSimulado();
  db.tabelas.adicionais.push(
    { id: 'a1', nome: 'Cheddar', preco: 5, ativo: true },
    { id: 'off', nome: 'Inativo', preco: 2, ativo: false },
    { id: 'outro', nome: 'Outro produto', preco: 3, ativo: true }
  );
  db.tabelas.produto_adicionais.push(
    { produto_id: 'p1', adicional_id: 'a1', ativo: true },
    { produto_id: 'p1', adicional_id: 'off', ativo: true },
    { produto_id: 'p1', adicional_id: 'outro', ativo: false }
  );
  const server = criarApp({ db, secret: 'segredo-api-adicionais-012345678901234567890123', entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/produtos/p1/adicionais`);
  assert.equal(resposta.status, 200);
  assert.deepEqual((await resposta.json()).map(item => item.nome), ['Cheddar']);
});
