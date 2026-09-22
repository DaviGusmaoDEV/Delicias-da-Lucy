const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

test('cadastro abre diretamente nas rotas públicas e carrega seus recursos', async t => {
  const server = criarApp({ db: bancoSimulado(), secret: 'segredo-de-teste' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const rota of ['/cadastro', '/cadastro/', '/cadastro-cliente', '/cadastro-cliente/', '/cliente/cadastro', '/cadastro.html', '/cadastro-cliente.html', '/cadastro%20cliente.html', '/tela%20de%20login/cadastro%20cliente.html']) {
    const resposta = await fetch(base + rota, { redirect: 'manual' });
    assert.equal(resposta.status, 200, rota);
    assert.match(resposta.headers.get('content-type'), /text\/html/, rota);
    const html = await resposta.text();
    assert.match(html, /id="form-cadastro-cliente"/, rota);
    assert.match(html, /src="\/js\/cadastro.js"/, rota);
    assert.doesNotMatch(html, /Cannot GET/, rota);
  }
  for (const recurso of ['/js/cadastro.js', '/js/formularios.js', '/css/style.css']) {
    assert.equal((await fetch(base + recurso)).status, 200, recurso);
  }
  const login = await (await fetch(base + '/login-cliente')).text();
  assert.match(login, /href="\/cadastro-cliente"/);
  const cadastro = await fetch(base + '/api/cadastro', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Teste Rotas', email: 'rotas@example.test', senha: 'senha-de-teste' })
  });
  assert.equal(cadastro.status, 201);
  assert.equal((await cadastro.json()).usuario.role, 'cliente');
});
