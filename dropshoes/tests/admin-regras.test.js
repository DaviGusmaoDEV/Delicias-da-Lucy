const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');
const { once } = require('node:events');

test('regras comerciais: Admin 1 escreve e Admin 2/cliente apenas consultam', async t => {
  const db = bancoSimulado();
  db.tabelas.profiles.push(
    { id: 'dono-regras', nome: 'Dona', email: 'dona-regras@example.test', role: 'admin1' },
    { id: 'equipe-regras', nome: 'Equipe', email: 'equipe-regras@example.test', role: 'admin2' },
    { id: 'cliente-regras', nome: 'Cliente', email: 'cliente-regras@example.test', role: 'cliente' }
  );
  const secret = 'segredo-admin-regras-012345678901234567890123';
  const token = role => jwt.sign({ id: role === 'admin1' ? 'dono-regras' : role === 'admin2' ? 'equipe-regras' : 'cliente-regras', role }, secret);
  const app = criarApp({ db, secret, entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.infinitepay.io/teste', notificar: (_req, res) => res.sendStatus(200) } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (url, method, body, role) => { const resposta = await fetch(base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token(role)}` }, body: body ? JSON.stringify(body) : undefined }); return { status: resposta.status, body: await resposta.json().catch(() => null) }; };
  assert.equal((await req('/api/admin/adicionais', 'GET', undefined, 'admin2')).status, 200);
  assert.equal((await req('/api/admin/adicionais', 'POST', { nome: 'Cheddar', preco: 5, ativo: true }, 'admin2')).status, 403);
  assert.equal((await req('/api/admin/adicionais', 'POST', { nome: 'Cheddar', preco: 5, ativo: true }, 'cliente')).status, 403);
  const criado = await req('/api/admin/adicionais', 'POST', { nome: 'Cheddar', preco: 5, ativo: true }, 'admin1');
  assert.equal(criado.status, 201);
  assert.equal((await req(`/api/admin/adicionais/${criado.body.id}`, 'PATCH', { preco: -1 }, 'admin1')).status, 400);
  assert.equal((await req(`/api/admin/adicionais/${criado.body.id}`, 'PATCH', { preco: 6, ativo: false }, 'admin1')).status, 200);
  const assoc = await req('/api/admin/produtos/p1/adicionais', 'GET', undefined, 'admin2');
  assert.equal(assoc.status, 200);
  assert.equal((await req('/api/admin/produtos/p1/adicionais', 'PUT', { adicional_ids: [criado.body.id] }, 'admin2')).status, 403);
  assert.equal((await req('/api/admin/produtos/p1/adicionais', 'PUT', { adicional_ids: [criado.body.id] }, 'admin1')).status, 200);
  const taxa = await req('/api/admin/taxas-entrega', 'POST', { nome: 'Vila Tibério', cidade: 'Ribeirão Preto', uf: 'sp', taxa: 7, ativo: true }, 'admin1');
  assert.equal(taxa.status, 201);
  assert.equal(db.tabelas.delivery_bairro_taxas.at(-1).chave_normalizada, 'vila tiberio');
  assert.equal((await req('/api/admin/taxas-entrega', 'POST', { nome: 'Vila Tibério', cidade: 'Ribeirão Preto', uf: 'SP', taxa: -1, ativo: true }, 'admin1')).status, 400);
});
