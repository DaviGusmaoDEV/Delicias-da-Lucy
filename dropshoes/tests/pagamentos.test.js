const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { criarPagamentos, assinaturaValida, statusPagamento } = require('../services/pagamentos');
const { bancoSimulado } = require('./banco-simulado');

const segredo = 'segredo-webhook-teste';
function requisicao(id = 'ORD-123', evento = 'evt-1') {
  const ts = '1704908010'; const requestId = 'request-teste';
  const hash = createHmac('sha256', segredo).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  const headers = { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${hash}` };
  return { query: { 'data.id': id }, body: { id: evento, type: 'order', action: 'order.updated', data: { id } }, get: nome => headers[nome] };
}
function resposta() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, sendStatus(n) { this.statusCode = n; return this; } }; }

test('assinatura usa query assinada e rejeita dados adulterados', () => {
  const req = requisicao();
  assert.equal(assinaturaValida(req, segredo), true);
  assert.equal(assinaturaValida(req, ''), false);
  req.query['data.id'] = 'ORD-124'; assert.equal(assinaturaValida(req, segredo), false);
  req.query['data.id'] = ['ORD-123']; assert.equal(assinaturaValida(req, segredo), false);
});

test('Mercado Pago fica indisponível sem Access Token e sem webhook secret', () => {
  assert.equal(criarPagamentos({ db: bancoSimulado(), accessToken: '', segredo }).disponivel, false);
  assert.equal(criarPagamentos({ db: bancoSimulado(), accessToken: 'token-de-teste', segredo: '' }).disponivel, false);
});

test('Orders API cria Pix com valor do servidor e idempotência', async () => {
  const db = bancoSimulado(); const chamadas = [];
  db.tabelas.pedidos.push({ id: 'pedido1', valor: 20 });
  const fetcher = async (url, options) => {
    chamadas.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ id: 'ORD01TEST1', status: 'action_required', transactions: { payments: [{ id: 'PAY-1', status: 'action_required', amount: '20.00', payment_method: { id: 'pix', type: 'bank_transfer', ticket_url: 'https://www.mercadopago.com.br/pix/1', qr_code: '000201teste', qr_code_base64: 'aW1hZ2Vt' } }] } }) };
  };
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  const dados = await servico.checkout({ id: 'pedido1', valor: 20, cliente_email: 'cliente@example.test' });
  assert.equal(chamadas[0].url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(chamadas[0].options.headers.Authorization, 'Bearer token-de-teste');
  assert.equal(chamadas[0].options.headers['X-Idempotency-Key'], 'pedido-pedido1-pix');
  const corpo = JSON.parse(chamadas[0].options.body);
  assert.deepEqual(corpo.transactions.payments[0].payment_method, { id: 'pix', type: 'bank_transfer' });
  assert.equal(corpo.total_amount, '20.00'); assert.equal(corpo.external_reference, 'pedido1');
  assert.equal(dados.qr_code, '000201teste'); assert.equal(dados.status, 'pending');
  assert.equal(db.tabelas.pedidos[0].pagamento_order_id, 'ORD01TEST1');
  assert.equal(dados.order_id, db.tabelas.pedidos[0].pagamento_order_id);
  const retomado = await servico.checkout(db.tabelas.pedidos[0]);
  assert.equal(retomado.order_id, 'ORD01TEST1');
  assert.equal(chamadas.length, 1);
});

test('visitante pode criar Pix sem informar e-mail usando o payer técnico do backend', async () => {
  const db = bancoSimulado(); let corpo;
  db.tabelas.pedidos.push({ id: 'pedido-visitante', valor: 20 });
  const fetcher = async (_url, options) => { corpo = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ id: 'ORD-GUEST', status: 'action_required', transactions: { payments: [{ id: 'PAY-GUEST', amount: '20.00', payment_method: { id: 'pix', type: 'bank_transfer', qr_code: 'pix', qr_code_base64: 'base64' } }] } }) }; };
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, payerEmail: 'pagamentos@example.test', fetcher });
  await servico.checkout({ id: 'pedido-visitante', valor: 20 });
  assert.equal(corpo.payer.email, 'pagamentos@example.test');
});

test('visitante pode criar Pix sem configuração adicional de e-mail', async () => {
  const db = bancoSimulado(); let corpo;
  db.tabelas.pedidos.push({ id: 'pedido-visitante-2', valor: 20 });
  const fetcher = async (_url, options) => { corpo = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ id: 'ORD-GUEST-2', status: 'action_required', transactions: { payments: [{ id: 'PAY-GUEST-2', amount: '20.00', payment_method: { id: 'pix', type: 'bank_transfer', qr_code: 'pix', qr_code_base64: 'base64' } }] } }) }; };
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  await servico.checkout({ id: 'pedido-visitante-2', valor: 20 });
  assert.match(corpo.payer.email, /^pedido-pedido-visitante-2@/);
});

test('webhook Orders consulta a Order, valida valor e registra a confirmação', async () => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20, pagamento: 'site', pagamento_provedor: 'mercadopago_pix' });
  const registros = []; db.rpc = async (nome, dados) => { registros.push({ nome, dados }); return { error: null }; };
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'ORD-123', external_reference: 'pedido1', status: 'processed', transactions: { payments: [{ id: 'PAY-123', amount: '20.00', status: 'processed', date_last_updated: '2026-09-23T12:00:00Z', date_approved: '2026-09-23T12:00:00Z', payment_method: { id: 'pix' } }] } }) });
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  const res = resposta(); await servico.notificar(requisicao(), res);
  assert.equal(res.statusCode, 200); assert.equal(registros[0].dados.p_pagamento_id, 'mercadopago:PAY-123'); assert.equal(registros[0].dados.p_status, 'approved');
});

test('webhook não registra confirmação quando valor retornado diverge', async () => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20, pagamento: 'site' });
  let chamou = false; db.rpc = async () => { chamou = true; return { error: null }; };
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'ORD-123', external_reference: 'pedido1', status: 'processed', transactions: { payments: [{ id: 'PAY-123', amount: '19.99', status: 'processed' }] } }) });
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher }); const res = resposta(); await servico.notificar(requisicao(), res);
  assert.equal(res.statusCode, 422); assert.equal(chamou, false);
});

test('Orders API rejeita resposta sem QR Code sem expor o corpo recebido', async () => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20 });
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher: async () => ({ ok: true, status: 201, json: async () => ({ id: 'ORD01TEST1', status: 'action_required', segredo: 'não registrar' }) }) });
  await assert.rejects(() => servico.checkout({ id: 'pedido1', valor: 20, cliente_email: 'cliente@example.test' }), /não retornou os dados do Pix/);
  assert.equal(db.tabelas.pedidos[0].pagamento_order_id, 'ORD01TEST1');
});

test('webhook repetido é reconhecido antes de aplicar qualquer efeito novamente', async () => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20, pagamento: 'site' });
  let chamadasRpc = 0; db.rpc = async () => { chamadasRpc++; return { error: null }; };
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'ORD-123', external_reference: 'pedido1', status: 'processed', transactions: { payments: [{ id: 'PAY-123', amount: '20.00', status: 'processed' }] } }) });
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  await servico.notificar(requisicao(), resposta()); await servico.notificar(requisicao(), resposta());
  assert.equal(chamadasRpc, 1);
});

test('reconciliação consulta somente a Order existente e confirma uma única receita', async () => {
  const db = bancoSimulado();
  const pedido = { id: 68, valor: 8.63, pagamento: 'site', pagamento_provedor: 'mercadopago_pix', pagamento_id: 'mercadopago:PAY-68', pagamento_order_id: 'ORD01TEST68', pagamento_status: 'pending', status: 'pendente' };
  db.tabelas.pedidos.push(pedido);
  const chamadas = [];
  db.rpc = async (nome, dados) => {
    assert.equal(nome, 'registrar_pagamento_pedido');
    chamadas.push(dados);
    pedido.pagamento_status = dados.p_status;
    pedido.pago_em ||= dados.p_aprovado || dados.p_atualizado;
    if (!db.tabelas.fluxo_caixa.some(item => item.pedido_id === '68' && item.tipo === 'receita')) {
      db.tabelas.fluxo_caixa.push({ id: 1, pedido_id: '68', tipo: 'receita', valor: dados.p_valor });
    }
    return { error: null };
  };
  const order = { id: 'ORD01TEST68', external_reference: '68', total_amount: '8.63', total_paid_amount: '8.63', status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY-68', amount: '8.63', status: 'processed', status_detail: 'accredited', payment_method: { id: 'pix', type: 'bank_transfer' }, date_last_updated: '2026-09-29T17:00:00Z' }] } };
  const fetcher = async (url, options) => { chamadas.push({ url, options }); return { ok: true, status: 200, json: async () => order }; };
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  const primeira = await servico.reconciliar('68');
  const segunda = await servico.reconciliar('68');
  const webhookPosterior = resposta();
  await servico.notificar(requisicao(order.id, 'evt-posterior'), webhookPosterior);
  assert.deepEqual(primeira, { pedido_id: 68, payment_status: 'approved', order_status: 'pendente', financeiro_registrado: true });
  assert.deepEqual(segunda, primeira);
  assert.equal(webhookPosterior.statusCode, 200);
  assert.equal(chamadas.filter(item => item.url).length, 3);
  assert.ok(chamadas.filter(item => item.url).every(item => item.options.method === 'GET' && item.url.endsWith('/v1/orders/ORD01TEST68')));
  assert.equal(db.tabelas.fluxo_caixa.length, 1);
  assert.equal(db.tabelas.pagamento_eventos.length, 1);
  assert.equal(pedido.status, 'pendente');
});

test('reconciliação rejeita Order divergente ou ainda não acreditada sem gravar', async () => {
  const db = bancoSimulado();
  db.tabelas.pedidos.push({ id: 68, valor: 8.63, pagamento: 'site', pagamento_provedor: 'mercadopago_pix', pagamento_id: 'mercadopago:PAY-68', pagamento_order_id: 'ORD01TEST68', pagamento_status: 'pending' });
  let chamadasRpc = 0;
  db.rpc = async () => { chamadasRpc++; return { error: null }; };
  const base = { id: 'ORD01TEST68', external_reference: '68', total_amount: '8.63', total_paid_amount: '8.63', status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY-68', amount: '8.63', status: 'processed', status_detail: 'accredited', payment_method: { id: 'pix', type: 'bank_transfer' } }] } };
  for (const alterar of [
    order => { order.external_reference = '69'; },
    order => { order.total_amount = '8.64'; },
    order => { order.total_paid_amount = '8.62'; },
    order => { order.transactions.payments[0].id = 'PAY-OUTRO'; },
    order => { order.transactions.payments[0].payment_method.id = 'visa'; },
    order => { order.transactions.payments[0].status_detail = 'waiting_transfer'; }
  ]) {
    const order = structuredClone(base); alterar(order);
    const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher: async () => ({ ok: true, status: 200, json: async () => order }) });
    await assert.rejects(() => servico.reconciliar('68'));
  }
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher: async () => { throw new Error('Não deve consultar ID divergente'); } });
  await assert.rejects(() => servico.reconciliar('68', 'ORD01OUTRO68'), /difere do vínculo/);
  assert.equal(chamadasRpc, 0);
  assert.equal(db.tabelas.pagamento_eventos.length, 0);
});

test('pedido antigo sem Order ID salvo aceita ID de recuperação, mas nunca status do cliente', async () => {
  const db = bancoSimulado();
  db.tabelas.pedidos.push({ id: 68, valor: 8.63, pagamento: 'site', pagamento_provedor: 'mercadopago_pix', pagamento_id: 'mercadopago:PAY-68', pagamento_status: 'pending' });
  let urlConsultada;
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher: async url => {
    urlConsultada = url;
    return { ok: true, status: 200, json: async () => ({ id: 'ORD01TEST68', external_reference: '68', total_amount: '8.63', status: 'action_required', transactions: { payments: [{ id: 'PAY-68', amount: '8.63', status: 'action_required', payment_method: { id: 'pix', type: 'bank_transfer' } }] } }) };
  } });
  await assert.rejects(() => servico.reconciliar('68'), /Order ID não registrado/);
  await assert.rejects(() => servico.reconciliar('68', 'ORD01TEST68'), /não está integralmente acreditado/);
  assert.equal(urlConsultada, 'https://api.mercadopago.com/v1/orders/ORD01TEST68');
  assert.equal(db.tabelas.pagamento_eventos.length, 0);
});

test('estados da Orders API são separados em pendente, aprovado, recusado e cancelado', () => {
  assert.equal(statusPagamento({ status: 'action_required', status_detail: 'waiting_transfer' }, {}), 'pending');
  assert.equal(statusPagamento({ status: 'processed' }, {}), 'approved');
  assert.equal(statusPagamento({ status: 'cancelled' }, {}), 'cancelled');
  assert.equal(statusPagamento({ status: 'rejected' }, {}), 'rejected');
});
