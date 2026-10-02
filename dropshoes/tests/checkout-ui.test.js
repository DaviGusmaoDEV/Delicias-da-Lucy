const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLICO = path.resolve(__dirname, '../public');
const ler = caminho => fs.readFileSync(path.join(PUBLICO, caminho), 'utf8');

test('checkout preserva IDs, resumo, campos obrigatórios e providers existentes', () => {
  const html = ler('tela cliente/carrino cliente.html');
  for (const id of [
    'itens-carrinho', 'carrinho-vazio-mensagem', 'link-cardapio-vazio', 'observacao-geral',
    'cliente-nome', 'cliente-telefone', 'endereco', 'numero-casa', 'bairro', 'cep',
    'btn-calcular-frete', 'info-frete', 'cart-subtotal', 'cart-frete', 'cart-total', 'btn-finalizar-pedido',
    'template-item-carrinho', 'erro-cliente-nome', 'erro-cliente-telefone', 'erro-endereco',
    'erro-numero-casa', 'erro-bairro', 'erro-cep'
  ]) assert.match(html, new RegExp(`\\bid=["']${id}["']`, 'i'), `ID ausente: ${id}`);
  for (const valor of ['mercadopago_pix', 'infinitepay', 'entrega']) {
    assert.match(html, new RegExp(`<input\\b(?=[^>]*name=["']provedor-pagamento["'])(?=[^>]*value=["']${valor}["'])[^>]*>`, 'i'));
  }
  assert.match(html, /<label[^>]*for=["']cep["'][^>]*>\s*CEP\s*<\/label>/i);
  assert.match(html, /id=["']cep["'][^>]*autocomplete=["']postal-code["'][^>]*inputmode=["']numeric["']/i);
  assert.match(html, /id=["']btn-finalizar-pedido["']/i);
});

test('checkout oferece tipo de pagamento acessível somente para entrega', () => {
  const html = ler('tela cliente/carrino cliente.html');
  assert.match(html, /id=["']tipo-pagamento-entrega["'][^>]*hidden/);
  assert.match(html, /Como você deseja pagar na entrega\?/);
  assert.match(html, /name=["']tipo-pagamento-entrega["'][^>]*value=["']dinheiro["']/);
  assert.match(html, /name=["']tipo-pagamento-entrega["'][^>]*value=["']cartao["']/);
  assert.match(html, /id=["']tipo-pagamento-entrega["'][^>]*tabindex=["']-1["']/);
  assert.match(html, /id=["']troco-pagamento["'][^>]*inputmode=["']decimal["']/);
  assert.match(html, /for=["']troco-pagamento["'][^>]*>Troco para quantos R\$\?<\/label>/);
  const js = ler('js/carrinho.js');
  assert.match(js, /Escolha se o pagamento na entrega será em dinheiro ou cartão/);
  assert.match(js, /tipo_pagamento_entrega/);
  assert.match(js, /opcao\.checked = false/);
  assert.match(js, /troco_para/);
  assert.match(js, /tipo === 'dinheiro'/);
  assert.match(js, /parseMoedaBrasileira/);
});

test('template do checkout oferece quantidade, subtotal do item e remoção com nomes contextuais', () => {
  const html = ler('tela cliente/carrino cliente.html');
  for (const classe of ['carrinho-item-nome', 'carrinho-item-detalhes', 'carrinho-item-qtd', 'carrinho-item-total', 'btn-qtd-menos', 'btn-qtd-mais', 'btn-remover-item']) {
    assert.match(html, new RegExp(`class=["'][^"']*\\b${classe}\\b`, 'i'), `classe ausente: ${classe}`);
  }
  assert.match(html, /carrinho-item-adicionais/);
  assert.match(html, /aria-label=["']Diminuir quantidade/i);
  assert.match(html, /aria-label=["']Aumentar quantidade/i);
  assert.match(html, />\s*Remover\s*</i);
});

test('carrinho mantém remoção, erros associados e proteção visual contra envio duplicado', () => {
  const js = ler('js/carrinho.js');
  assert.match(js, /function\s+removerItem\s*\(/);
  assert.match(js, /btn-remover-item/);
  assert.match(js, /aria-label.*\$\{item\.nome\}/s);
  assert.match(js, /aria-invalid/);
  assert.match(js, /form-error/);
  assert.match(js, /finalizando\s*=\s*true/);
  assert.match(js, /aria-busy/);
  assert.match(js, /Processando pedido/);
  assert.match(js, /cart-subtotal/);
  assert.match(js, /cart-frete/);
  assert.match(js, /cart-total/);
  assert.match(js, /adicionais_ids/);
  assert.match(js, /identidadeItem/);
});

test('CSS do checkout prioriza leitura, toque, seleção perceptível e layout sem overflow', () => {
  const css = ler('css/style.css');
  assert.match(css, /\.pagina-carrinho\s+\.checkout-shell\s*\{/);
  assert.match(css, /\.pagina-carrinho\s+\.btn-controle-qtd\s*\{[^}]*width:\s*48px[^}]*min-height:\s*48px/s);
  assert.match(css, /\.pagina-carrinho\s+\.btn-remover-item\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.pagina-carrinho\s+\.opcao-pagamento-pix:has\(input:checked\)/);
  assert.match(css, /\.pagina-carrinho\s+\.opcao-tipo-pagamento:has\(input:checked\)/);
  assert.match(css, /\.pagina-carrinho\s+\.tipo-pagamento-entrega\[hidden\]/);
  assert.match(css, /\.pagina-carrinho\s+\.resumo-linha\.total\s+strong/);
  assert.match(css, /\.pagina-carrinho\s+\.btn-finalizar\s*\{[^}]*min-height:\s*56px/s);
  assert.match(css, /\.pagina-carrinho\s+\.form-control\[aria-invalid="true"\]/);
  assert.doesNotMatch(css, /\.pagina-carrinho[^}]*overflow-x\s*:\s*hidden/i);
});

test('checkout vazio oferece retorno textual ao cardápio', () => {
  const html = ler('tela cliente/carrino cliente.html');
  assert.match(html, /Seu carrinho está vazio/i);
  assert.match(html, /id=["']link-cardapio-vazio["'][^>]*>\s*Ver cardápio\s*</i);
});
