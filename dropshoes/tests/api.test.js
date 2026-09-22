const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

test('integração HTTP: cadastro, permissões, produtos, caixa, pedidos e erros', async t => {
  const db = bancoSimulado();
  const server = criarApp({ db, secret: 'segredo-de-integracao' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(path, method = 'GET', body, token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  }
  const cliente = { nome: 'Cliente Teste', email: 'cliente@example.test', senha: 'senha-cliente', role: 'admin1' };
  assert.equal((await req('/api/cadastro', 'POST', cliente)).status, 201);
  assert.equal((await req('/api/cadastro', 'POST', cliente)).status, 409);
  const login = await req('/api/login', 'POST', { identificador: cliente.email, senha: cliente.senha });
  assert.equal(login.status, 200); assert.equal(login.body.role, 'cliente');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const token = login.body.token;
  assert.equal((await req('/api/meu-perfil', 'GET', undefined, token)).body.perfil.email, cliente.email);
  assert.equal((await req('/api/produtos')).status, 401);
  assert.equal((await req('/api/produtos', 'POST', {}, token)).status, 403);
  assert.equal((await req('/api/pedidos', 'GET', undefined, token)).status, 403);
  const admin1 = (await req('/api/login', 'POST', { identificador: 'dona@example.test', senha: 'senha-admin', acesso: 'admin' })).body.token;
  const admin2 = (await req('/api/login', 'POST', { identificador: 'equipe@example.test', senha: 'senha-admin', acesso: 'admin' })).body.token;
  assert.equal((await req('/api/fluxo-caixa', 'GET', undefined, admin2)).status, 403);
  const transacao = { descricao: 'Venda de teste', valor: 20.5, tipo: 'receita', data: '2026-09-22' };
  const caixa = await req('/api/fluxo-caixa', 'POST', transacao, admin1);
  assert.equal(caixa.status, 201);
  assert.equal((await req(`/api/fluxo-caixa/${caixa.body.id}`, 'PUT', { ...transacao, valor: 25 }, admin1)).body.valor, 25);
  assert.equal((await req('/api/fluxo-caixa', 'POST', { ...transacao, data: '2026-02-30' }, admin1)).status, 400);
  assert.equal((await req('/api/fluxo-caixa', 'POST', { ...transacao, valor: -5 }, admin1)).status, 400);
  assert.equal((await req(`/api/fluxo-caixa/${caixa.body.id}`, 'DELETE', undefined, admin1)).status, 204);
  assert.equal((await req('/api/produtos', 'POST', { nome: {} }, admin1)).status, 400);
  assert.equal((await req('/api/produtos/p1', 'PUT', { nome: 'Produto alterado', preco: 12.35, categoria: 'outros', isEspecial: false }, admin1)).status, 200);
  assert.equal(db.tabelas.products[0].imagem_url, 'https://example.test/foto.jpg');
  const pedido = { itens: [{ produto_id: 'p1', quantidade: 3, preco_unitario: 0.01 }], endereco: 'Rua Teste', numero_casa: '1', bairro: 'Centro', cep: '14000-000', pagamento: 'whatsapp' };
  for (const dados of [{ ...pedido, endereco: [] }, { ...pedido, itens: [null] }, { ...pedido, itens: [...pedido.itens, ...pedido.itens] }, { ...pedido, pagamento: 'invalido' }]) {
    assert.equal((await req('/api/pedidos', 'POST', dados, token)).status, 400);
  }
  assert.equal((await req('/api/pedidos', 'POST', pedido, admin1)).status, 403);
  const criado = await req('/api/pedidos', 'POST', pedido, token);
  assert.equal(criado.status, 201); assert.equal(criado.body.pedido.subtotal, 37.05);
  assert.equal(criado.body.pedido.valor, 43.05);
  const id = criado.body.pedido.id;
  assert.equal((await req(`/api/pedidos/${id}/status`, 'PATCH', { status: 'recebido' }, admin1)).status, 400);
  for (const status of ['aceito', 'em_preparo', 'pronto_entrega']) assert.equal((await req(`/api/pedidos/${id}/status`, 'PATCH', { status }, admin1)).status, 200);
  db.concorrer = true;
  assert.equal((await req(`/api/pedidos/${id}/confirmar-recebimento`, 'POST', {}, token)).status, 409);
  db.concorrer = false;
  assert.equal((await req(`/api/pedidos/${id}/confirmar-recebimento`, 'POST', {}, token)).status, 200);
  assert.equal((await req('/api/meus-pedidos', 'GET', undefined, token)).body.length, 1);
  db.falhar = 'products';
  const falha = await req('/api/produtos', 'GET', undefined, token);
  assert.equal(falha.status, 500); assert.doesNotMatch(JSON.stringify(falha.body), /interna simulada/);
  const malformado = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformado.status, 400); assert.equal((await malformado.json()).erro, 'JSON inválido.');
  assert.equal((await req('/api/nao-existe')).status, 404);
  for (const path of ['/', '/login', '/cadastro-cliente', '/admin/principal', '/cliente/produtos', '/vendor/sweetalert2.js', '/vendor/sweetalert2.esm.js']) {
    const resposta = await fetch(base + path); assert.equal(resposta.status, 200, path);
  }
});
