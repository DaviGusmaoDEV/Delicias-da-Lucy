import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('public');
const html = fs.readFileSync(path.join(root, 'tela cliente', 'pagamento pix.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'pagamento-pix.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'pagamento-pix.css'), 'utf8');

test('tela Pix preserva os contratos de dados e apresenta copia e cola', () => {
  for (const id of ['pix-pedido', 'pix-total', 'pix-pendente', 'pix-conteudo', 'pix-qr', 'pix-copiar', 'pix-feedback', 'pix-expira', 'pix-finalizado', 'pix-finalizado-titulo', 'pix-finalizado-texto', 'pix-novo', 'pix-erro']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `ID protegido ausente: ${id}`);
  }
  assert.match(html, /id=["']pix-copia-cola["']/);
  assert.match(html, /readonly/);
  assert.match(html, /Copiar código Pix/);
  assert.match(html, /Abra o aplicativo do seu banco/);
  assert.match(html, /aria-live=["']polite["']/);
});

test('tela Pix mantém rotas, parâmetro técnico e estados reais', () => {
  assert.match(js, /params\.get\(['"]pedido['"]\)/);
  assert.match(js, /\/api\/pedidos\/\$\{encodeURIComponent\(pedidoId\)\}\/pagamento/);
  assert.match(js, /\/api\/pedidos\/\$\{encodeURIComponent\(pedidoId\)\}\/pagamento-status/);
  assert.match(js, /\/api\/pedidos\/\$\{encodeURIComponent\(pedidoId\)\}\/pagar/);
  assert.match(js, /rotuloPedido/);
  assert.match(js, /pagamento\.qr_code/);
  assert.match(js, /pagamento\.qr_code_base64/);
  assert.match(js, /setInterval\(.*5000/s);
  for (const status of ['approved', 'cancelled', 'rejected', 'refunded']) assert.match(js, new RegExp(status));
});

test('apresentação Pix prevê fallback de cópia e leitura responsiva', () => {
  assert.match(js, /navigator\.clipboard/);
  assert.match(js, /\.select\(\)/);
  assert.match(js, /setSelectionRange/);
  assert.match(css, /\.pix-qr/);
  assert.match(css, /min-height:\s*(?:48px|3rem)/);
  assert.match(css, /pix-copia-cola/);
  assert.match(css, /@media\s*\(max-width:\s*(?:360px|30rem)\)/);
});
