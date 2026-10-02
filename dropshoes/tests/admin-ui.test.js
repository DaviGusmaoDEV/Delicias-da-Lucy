const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = arquivo => fs.readFileSync(path.resolve(__dirname, '../public', arquivo), 'utf8');

test('regras comerciais possui página própria, abas e associação em massa', () => {
  const html = ler('tela admin/regras comerciais.html');
  for (const id of ['painel-adicionais', 'painel-taxas', 'form-novo-adicional', 'lista-adicionais-admin', 'lista-associacoes-produtos', 'salvar-associacoes-produtos', 'form-nova-taxa', 'lista-taxas-admin', 'modal-aplicar-adicional']) assert.match(html, new RegExp(`(?:id|for)=["']${id}["']`));
  assert.match(html, /Itens adicionais/);
  assert.match(html, /Taxas de entrega/);
  assert.doesNotMatch(ler('tela admin/produtos.html'), /lista-adicionais-admin|lista-taxas-admin|form-novo-adicional|form-nova-taxa/);
  assert.match(html, /admin-regras\.js/);
  const js = ler('js/admin-regras.js');
  for (const endpoint of ['/api/admin/adicionais', '/api/admin/taxas-entrega', '/api/admin/produtos', '/api/admin/adicionais/']) assert.match(js, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(js, /perfil\.role === 'admin1'/);
  assert.match(js, /selecionar-resultados/);
  assert.match(js, /produtosVisiveis/);
  assert.match(js, /produto_ids/);
});

test('Admin exibe forma, tipo e status de pagamento separadamente', () => {
  const js = ler('js/pedidos-admin.js');
  assert.match(js, /tipo_pagamento_entrega/);
  assert.match(js, /Tipo:/);
  assert.match(js, /Status:/);
  assert.match(js, /Troco para:/);
  assert.match(js, /Levar troco:/);
});

test('ciclo de vida do produto usa status textual e não exclusão física na UI', () => {
  const html = ler('tela admin/produtos.html');
  const js = ler('js/produtos.js');
  assert.match(html, /status-produto/);
  assert.match(js, /alternarAtivo/);
  assert.match(js, /produto\.ativo === false \? 'Reativar' : 'Desativar'/);
  assert.doesNotMatch(js, /method:\s*['"]DELETE['"]/);
});

test('formulário de produto oferece prévia, troca e remoção segura de imagem', () => {
  const html = ler('tela admin/produtos.html');
  const js = ler('js/produtos.js');
  for (const id of ['prod-imagem', 'prod-imagem-preview', 'btn-remover-imagem', 'prod-imagem-especial', 'prod-imagem-preview-especial', 'btn-remover-imagem-especial']) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /accept=["']image\/jpeg,image\/png,image\/webp["']/i);
  assert.match(js, /\/api\/admin\/produtos\/\$\{encodeURIComponent\(id\)\}\/imagem/);
  assert.match(js, /FormData/);
  assert.match(js, /produto salvo, mas não foi possível enviar a imagem/i);
});

test('estilos do painel adaptam cards e controles para telas pequenas', () => {
  const css = ler('css/style.css');
  assert.match(css, /\.painel-regras-comerciais/);
  assert.match(css, /\.regra-card/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /\.opcao-adicional-admin[^}]*min-height:\s*48px/s);
});
