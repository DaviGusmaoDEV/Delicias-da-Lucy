const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarEntrega, calcularValorEntrega } = require('../services/entrega');
const modulo = nome => import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../public/js', nome)).toString('base64'));
test('entrega grátis até 2 km e cobrança apenas da distância excedente', () => {
  assert.equal(calcularValorEntrega(1999, 1.5), 0);
  assert.equal(calcularValorEntrega(2000, 1.5), 0);
  assert.equal(calcularValorEntrega(3000, 1.5), 1.5);
  assert.equal(calcularValorEntrega(3500, 1.5), 2.25);
  assert.throws(() => calcularValorEntrega(3000, NaN));
  assert.throws(() => calcularValorEntrega(NaN, 2));
});
test('cotação valida cidade, usa trajeto e reutiliza consulta de CEP', async () => {
  let chamadas = 0;
  const entrega = criarEntrega({ origem: [-47.82, -21.13], precoKm: 2, consultar: async url => {
    chamadas++;
    return { ok: true, json: async () => url.includes('brasilapi') ? { city: 'Ribeirão Preto', state: 'SP', street: 'Rua Teste', neighborhood: 'Bairro', location: { coordinates: { longitude: '-47.81', latitude: '-21.14' } } } : { code: 'Ok', routes: [{ distance: 3000 }] } };
  } });
  const resultado = await entrega('14060-040'); assert.equal(resultado.taxa, 2); assert.equal(resultado.distancia_km, 3); assert.equal(resultado.endereco, 'Rua Teste');
  await entrega('14060040'); assert.equal(chamadas, 2);
  await assert.rejects(entrega('123'), /8 números/);
  const fora = criarEntrega({ origem: [-47.82, -21.13], precoKm: 2, consultar: async () => ({ ok: true, json: async () => ({ city: 'São Paulo', state: 'SP' }) }) });
  await assert.rejects(fora('01001000'), /apenas em/);
  const falha = criarEntrega({ origem: [-47.82, -21.13], precoKm: 2, consultar: async () => { throw new Error('rede'); } });
  await assert.rejects(falha('14060040'), /Não foi possível/);
});
test('filtros separam ganhos, custos, funcionários e saída por período', async () => {
  const { filtrarTransacoes } = await modulo('caixa-filtros.js');
  const itens = [{ tipo: 'receita', data: '2026-09-23', descricao: 'Pedido', valor: 20 }, { tipo: 'despesa', data: '2026-09-23', descricao: 'Fornecedor', valor: 5 }, { tipo: 'total-despesa-funcionario', data: '2026-09-22', descricao: 'Maria', valor: 10 }];
  assert.equal(filtrarTransacoes(itens, { tipo: 'receita' }).length, 1);
  assert.equal(filtrarTransacoes(itens, { tipo: 'custos' }).length, 2);
  assert.equal(filtrarTransacoes(itens, { tipo: 'custos', inicio: '2026-09-23' }).length, 1);
  assert.equal(filtrarTransacoes(itens, { tipo: 'total-despesa-funcionario', busca: 'maria' }).length, 1);
  assert.equal(filtrarTransacoes(itens, { tipo: 'despesa', fim: '2026-09-22' }).length, 0);
});
test('bilhete inclui nome, rua, bairro, número e itens, sem CEP e com escape de HTML', async () => {
  const { bilhetePedido } = await modulo('bilhete.js');
  const html = bilhetePedido({ id: 1, profiles: { nome: '<script>nome</script>' }, cep: '14060-040', bairro: 'Ipiranga', endereco: 'Rua Teste', numero_casa: '12', itens_pedido: [{ quantidade: 2, products: { nome: 'Pastel' }, preco_unitario: 10 }], valor: 20, pagamento_status: 'approved' });
  for (const texto of ['Ipiranga', 'Rua Teste', '12', '2x Pastel', 'PAGO']) assert.ok(html.includes(texto));
  assert.doesNotMatch(html, /14060-040|CEP|<script>/);
  assert.match(html, /&lt;script&gt;/);
});
