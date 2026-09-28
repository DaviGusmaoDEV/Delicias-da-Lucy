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

test('Orders API cria Pix com valor do servidor e idempotência', async () => {
  const db = bancoSimulado(); const chamadas = [];
  const fetcher = async (url, options) => {
    chamadas.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ id: 'ORD-1', status: 'action_required', transactions: { payments: [{ id: 'PAY-1', status: 'action_required', amount: '20.00', payment_method: { id: 'pix', type: 'bank_transfer', ticket_url: 'https://www.mercadopago.com.br/pix/1', qr_code: '000201teste', qr_code_base64: 'aW1hZ2Vt' } }] } }) };
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

test('webhook repetido é reconhecido antes de aplicar qualquer efeito novamente', async () => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20, pagamento: 'site' });
  let chamadasRpc = 0; db.rpc = async () => { chamadasRpc++; return { error: null }; };
  const fetcher = async () => ({ ok: true, status: 200, json: async () => ({ id: 'ORD-123', external_reference: 'pedido1', status: 'processed', transactions: { payments: [{ id: 'PAY-123', amount: '20.00', status: 'processed' }] } }) });
  const servico = criarPagamentos({ db, accessToken: 'token-de-teste', segredo, fetcher });
  await servico.notificar(requisicao(), resposta()); await servico.notificar(requisicao(), resposta());
  assert.equal(chamadasRpc, 1);
});

test('estados da Orders API são separados em pendente, aprovado, recusado e cancelado', () => {
  assert.equal(statusPagamento({ status: 'action_required', status_detail: 'waiting_transfer' }, {}), 'pending');
  assert.equal(statusPagamento({ status: 'processed' }, {}), 'approved');
  assert.equal(statusPagamento({ status: 'cancelled' }, {}), 'cancelled');
  assert.equal(statusPagamento({ status: 'rejected' }, {}), 'rejected');
});
