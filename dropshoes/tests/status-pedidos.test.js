const { test } = require('node:test');
const assert = require('node:assert/strict');

async function status() {
  return import('../public/js/status-pedidos.mjs');
}

test('cliente novo não tem pedido atual nem histórico', async () => {
  const { pedidoNoHistorico } = await status();
  assert.equal(pedidoNoHistorico(undefined), false);
  assert.equal(pedidoNoHistorico({}), false);
});

test('pedido entregue e estados finais de pagamento pertencem ao histórico', async () => {
  const { pedidoNoHistorico } = await status();
  for (const pedido of [
    { status: 'recebido', pagamento_status: 'approved' },
    { status: 'pendente', pagamento_status: 'rejected' },
    { status: 'pendente', pagamento_status: 'cancelled' },
    { status: 'pendente', pagamento_status: 'refunded' },
    { status: 'pendente', pagamento_status: 'charged_back' }
  ]) assert.equal(pedidoNoHistorico(pedido), true);
  assert.equal(pedidoNoHistorico({ status: 'em_preparo', pagamento_status: 'approved' }), false);
});

test('status desconhecido não vira automaticamente pendente', async () => {
  const { statusPedido, textoPagamento } = await status();
  assert.match(statusPedido('novo_status')[0], /novo_status/);
  assert.match(textoPagamento('novo_pagamento'), /novo_pagamento/);
});
