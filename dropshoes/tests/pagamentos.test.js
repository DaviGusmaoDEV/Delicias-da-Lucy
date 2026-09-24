const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Payment, Preference } = require('mercadopago');
const { criarPagamentos, assinaturaValida } = require('../services/pagamentos');
const { bancoSimulado } = require('./banco-simulado');
const segredo = 'segredo-webhook-teste';
function requisicao(id = '123') {
  const ts = '1704908010', requestId = 'request-teste';
  const hash = createHmac('sha256', segredo).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  const headers = { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${hash}` };
  return { query: { 'data.id': id }, body: { type: 'payment', data: { id: 'nao-confiar-no-corpo' } }, get: nome => headers[nome] };
}
function resposta() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; }, sendStatus(n) { this.statusCode = n; return this; } }; }
test('assinatura usa query assinada e rejeita dados adulterados e ausência de segredo', () => {
  const req = requisicao();
  assert.equal(assinaturaValida(req, segredo), true);
  assert.equal(assinaturaValida(req, ''), false);
  req.query['data.id'] = '124'; assert.equal(assinaturaValida(req, segredo), false);
  req.query['data.id'] = ['123']; assert.equal(assinaturaValida(req, segredo), false);
});
test('webhook consulta Mercado Pago, valida valor/moeda e só então registra no banco', async t => {
  const db = bancoSimulado(); db.tabelas.pedidos.push({ id: 'pedido1', valor: 20, pagamento: 'site' });
  let registro;
  db.rpc = async (nome, dados) => { registro = { nome, dados }; return { error: null }; };
  let pagamento = { id: 123, external_reference: 'pedido1', transaction_amount: 20, currency_id: 'BRL', status: 'approved', date_last_updated: '2026-09-23T12:00:00Z', date_approved: '2026-09-23T12:00:00Z' };
  const consulta = mock.method(Payment.prototype, 'get', async ({ id }) => { assert.equal(id, '123'); return pagamento; });
  t.after(() => consulta.mock.restore());
  const servico = criarPagamentos({ cliente: {}, db, segredo, urlPublica: 'https://loja.example' });
  const res = resposta(); await servico.notificar(requisicao(), res);
  assert.equal(res.statusCode, 200); assert.equal(registro.nome, 'registrar_pagamento_pedido'); assert.equal(registro.dados.p_valor, 20);
  for (const alteracao of [{ transaction_amount: 0.01 }, { currency_id: 'USD' }]) {
    const anterior = pagamento; pagamento = { ...pagamento, ...alteracao }; registro = null;
    const falha = resposta(); await servico.notificar(requisicao(), falha);
    assert.equal(falha.statusCode, 422); assert.equal(registro, null); pagamento = anterior;
  }
  pagamento = { ...pagamento, status: 'pending' };
  await servico.notificar(requisicao(), resposta()); assert.equal(registro.dados.p_status, 'pending');
  db.rpc = async () => ({ error: { code: 'falha' } });
  const falhaBanco = resposta(); await servico.notificar(requisicao(), falhaBanco); assert.equal(falhaBanco.statusCode, 503);
  const invalida = requisicao(); invalida.query['data.id'] = '444';
  const chamadas = consulta.mock.callCount(); await servico.notificar(invalida, resposta()); assert.equal(consulta.mock.callCount(), chamadas);
});
test('checkout envia valor do servidor, referência, webhook e URLs de retorno', async t => {
  const criar = mock.method(Preference.prototype, 'create', async dados => {
    assert.equal(dados.body.items[0].unit_price, 20);
    assert.equal(dados.body.external_reference, 'pedido1');
    assert.equal(dados.body.notification_url, 'https://loja.example/api/webhooks/mercadopago');
    assert.match(decodeURI(dados.body.back_urls.success), /tela cliente\/meu perfil cliente.html/);
    assert.equal(dados.requestOptions.idempotencyKey, 'pedido-pedido1');
    return { init_point: 'https://www.mercadopago.com.br/checkout/teste' };
  }); t.after(() => criar.mock.restore());
  const servico = criarPagamentos({ cliente: {}, db: {}, segredo, urlPublica: 'https://loja.example' });
  assert.equal(servico.disponivel, true);
  assert.match(await servico.checkout({ id: 'pedido1', valor: 20 }), /^https:/);
  assert.equal(criarPagamentos({ cliente: {}, db: {}, segredo: '', urlPublica: 'https://loja.example' }).disponivel, false);
});
