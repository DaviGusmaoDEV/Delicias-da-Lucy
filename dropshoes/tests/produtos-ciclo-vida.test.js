const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

test('ciclo de vida: público só lista ativos e DELETE legado apenas desativa', async t => {
  const db = bancoSimulado();
  db.tabelas.products.push({ id: 'p-inativo', nome: 'Produto inativo', preco: 9, categoria: 'outros', ativo: false });
  db.tabelas.profiles.push(
    { id: 'admin1-ciclo', email: 'admin1-ciclo@example.test', role: 'admin1' },
    { id: 'admin2-ciclo', email: 'admin2-ciclo@example.test', role: 'admin2' },
    { id: 'cliente-ciclo', email: 'cliente-ciclo@example.test', role: 'cliente' }
  );
  const secret = 'segredo-ciclo-produtos-012345678901234567890123';
  const token = (id, role) => jwt.sign({ id, role }, secret);
  const app = criarApp({ db, secret, entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.test', notificar: (_req, res) => res.sendStatus(200) } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (url, method = 'GET', body, auth) => {
    const resposta = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: resposta.status, body: await resposta.json().catch(() => null) };
  };
  const admin1 = token('admin1-ciclo', 'admin1');
  const admin2 = token('admin2-ciclo', 'admin2');
  const cliente = token('cliente-ciclo', 'cliente');

  assert.deepEqual((await req('/api/produtos')).body.map(item => item.id), ['p1']);
  assert.deepEqual((await req('/api/admin/produtos', 'GET', undefined, admin2)).body.map(item => item.id).sort(), ['p-inativo', 'p1']);
  assert.equal((await req('/api/produtos/p-inativo/adicionais')).status, 404);
  assert.equal((await req('/api/produtos/p-inativo', 'PUT', { ativo: true }, cliente)).status, 403);
  assert.equal((await req('/api/produtos/p1', 'PUT', { nome: 'Produto teste', preco: 12.35, categoria: 'outros', ativo: false }, admin2)).status, 200);
  assert.equal(db.tabelas.products.find(item => item.id === 'p1').ativo, false);
  assert.equal((await req('/api/produtos', 'GET')).body.length, 0);
  assert.equal((await req('/api/produtos/p1', 'DELETE', undefined, admin1)).status, 204);
  assert.ok(db.tabelas.products.some(item => item.id === 'p1'));
  assert.equal((await req('/api/produtos/p1', 'PUT', { nome: 'Produto teste', preco: 12.35, categoria: 'outros', ativo: true }, admin1)).status, 200);
  assert.equal((await req('/api/produtos', 'GET')).body.some(item => item.id === 'p1'), true);

  db.tabelas.products.find(item => item.id === 'p1').ativo = false;
  const pedido = await req('/api/pedidos', 'POST', {
    cliente_nome: 'Cliente Ciclo', cliente_telefone: '16999991234', itens: [{ produto_id: 'p1', quantidade: 1 }],
    endereco: 'Rua Teste', numero_casa: '1', bairro: 'Centro', cep: '14000-000', pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro',
    checkout_chave: '00000000-0000-4000-8000-000000000099'
  }, cliente);
  assert.equal(pedido.status, 400);
  assert.equal(db.tabelas.pedidos.length, 0);
});
