const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLICO = path.resolve(__dirname, '../public');
const ler = caminho => fs.readFileSync(path.join(PUBLICO, caminho), 'utf8');
const html = ler('tela cliente/meu perfil cliente.html');
const js = ler('js/perfil.js');
const sessao = ler('js/sessao.js');
const css = ler('css/pedidos.css');

test('perfil preserva IDs funcionais e cria âncoras explícitas', () => {
  for (const id of ['boas-vindas-usuario', 'user-nome', 'user-email', 'user-fone', 'painel-cliente-pedidos', 'pedidos-em-andamento', 'meus-pedidos']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id=["']meu-perfil["']/);
  assert.match(html, /href=["']#meu-perfil["']/);
  assert.match(html, /href=["']#meus-pedidos["']/);
  assert.match(html, /aria-live=["']polite["']/);
});

test('perfil mantém endpoints, número comercial e confirmação existentes', () => {
  assert.match(sessao, /\/api\/meu-perfil/);
  assert.match(js, /\/api\/meus-pedidos/);
  assert.match(js, /\/api\/pedidos\/\$\{encodeURIComponent\(id\)\}\/confirmar-recebimento/);
  assert.match(js, /rotuloPedido\(pedido\)/);
  assert.match(js, /statusPedido\(pedido\.status\)/);
  assert.match(js, /textoPagamento\(pedido\.pagamento_status\)/);
  assert.match(js, /pedidoNoHistorico\(pedido\)/);
  assert.match(js, /window\.setInterval\(atualizar, 30000\)/);
  assert.doesNotMatch(js, /subtotal\(\)|taxa_entrega\s*\+/);
});

test('perfil apresenta detalhes, estados e ações com texto acessível', () => {
  for (const texto of ['Itens do pedido', 'Pagamento', 'Total', 'Confirmar que recebi o pedido', 'Continuar pagamento', 'Carregando pedidos']) {
    assert.match(js, new RegExp(texto));
  }
  assert.match(js, /window\.confirm\(['"]Confirma que recebeu este pedido\?/);
  assert.match(js, /aria-busy/);
  assert.match(css, /\.pedido-resumo/);
  assert.match(css, /\.pedido-itens/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(html, /<table\b/i);
});

test('perfil diferencia o tipo de pagamento na entrega sem inventar histórico', () => {
  assert.match(js, /tipo_pagamento_entrega/);
  assert.match(js, /Pagar na entrega/);
  assert.match(js, /Dinheiro/);
  assert.match(js, /Cartão/);
  assert.match(js, /Pagar na entrega\$\{tipo \?/);
  assert.match(js, /Troco para/);
});
