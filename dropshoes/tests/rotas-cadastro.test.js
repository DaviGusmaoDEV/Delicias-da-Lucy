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
  for (const rota of ['/cadastro', '/cadastro/', '/cadastro-cliente', '/cadastro-cliente/', '/cliente/cadastro', '/cliente/cadastro/', '/cadastro.html', '/cadastro-cliente.html', '/cadastro%20cliente.html', '/tela%20de%20login/cadastro%20cliente.html']) {
    const resposta = await fetch(base + rota, { redirect: 'follow' });
    assert.equal(resposta.status, 200, rota);
    assert.match(resposta.headers.get('content-type'), /text\/html/, rota);
    const html = await resposta.text();
    await verificarRecursosELinks(resposta.url, html);
    assert.match(html, /id="form-cadastro-cliente"/, rota);
    assert.match(html, /src="\.\.\/js\/cadastro.js"/, rota);
    assert.doesNotMatch(html, /Cannot GET/, rota);
  }
  for (const recurso of ['/js/cadastro.js', '/js/formularios.js', '/css/style.css']) {
    assert.equal((await fetch(base + recurso)).status, 200, recurso);
  }
  const login = await (await fetch(base + '/login-cliente')).text();
  assert.match(login, /href="\.\.\/tela de login\/cadastro cliente\.html"/);
  const cadastro = await fetch(base + '/api/cadastro', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Teste Rotas', email: 'rotas@example.test', senha: 'senha-de-teste' })
  });
  assert.equal(cadastro.status, 201);
  assert.equal((await cadastro.json()).usuario.role, 'cliente');
});

test('rotas de login com e sem extensão abrem a tela correta', async t => {
  const server = criarApp({ db: bancoSimulado(), secret: 'segredo-de-teste' }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const grupos = [
    { admin: true, rotas: ['/login', '/login/', '/login.html', '/admin/login', '/admin/login/', '/tela%20admin/login.html', '/tela%20de%20login/login.html'] },
    { admin: false, rotas: ['/login-cliente', '/login-cliente/', '/login-cliente.html', '/login%20cliente.html', '/cliente/login', '/cliente/login/', '/tela%20de%20login/login%20cliente.html'] }
  ];
  for (const grupo of grupos) {
    for (const rota of grupo.rotas) {
      const resposta = await fetch(base + rota, { redirect: 'follow' });
      assert.equal(resposta.status, 200, rota);
      assert.match(resposta.headers.get('content-type'), /text\/html/, rota);
      const html = await resposta.text();
      await verificarRecursosELinks(resposta.url, html);
      assert.match(html, /id="form-login"/, rota);
      assert.match(html, /src="\.\.\/js\/login.js"/, rota);
      assert.equal(html.includes('data-acesso="admin"'), grupo.admin, rota);
      assert.doesNotMatch(html, /Cannot GET/, rota);
      if (!grupo.admin) assert.match(html, /href="\.\.\/tela de login\/cadastro cliente\.html"/, rota);
    }
  }
  assert.equal((await fetch(base + '/js/login.js')).status, 200);
});

// Resolve referências a partir da URL final, como o navegador faz. Isso detecta
// recursos que existem na raiz, mas quebram em aliases com barra final.
async function verificarRecursosELinks(url, html) {
  for (const [, atributo, referencia] of html.matchAll(/(href|src)="([^"]+)"/g)) {
    if (/^(https?:|#)/.test(referencia)) continue;
    assert.ok(!referencia.includes('%20'), referencia);
    const destino = new URL(referencia, url);
    const resposta = await fetch(destino);
    assert.equal(resposta.status, 200, `${url}: ${atributo}=${referencia}`);
    if (destino.pathname.endsWith('.css')) assert.match(resposta.headers.get('content-type'), /text\/css/);
    if (destino.pathname.endsWith('.js')) assert.match(resposta.headers.get('content-type'), /javascript/);
    if (destino.pathname.endsWith('.html')) assert.match(resposta.headers.get('content-type'), /text\/html/);
  }
}
