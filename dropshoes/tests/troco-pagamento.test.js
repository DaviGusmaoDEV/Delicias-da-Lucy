const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

test('troco é opcional, autoritativo e exclusivo de dinheiro na entrega', async t => {
  const db = bancoSimulado();
  db.tabelas.profiles.push({ id: 'cliente-troco', email: 'cliente-troco@example.test', role: 'cliente' });
  const secret = 'segredo-troco-pagamento-012345678901234567890123';
  const app = criarApp({ db, secret, entrega: async () => ({ taxa: 6 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const token = jwt.sign({ id: 'cliente-troco', role: 'cliente' }, secret);
  const base = `http://127.0.0.1:${server.address().port}`;
  const corpo = (alteracoes = {}) => ({ cliente_nome: 'Cliente Troco', cliente_telefone: '16999991234', endereco: 'Rua Teste', numero_casa: '1', bairro: 'Centro', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro', itens: [{ produto_id: 'p1', quantidade: 3 }], ...alteracoes });
  const req = async (body, chave) => {
    const resposta = await fetch(base + '/api/pedidos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, checkout_chave: chave }) });
    return { status: resposta.status, body: await resposta.json().catch(() => null) };
  };
  const dinheiroExato = await req(corpo({ troco_para: 43.05 }), '00000000-0000-4000-8000-000000001001');
  assert.equal(dinheiroExato.status, 201);
  assert.equal(dinheiroExato.body.pedido.troco_para, 43.05);
  const dinheiroSemTroco = await req(corpo(), '00000000-0000-4000-8000-000000001002');
  assert.equal(dinheiroSemTroco.status, 201);
  assert.equal(dinheiroSemTroco.body.pedido.troco_para, null);
  const dinheiroValido = await req(corpo({ troco_para: 100 }), '00000000-0000-4000-8000-000000001003');
  assert.equal(dinheiroValido.status, 201);
  assert.equal(dinheiroValido.body.pedido.troco_para, 100);
  for (const [troco, chave] of [[30, '00000000-0000-4000-8000-000000001004'], [-1, '00000000-0000-4000-8000-000000001005'], ['R$ 100,00', '00000000-0000-4000-8000-000000001006'], [100.001, '00000000-0000-4000-8000-000000001007']]) {
    assert.equal((await req(corpo({ troco_para: troco }), chave)).status, 400);
  }
  const cartao = await req(corpo({ tipo_pagamento_entrega: 'cartao', troco_para: 100 }), '00000000-0000-4000-8000-000000001008');
  assert.equal(cartao.status, 201);
  assert.equal(cartao.body.pedido.troco_para, null);
  const online = await req(corpo({ pagamento: 'site', tipo_pagamento_entrega: 'dinheiro', troco_para: 100, provedor_pagamento: 'infinitepay' }), '00000000-0000-4000-8000-000000001009');
  assert.equal(online.status, 201);
  assert.equal(online.body.pedido.troco_para, null);
  assert.equal(db.tabelas.pedidos.length, 5);
});
