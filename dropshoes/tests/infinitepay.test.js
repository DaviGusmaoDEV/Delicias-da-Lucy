const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarInfinitePay, urlCheckoutValida } = require('../services/infinitepay');

function banco() {
  const pedidos = [{ id: 'pedido-1', valor: 20, pagamento: 'site' }];
  return {
    pedidos,
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: pedidos[0], error: null }) }; },
    rpc: async (nome, dados) => ({ nome, dados, error: null })
  };
}

test('InfinitePay valida checkout, cria link em centavos e confirma pelo payment_check', async () => {
  assert.equal(urlCheckoutValida('https://checkout.infinitepay.com.br/abc'), true);
  assert.equal(urlCheckoutValida('https://checkout.infinitepay.io/abc'), true);
  assert.equal(urlCheckoutValida('https://invasor.example/abc'), false);
  const chamadas = [];
  const consultar = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return { ok: true, json: async () => url.endsWith('/links') ? { url: 'https://checkout.infinitepay.com.br/abc' } : { success: true, paid: true, amount: 2000 } };
  };
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  assert.equal(pagamentos.disponivel, true);
  const url = await pagamentos.checkout({ id: 'pedido-1', valor: 20 });
  assert.equal(url, 'https://checkout.infinitepay.com.br/abc');
  const body = chamadas[0].opcoes.body; assert.match(body, /"price":2000/); assert.match(body, /"order_nsu":"pedido-1"/);
  let resposta = { statusCode: 0, json: valor => { resposta.body = valor; }, status(codigo) { resposta.statusCode = codigo; return this; } };
  await pagamentos.notificar({ body: { order_nsu: 'pedido-1', transaction_nsu: 'trans-1', invoice_slug: 'slug-1' } }, resposta);
  assert.equal(resposta.statusCode, 200);
});

test('InfinitePay não confirma valor diferente ou notificação incompleta', async () => {
  const consultar = async url => ({ ok: true, json: async () => url.endsWith('/payment_check') ? { success: true, paid: true, amount: 1999 } : { url: 'https://checkout.infinitepay.com.br/abc' } });
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  let resposta = { statusCode: 0, json: () => {}, status(codigo) { resposta.statusCode = codigo; return this; } };
  await pagamentos.notificar({ body: {} }, resposta); assert.equal(resposta.statusCode, 400);
  await pagamentos.notificar({ body: { order_nsu: 'pedido-1', transaction_nsu: 't', invoice_slug: 's' } }, resposta); assert.equal(resposta.statusCode, 422);
});
