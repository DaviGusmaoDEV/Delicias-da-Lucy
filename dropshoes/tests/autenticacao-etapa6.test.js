const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');
const jwt = require('jsonwebtoken');

const segredo = 'segredo-exclusivo-dos-testes-etapa6-0123456789';

async function servidor(t) {
  const app = criarApp({ db: bancoSimulado(), secret: segredo, pagamentos: { disponivel: false } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const cookie = resposta => resposta.headers.get('set-cookie').split(';')[0];

test('páginas administrativas diretas exigem sessão administrativa no servidor', async t => {
  const base = await servidor(t);
  const resposta = await fetch(`${base}/tela admin/principal.html`, { redirect: 'manual' });
  assert.equal(resposta.status, 302);
  assert.equal(resposta.headers.get('location'), '/login');
});

test('matriz de autorização diferencia visitante, cliente, admin2 e admin1', async t => {
  const base = await servidor(t);
  const paginas = ['/admin/principal', '/admin/dashboard', '/admin/pedidos clientes.html', '/admin/produtos', '/admin/regras-comerciais', '/admin/meu-perfil'];
  const caixa = '/admin/fluxo-caixa';
  for (const caminho of [...paginas, caixa]) {
    const resposta = await fetch(`${base}${caminho}`, { redirect: 'manual' });
    assert.equal(resposta.status, 302);
    assert.equal(resposta.headers.get('location'), '/login');
  }
  const visitante = await fetch(`${base}/api/cadastro-cliente`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Visitante', telefone: '16999991234', cep: '14060040' })
  });
  const cookieVisitante = cookie(visitante);
  const bloqueadoVisitante = await fetch(`${base}/admin/principal`, { headers: { Cookie: cookieVisitante }, redirect: 'manual' });
  assert.equal(bloqueadoVisitante.status, 302);
  assert.equal(bloqueadoVisitante.headers.get('location'), '/login');

  async function login(identificador) {
    return fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie' },
      body: JSON.stringify({ identificador, senha: 'senha-admin', acesso: 'admin' })
    });
  }
  const admin2 = await login('equipe@example.test');
  const admin2Principal = await fetch(`${base}/admin/principal`, { headers: { Cookie: cookie(admin2) } });
  assert.equal(admin2Principal.status, 200);
  const admin2Caixa = await fetch(`${base}${caixa}`, { headers: { Cookie: cookie(admin2) }, redirect: 'manual' });
  assert.equal(admin2Caixa.status, 302);
  assert.equal(admin2Caixa.headers.get('location'), '/admin/principal');
  const admin1 = await login('dona@example.test');
  const admin1Caixa = await fetch(`${base}${caixa}`, { headers: { Cookie: cookie(admin1) } });
  assert.equal(admin1Caixa.status, 200);
});

test('matriz de telas preserva entradas públicas e login separado', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const publico = path.resolve(__dirname, '../public');
  const cliente = fs.readFileSync(path.join(publico, 'tela de login/login cliente.html'), 'utf8');
  const admin = fs.readFileSync(path.join(publico, 'tela de login/login.html'), 'utf8');
  assert.match(cliente, /id=["']identificador["']/);
  assert.doesNotMatch(cliente, /data-acesso=["']admin["']/);
  assert.match(admin, /id=["']identificador["']/);
  assert.match(admin, /data-acesso=["']admin["']/);
  for (const html of [cliente, admin]) {
    assert.match(html, /autocomplete=["']username["']/);
    assert.match(html, /autocomplete=["']current-password["']/);
    assert.match(html, /data-mostrar-senha/);
    assert.match(html, /Entrando\.\.\./);
  }
  const cadastro = fs.readFileSync(path.join(publico, 'tela de login/cadastro cliente.html'), 'utf8');
  assert.match(cadastro, /autocomplete=["']new-password["']/);
  assert.match(cadastro, /aria-describedby=["']senha-ajuda["']/);
  assert.match(cadastro, /data-mostrar-senha/);
});

test('login, logout, sessão inválida e autorização de API permanecem separados', async t => {
  const base = await servidor(t);
  const cadastro = await fetch(`${base}/api/cadastro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Cliente Etapa 6', email: 'cliente-etapa6@example.test', senha: 'senha-cliente' })
  });
  assert.equal(cadastro.status, 201);
  const loginInvalido = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identificador: 'cliente-etapa6@example.test', senha: 'senha-errada' })
  });
  assert.equal(loginInvalido.status, 401);
  const login = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie' },
    body: JSON.stringify({ identificador: 'cliente-etapa6@example.test', senha: 'senha-cliente' })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.clone().json()).token, undefined);
  const sessao = cookie(login);
  assert.equal((await fetch(`${base}/api/meu-perfil`, { headers: { Cookie: sessao } })).status, 200);
  assert.equal((await fetch(`${base}/api/fluxo-caixa`, { headers: { Cookie: sessao } })).status, 403);
  const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: sessao } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await fetch(`${base}/api/meu-perfil`)).status, 401);
  assert.equal((await fetch(`${base}/api/meu-perfil`, { headers: { Authorization: 'Bearer token.invalido' } })).status, 401);
  const expirado = jwt.sign({ id: 'admin2', role: 'admin2' }, segredo, { expiresIn: -1 });
  assert.equal((await fetch(`${base}/api/meu-perfil`, { headers: { Authorization: `Bearer ${expirado}` } })).status, 401);
  const roleForjada = jwt.sign({ id: 'admin2', role: 'admin1' }, segredo);
  assert.equal((await fetch(`${base}/api/fluxo-caixa`, { headers: { Authorization: `Bearer ${roleForjada}` } })).status, 403);
});
