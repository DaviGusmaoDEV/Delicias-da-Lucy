const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');

test('numeração comercial simulada é única em criações concorrentes', async () => {
  const db = bancoSimulado();
  const resultados = await Promise.all([1, 2].map(indice => db.rpc('criar_pedido_com_itens', {
    p_pedido: { checkout_chave: `00000000-0000-4000-8000-00000000010${indice}`, pagamento: 'entrega', valor: indice },
    p_itens: []
  })));
  assert.deepEqual(resultados.map(resultado => resultado.data.numero_pedido).sort((a, b) => a - b), [1, 2]);
  assert.notEqual(resultados[0].data.id, resultados[0].data.numero_pedido);
});

test('integração HTTP: cadastro, permissões, produtos, caixa, pedidos e erros', async t => {
  const db = bancoSimulado();
  let chamadasCheckout = 0;
  const server = criarApp({ db, secret: 'segredo-de-integracao', entrega: async () => ({ taxa: 6 }), pagamentos: { disponivel: true, checkout: async () => { chamadasCheckout++; return 'https://checkout.infinitepay.io/checkout/teste'; }, notificar: (_req, res) => res.sendStatus(200) } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function req(path, method = 'GET', body, token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  }
  const cliente = { nome: 'Cliente Teste', email: 'cliente@example.test', senha: 'senha-cliente', role: 'admin1' };
  assert.equal((await req('/api/cadastro', 'POST', cliente)).status, 201);
  assert.equal((await req('/api/cadastro', 'POST', cliente)).status, 409);
  const login = await req('/api/login', 'POST', { identificador: cliente.email, senha: cliente.senha });
  assert.equal(login.status, 200); assert.equal(login.body.role, 'cliente');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const token = login.body.token;
  assert.equal((await req('/api/meu-perfil', 'GET', undefined, token)).body.perfil.email, cliente.email);
  assert.deepEqual((await req('/api/meus-pedidos', 'GET', undefined, token)).body, []);
  assert.equal((await req('/api/produtos')).status, 200);
  assert.equal((await req('/api/produtos', 'POST', {}, token)).status, 403);
  assert.equal((await req('/api/pedidos', 'GET', undefined, token)).status, 403);
  const admin1 = (await req('/api/login', 'POST', { identificador: 'dona@example.test', senha: 'senha-admin', acesso: 'admin' })).body.token;
  const admin2 = (await req('/api/login', 'POST', { identificador: 'equipe@example.test', senha: 'senha-admin', acesso: 'admin' })).body.token;
  assert.equal((await req('/api/fluxo-caixa', 'GET', undefined, admin2)).status, 403);
  const transacao = { descricao: 'Venda de teste', valor: 20.5, tipo: 'receita', data: '2026-09-22' };
  const caixa = await req('/api/fluxo-caixa', 'POST', transacao, admin1);
  assert.equal(caixa.status, 201);
  assert.equal((await req(`/api/fluxo-caixa/${caixa.body.id}`, 'PUT', { ...transacao, valor: 25 }, admin1)).body.valor, 25);
  db.tabelas.fluxo_caixa.push({ id: 'outro-dia', descricao: 'Venda posterior', tipo: 'receita', valor: 10, data: '2026-09-23' });
  const caixaFiltrado = await req('/api/fluxo-caixa?inicio=2026-09-22&fim=2026-09-22', 'GET', undefined, admin1);
  assert.deepEqual(caixaFiltrado.body.map(item => item.id), [caixa.body.id]);
  assert.equal((await req('/api/fluxo-caixa?inicio=2026-02-30', 'GET', undefined, admin1)).status, 400);
  assert.equal((await req('/api/fluxo-caixa?inicio=2026-09-23&fim=2026-09-22', 'GET', undefined, admin1)).status, 400);
  assert.equal((await req('/api/fluxo-caixa', 'POST', { ...transacao, data: '2026-02-30' }, admin1)).status, 400);
  assert.equal((await req('/api/fluxo-caixa', 'POST', { ...transacao, valor: -5 }, admin1)).status, 400);
  assert.equal((await req(`/api/fluxo-caixa/${caixa.body.id}`, 'DELETE', undefined, admin1)).status, 204);
  assert.equal((await req('/api/produtos', 'POST', { nome: {} }, admin1)).status, 400);
  assert.equal((await req('/api/produtos/p1', 'PUT', { nome: 'Produto alterado', preco: 12.35, categoria: 'outros', isEspecial: false }, admin1)).status, 200);
  assert.equal(db.tabelas.products[0].imagem_url, 'https://example.test/foto.jpg');
  // Administradores publicam no mesmo catálogo consultado pelos clientes.
  for (const [isEspecial, administrador] of [[false, admin1], [true, admin2]]) {
    const produto = { nome: isEspecial ? 'Combo promocional' : 'Pastel de queijo', preco: 19.9, descricao: 'Queijo e orégano', categoria: 'pasteis-salgados', isEspecial };
    const salvo = await req('/api/produtos', 'POST', produto, administrador);
    assert.equal(salvo.status, 201);
    const catalogo = await req('/api/produtos', 'GET', undefined, token);
    assert.equal(catalogo.status, 200);
    const visivel = catalogo.body.find(p => p.id === salvo.body.id);
    for (const campo of ['nome', 'preco', 'descricao', 'categoria', 'isEspecial']) assert.equal(visivel[campo], produto[campo]);
    assert.equal((await req(`/api/produtos/${salvo.body.id}`, 'PUT', produto, token)).status, 403);
    assert.equal((await req(`/api/produtos/${salvo.body.id}`, 'DELETE', undefined, token)).status, 403);
    const alterado = { ...produto, preco: 15.5, descricao: 'Nova descrição' };
    assert.equal((await req(`/api/produtos/${salvo.body.id}`, 'PUT', alterado, administrador)).status, 200);
    const atualizado = (await req('/api/produtos', 'GET', undefined, token)).body.find(p => p.id === salvo.body.id);
    assert.equal(atualizado.preco, 15.5);
    assert.equal(atualizado.descricao, 'Nova descrição');
    assert.equal(atualizado.isEspecial, isEspecial);
  }
  db.tabelas.fluxo_caixa.push({ id: 'automatico', descricao: 'Pedido pago', tipo: 'receita', valor: 20, data: '2026-09-23', pedido_id: 'pedido-pago' });
  assert.equal((await req('/api/fluxo-caixa/automatico', 'PUT', transacao, admin1)).status, 409);
  assert.equal((await req('/api/fluxo-caixa/automatico', 'DELETE', undefined, admin1)).status, 409);
  assert.equal(db.tabelas.fluxo_caixa.find(t => t.id === 'automatico').valor, 20);
  const pedido = { cliente_nome: 'Cliente Teste', cliente_telefone: '16999991234', itens: [{ produto_id: 'p1', quantidade: 3, preco_unitario: 0.01 }], endereco: 'Rua Teste', numero_casa: '1', bairro: 'Centro', cep: '14000-000', pagamento: 'site', checkout_chave: '00000000-0000-4000-8000-000000000001' };
  for (const dados of [{ ...pedido, endereco: [] }, { ...pedido, itens: [null] }, { ...pedido, itens: [...pedido.itens, ...pedido.itens] }, { ...pedido, pagamento: 'invalido' }]) {
    assert.equal((await req('/api/pedidos', 'POST', dados, token)).status, 400);
  }
  assert.equal((await req('/api/pedidos', 'POST', pedido, admin1)).status, 403);
  const criado = await req('/api/pedidos', 'POST', pedido, token);
  assert.equal(criado.status, 201); assert.equal(criado.body.pedido.subtotal, 37.05);
  assert.equal(criado.body.pedido.valor, 43.05);
  assert.equal(criado.body.pedido.numero_pedido, 1);
  const id = criado.body.pedido.id;
  assert.match(criado.body.payment_url, /^https:/);
  assert.equal(criado.body.payment_url, 'https://checkout.infinitepay.io/checkout/teste');
  assert.equal((await req('/api/pedidos', 'POST', pedido, token)).body.pedido.id, id);
  assert.equal(chamadasCheckout, 1);
  assert.equal(db.tabelas.pedidos.length, 1);
  const pedidoEntrega = { ...pedido, pagamento: 'entrega', tipo_pagamento_entrega: 'dinheiro', checkout_chave: '00000000-0000-4000-8000-000000000002' };
  const entregaCriada = await req('/api/pedidos', 'POST', pedidoEntrega, token);
  assert.equal(entregaCriada.status, 201);
  assert.equal(entregaCriada.body.pedido.numero_pedido, 2);
  assert.equal(entregaCriada.body.pedido.pagamento, 'entrega');
  assert.equal(entregaCriada.body.pedido.pagamento_status, 'pending');
  assert.equal(entregaCriada.body.pedido.tipo_pagamento_entrega, 'dinheiro');
  assert.equal(entregaCriada.body.payment_url, undefined);
  assert.equal(chamadasCheckout, 1);
  for (const [tipo, chave] of [[undefined, '00000000-0000-4000-8000-000000000007'], ['pix', '00000000-0000-4000-8000-000000000008'], ['qualquer', '00000000-0000-4000-8000-000000000009']]) {
    const invalido = { ...pedidoEntrega, checkout_chave: chave, tipo_pagamento_entrega: tipo };
    assert.equal((await req('/api/pedidos', 'POST', invalido, token)).status, 400);
  }
  const cartao = await req('/api/pedidos', 'POST', { ...pedidoEntrega, tipo_pagamento_entrega: 'cartao', checkout_chave: '00000000-0000-4000-8000-000000000010' }, token);
  assert.equal(cartao.status, 201);
  assert.equal(cartao.body.pedido.tipo_pagamento_entrega, 'cartao');
  const onlineComTipo = await req('/api/pedidos', 'POST', { ...pedido, tipo_pagamento_entrega: 'dinheiro', checkout_chave: '00000000-0000-4000-8000-000000000011' }, token);
  assert.equal(onlineComTipo.status, 201);
  assert.equal(onlineComTipo.body.pedido.tipo_pagamento_entrega, null);
  assert.equal((await req(`/api/pedidos/${entregaCriada.body.pedido.id}/status`, 'PATCH', { status: 'aceito' }, admin1)).status, 200);
  const entregaCancelavel = await req('/api/pedidos', 'POST', { ...pedidoEntrega, checkout_chave: '00000000-0000-4000-8000-000000000004' }, token);
  for (const status of ['aceito', 'em_preparo', 'pronto_entrega']) assert.equal((await req(`/api/pedidos/${entregaCancelavel.body.pedido.id}/status`, 'PATCH', { status }, admin1)).status, 200);
  assert.equal((await req(`/api/pedidos/${entregaCancelavel.body.pedido.id}/status`, 'PATCH', { status: 'cancelado' }, admin1)).status, 200);
  // Mesmo com uma RPC antiga que devolve "site", a escolha de entrega não
  // pode abrir checkout nem fazer o carrinho procurar uma payment_url.
  db.rpcPagamentoLegado = true;
  const entregaLegada = await req('/api/pedidos', 'POST', { ...pedidoEntrega, checkout_chave: '00000000-0000-4000-8000-000000000003' }, token);
  assert.equal(entregaLegada.status, 201);
  assert.equal(entregaLegada.body.tipo_pagamento, 'entrega');
  assert.equal(entregaLegada.body.pedido.pagamento, 'entrega');
  assert.equal(db.tabelas.pedidos.find(p => p.id === entregaLegada.body.pedido.id).pagamento, 'entrega');
  assert.equal(chamadasCheckout, 2);
  db.rpcPagamentoLegado = false;
  assert.equal((await req('/api/pedidos', 'POST', { ...pedido, pagamento: 'whatsapp' }, token)).status, 400);
  assert.equal((await req(`/api/pedidos/${id}/status`, 'PATCH', { status: 'aceito' }, admin1)).status, 409);
  db.tabelas.pedidos.find(p => p.id === id).pagamento_status = 'approved';
  db.tabelas.pedidos.find(p => p.id === id).pago_em = new Date().toISOString();
  assert.equal((await req(`/api/pedidos/${id}/pagar`, 'POST', {}, token)).status, 409);
  assert.equal((await req(`/api/pedidos/${id}/status`, 'PATCH', { status: 'recebido' }, admin1)).status, 400);
  for (const status of ['aceito', 'em_preparo', 'pronto_entrega']) assert.equal((await req(`/api/pedidos/${id}/status`, 'PATCH', { status }, admin1)).status, 200);
  db.concorrer = true;
  assert.equal((await req(`/api/pedidos/${id}/confirmar-recebimento`, 'POST', {}, token)).status, 409);
  db.concorrer = false;
  assert.equal((await req(`/api/pedidos/${id}/confirmar-recebimento`, 'POST', {}, token)).status, 200);
  for (const status of ['em_preparo', 'pronto_entrega']) assert.equal((await req(`/api/pedidos/${entregaCriada.body.pedido.id}/status`, 'PATCH', { status }, admin1)).status, 200);
  const entregaRecebida = await req(`/api/pedidos/${entregaCriada.body.pedido.id}/confirmar-recebimento`, 'POST', {}, token);
  assert.equal(entregaRecebida.status, 200);
  assert.equal(entregaRecebida.body.pedido.pagamento_status, 'approved');
  const receitaEntrega = db.tabelas.fluxo_caixa.filter(item => item.pedido_id === entregaCriada.body.pedido.id && item.tipo === 'receita');
  assert.equal(receitaEntrega.length, 1);
  assert.equal(receitaEntrega[0].valor, entregaCriada.body.pedido.valor);
  assert.equal((await req('/api/meus-pedidos', 'GET', undefined, token)).body.length, 6);
  db.tabelas.pedidos.push({ id: 'cancelado-sem-receita', status: 'cancelado', pagamento: 'entrega', pagamento_status: 'pending', valor: 12 });
  db.tabelas.itens_pedido.push({ id: 'item-cancelado', pedido_id: 'cancelado-sem-receita', produto_id: 'p1', quantidade: 1, preco_unitario: 12 });
  assert.equal((await req('/api/pedidos/cancelado-sem-receita', 'DELETE', undefined, admin1)).status, 204);
  assert.equal(db.tabelas.pedidos.some(item => item.id === 'cancelado-sem-receita'), false);
  assert.equal(db.tabelas.itens_pedido.some(item => item.pedido_id === 'cancelado-sem-receita'), false);
  db.tabelas.pedidos.push({ id: 'cancelado-pago', status: 'cancelado', pagamento: 'site', pagamento_status: 'approved', pago_em: new Date().toISOString(), valor: 12 });
  assert.equal((await req('/api/pedidos/cancelado-pago', 'DELETE', undefined, admin1)).status, 409);
  db.falhar = 'products';
  const falha = await req('/api/produtos', 'GET', undefined, token);
  assert.equal(falha.status, 500); assert.doesNotMatch(JSON.stringify(falha.body), /interna simulada/);
  const malformado = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformado.status, 400); assert.equal((await malformado.json()).erro, 'JSON inválido.');
  assert.equal((await req('/api/nao-existe')).status, 404);
  for (const path of ['/', '/login', '/cadastro-cliente', '/admin/principal', '/cliente/produtos', '/vendor/sweetalert2.js', '/vendor/sweetalert2.esm.js']) {
    const resposta = await fetch(base + path); assert.equal(resposta.status, 200, path);
  }
});
