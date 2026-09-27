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

test('InfinitePay usa a resposta oficial url e envia o payload documentado', async () => {
  let chamada;
  const consultar = async (url, opcoes) => {
    chamada = { url, opcoes };
    return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://checkout.infinitepay.com.br/link-oficial' }) };
  };
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  const url = await pagamentos.checkout({ id: 'pedido-2', valor: 32.5 });
  assert.equal(url, 'https://checkout.infinitepay.com.br/link-oficial');
  assert.equal(chamada.url, 'https://api.checkout.infinitepay.io/links');
  assert.equal(chamada.opcoes.method, 'POST');
  const payload = JSON.parse(chamada.opcoes.body);
  assert.deepEqual(payload.items, [{ quantity: 1, price: 3250, description: 'Pedido Delícias da Lucy #pedido-2' }]);
  assert.equal(payload.order_nsu, 'pedido-2');
  assert.equal(payload.redirect_url, 'https://dropshoes.social.br/tela%20cliente/meu%20perfil%20cliente.html');
  assert.equal(payload.webhook_url, 'https://dropshoes.social.br/api/webhooks/infinitepay');
});

test('InfinitePay rejeita resposta sem url oficial', async () => {
  const registros = [];
  const anterior = console.error;
  console.error = mensagem => registros.push(JSON.parse(mensagem));
  const consultar = async () => ({ ok: true, status: 200, json: async () => ({ checkout_url: 'https://checkout.infinitepay.com.br/nao-documentado' }) });
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  try { await assert.rejects(() => pagamentos.checkout({ id: 'pedido-3', valor: 10 }), /indisponível/); }
  finally { console.error = anterior; }
  assert.equal(registros[0].resultado, 'resposta_sem_url');
  assert.deepEqual(registros[0].propriedades, ['checkout_url']);
});

test('InfinitePay registra erro HTTP sem expor corpo sensível', async () => {
  const registros = [];
  const anterior = console.error;
  console.error = mensagem => registros.push(JSON.parse(mensagem));
  const consultar = async () => ({ ok: false, status: 422, json: async () => ({ code: 'invalid_items', message: 'Itens inválidos', token: 'não deve aparecer' }) });
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  try { await assert.rejects(() => pagamentos.checkout({ id: 'pedido-4', valor: 10 }), /indisponível/); }
  finally { console.error = anterior; }
  assert.equal(registros[0].resultado, 'falha');
  assert.equal(registros[0].status_http, 422);
  assert.equal(registros[0].codigo, 'invalid_items');
  assert.equal(registros[0].mensagem, 'Itens inválidos');
  assert.equal(registros[0].corpo.token, undefined);
});

test('InfinitePay não confirma valor diferente ou notificação incompleta', async () => {
  const consultar = async url => ({ ok: true, json: async () => url.endsWith('/payment_check') ? { success: true, paid: true, amount: 1999 } : { url: 'https://checkout.infinitepay.com.br/abc' } });
  const pagamentos = criarInfinitePay({ db: banco(), handle: 'lucy', urlPublica: 'https://dropshoes.social.br', consultar });
  let resposta = { statusCode: 0, json: () => {}, status(codigo) { resposta.statusCode = codigo; return this; } };
  await pagamentos.notificar({ body: {} }, resposta); assert.equal(resposta.statusCode, 400);
  await pagamentos.notificar({ body: { order_nsu: 'pedido-1', transaction_nsu: 't', invoice_slug: 's' } }, resposta); assert.equal(resposta.statusCode, 422);
});
