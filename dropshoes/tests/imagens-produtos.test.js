const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');
const sharp = require('sharp');

function armazenamentoTeste() {
  const arquivos = new Map();
  const bucket = {
    async upload(caminho, conteudo) { arquivos.set(caminho, Buffer.from(conteudo)); return { data: { path: caminho }, error: null }; },
    getPublicUrl(caminho) { return { data: { publicUrl: `https://storage.test/storage/v1/object/public/produtos/${caminho}` } }; },
    async remove(caminhos) { caminhos.forEach(caminho => arquivos.delete(caminho)); return { data: null, error: null }; }
  };
  return { arquivos, from: () => bucket };
}

async function multipart(base, id, arquivo, token) {
  const form = new FormData();
  form.append('imagem', new Blob([arquivo.conteudo], { type: arquivo.tipo }), arquivo.nome);
  const resposta = await fetch(`${base}/api/admin/produtos/${id}/imagem`, { method: 'POST', body: form, headers: { authorization: `Bearer ${token}` } });
  return { status: resposta.status, body: await resposta.json().catch(() => null) };
}

test('imagens de produtos: upload otimizado, mesmo ID, troca segura e remoção', async t => {
  const db = bancoSimulado();
  const storage = armazenamentoTeste();
  const secret = 'segredo-imagem-produto-012345678901234567890123';
  const app = criarApp({ db, secret, storage, entrega: async () => ({ taxa: 0 }), pagamentos: { disponivel: true, checkout: async () => 'https://checkout.test', notificar: (_req, res) => res.sendStatus(200) } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = jwt.sign({ id: 'admin1', role: 'admin1' }, secret);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 80, b: 50 } } }).png().toBuffer();
  const semTroca = await fetch(`${base}/api/produtos/p1`, { method: 'PUT', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Produto teste', preco: 12.35, categoria: 'outros' }) });
  assert.equal(semTroca.status, 200);
  assert.equal(db.tabelas.products.find(item => item.id === 'p1').imagem_url, 'https://example.test/foto.jpg');
  const enviado = await multipart(base, 'p1', { nome: 'produto.png', tipo: 'image/png', conteudo: png }, admin);
  assert.equal(enviado.status, 200);
  assert.equal(enviado.body.id, 'p1');
  assert.match(enviado.body.imagem_url, /storage\.test\/storage\/v1\/object\/public\/produtos\/p1\/.+\.webp$/);
  assert.equal(db.tabelas.products.find(item => item.id === 'p1').id, 'p1');
  assert.ok([...storage.arquivos.values()][0].length > 0);
  db.tabelas.products.find(item => item.id === 'p1').imagem_url = enviado.body.imagem_url;
  const removido = await fetch(`${base}/api/admin/produtos/p1/imagem`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } });
  const removidoBody = await removido.json();
  assert.equal(removido.status, 200);
  assert.equal(removidoBody.imagem_url, null);
  assert.equal(db.tabelas.products.find(item => item.id === 'p1').nome, 'Produto teste');
});

test('imagens de produtos: acesso, MIME e limite são protegidos sem Storage real', async t => {
  const db = bancoSimulado();
  const storage = armazenamentoTeste();
  db.tabelas.profiles.push({ id: 'cliente', email: 'cliente@example.test', role: 'cliente' });
  const secret = 'segredo-imagem-validacao-012345678901234567890123';
  const app = criarApp({ db, secret, storage });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cliente = jwt.sign({ id: 'cliente', role: 'cliente' }, secret);
  const respostaCliente = await multipart(base, 'p1', { nome: 'foto.png', tipo: 'image/png', conteudo: Buffer.from('x') }, cliente);
  assert.equal(respostaCliente.status, 403);
  const admin = jwt.sign({ id: 'admin2', role: 'admin2' }, secret);
  const tipoInvalido = await multipart(base, 'p1', { nome: 'foto.txt', tipo: 'text/plain', conteudo: Buffer.from('x') }, admin);
  assert.equal(tipoInvalido.status, 400);
  assert.match(tipoInvalido.body.erro, /Formato de imagem/);
  const muitoGrande = await multipart(base, 'p1', { nome: 'foto.png', tipo: 'image/png', conteudo: Buffer.alloc(10 * 1024 * 1024 + 1) }, admin);
  assert.equal(muitoGrande.status, 413);
  assert.match(muitoGrande.body.erro, /até 10 MB/);
});
