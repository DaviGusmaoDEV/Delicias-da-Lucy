const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { criarApp } = require('../server');
const { bancoSimulado } = require('./banco-simulado');
const segredo = 'segredo-longo-exclusivo-dos-testes-seguranca';
async function ambiente(t) {
  const db = bancoSimulado();
  const server = criarApp({ db, secret: segredo, entrega: async () => ({ taxa: 1.5 }), pagamentos: { disponivel: true, checkout: async () => 'https://www.mercadopago.com.br/checkout/teste', notificar: (_req,res) => res.sendStatus(401) } }).listen(0,'127.0.0.1');
  await once(server,'listening'); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (url, method='GET', body, headers={}) => fetch(base+url, { method, headers: { ...(body === undefined ? {} : {'Content-Type':'application/json'}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {db,base,req};
}
const contato = { nome: 'Visitante Teste', telefone: '16999991234', cep: '14060040' };
const cookie = resposta => resposta.headers.get('set-cookie').split(';')[0];

test('sessão de navegador HttpOnly, CSP, CSRF, logout e permissões reais do banco', async t => {
  const {req} = await ambiente(t);
  const resposta = await req('/api/login','POST',{identificador:'dona@example.test',senha:'senha-admin',acesso:'admin'},{'X-Session-Mode':'cookie'});
  assert.equal(resposta.status,200);
  assert.equal((await resposta.json()).token,undefined);
  assert.match(resposta.headers.get('set-cookie'),/HttpOnly/); assert.match(resposta.headers.get('set-cookie'),/SameSite=Lax/);
  const sessao = cookie(resposta);
  assert.equal((await req('/api/fluxo-caixa','GET',undefined,{Cookie:sessao})).status,200);
  const csrf = await req('/api/fluxo-caixa','POST',{}, {Cookie:sessao,Origin:'https://invasor.example'});
  assert.equal(csrf.status,403); assert.equal(csrf.headers.get('access-control-allow-origin'),null);
  assert.equal((await req('/api/logout','POST',undefined,{'Sec-Fetch-Site':'cross-site',Cookie:sessao})).status,403);
  const home = await req('/'); assert.match(home.headers.get('content-security-policy'),/script-src 'self'/); assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/); assert.equal(home.headers.get('x-powered-by'),null);
  const saida = await req('/api/logout','POST',undefined,{Cookie:sessao}); assert.equal(saida.status,204); assert.match(saida.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/);
  const fingirDono = jwt.sign({id:'admin2',role:'admin1'},segredo);
  assert.equal((await req('/api/fluxo-caixa','GET',undefined,{Authorization:`Bearer ${fingirDono}`})).status,403);
});

test('compra sem conta: telefone repetido não permite acessar nem pagar pedido alheio', async t => {
  const {req,db} = await ambiente(t);
  const a = await req('/api/cadastro-cliente','POST',{...contato,role:'admin1',id:'admin1'}); assert.equal(a.status,201);
  const sessaoA = cookie(a); assert.equal((await a.json()).perfil.role,'visitante');
  const b = await req('/api/cadastro-cliente','POST',contato); const sessaoB = cookie(b);
  assert.notEqual(sessaoA,sessaoB); assert.equal(db.tabelas.clientes_visitantes.length,2);
  const pedido = { cliente_nome:contato.nome,cliente_telefone:contato.telefone,cep:contato.cep,endereco:'Rua Teste',bairro:'Ipiranga',numero_casa:'12',pagamento:'site',checkout_chave:'00000000-0000-4000-8000-000000000088',itens:[{produto_id:'p1',quantidade:2,preco_unitario:0.01}],valor:0.01,usuario_id:'admin1',pagamento_status:'approved' };
  const r = await req('/api/pedidos','POST',pedido,{Cookie:sessaoA}); assert.equal(r.status,201); const salvo = (await r.json()).pedido;
  assert.equal(salvo.valor,26.2); assert.equal(salvo.usuario_id,null); assert.equal(salvo.pagamento_status,'pending'); assert.ok(salvo.visitante_id);
  assert.equal((await (await req('/api/meus-pedidos','GET',undefined,{Cookie:sessaoA})).json()).length,1);
  assert.equal((await (await req('/api/meus-pedidos','GET',undefined,{Cookie:sessaoB})).json()).length,0);
  assert.equal((await req(`/api/pedidos/${salvo.id}/pagar`,'POST',{}, {Cookie:sessaoB})).status,404);
  assert.equal((await req(`/api/pedidos/${salvo.id}/confirmar-recebimento`,'POST',{}, {Cookie:sessaoB})).status,404);
  for(const rota of ['/api/pedidos','/api/fluxo-caixa']) assert.equal((await req(rota,'GET',undefined,{Cookie:sessaoA})).status,401);
  assert.equal((await req('/api/produtos','POST',{nome:'Produto'},{Cookie:sessaoA})).status,401);
  const tokenGuest = decodeURIComponent(sessaoA.split('=')[1]);
  assert.equal((await req('/api/pedidos','GET',undefined,{Authorization:`Bearer ${tokenGuest}`})).status,401);
  const forjado = tokenGuest.slice(0,-5)+'abcde';
  assert.equal((await req('/api/meus-pedidos','GET',undefined,{Cookie:`lucy_visitante=${forjado}`})).status,401);
});

test('payloads malformados, injeção, arquivos privados e excesso de pedidos são bloqueados', async t => {
  const {req,base,db} = await ambiente(t);
  for(const corpo of [[], {nome:{$ne:null},telefone:contato.telefone,cep:contato.cep}]) assert.equal((await req('/api/cadastro-cliente','POST',corpo)).status,400);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'teste'})).status,415);
  assert.equal((await req('/api/login','POST',{identificador:'x'.repeat(110000)})).status,413);
  assert.equal((await req('/api/login','POST',{identificador:"' OR 1=1 --",senha:'12345678'})).status,400);
  for(const arquivo of ['/.env','/server.js','/.git/config','/../.env']) { const r=await req(arquivo);assert.equal(r.status,404);assert.doesNotMatch(await r.text(),/SUPABASE_SECRET_KEY=/); }
  db.tabelas.products[0].segredo_interno = 'nao-retornar';
  const publicos = await (await req('/api/produtos')).json(); assert.equal(publicos[0].segredo_interno,undefined);
  for(let i=0;i<21;i++) { const r=await req('/api/pedidos','POST',{}); if(i===20) {assert.equal(r.status,429);assert.ok(r.headers.get('retry-after'));} }
});


test('produção recusa segredo curto, origem insegura e proxy inválido', () => {
  const { validarProducao } = require('../middleware/seguranca');
  const env = { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://loja.example', TRUST_PROXY_HOPS: '1' };
  assert.throws(() => validarProducao('curto', env), /JWT_SECRET/);
  for (const url of ['http://loja.example', 'https://loja.example/caminho', 'https://usuario:senha@loja.example']) assert.throws(() => validarProducao(segredo, { ...env, PUBLIC_BASE_URL: url }), /HTTPS/);
  assert.throws(() => validarProducao(segredo, { ...env, TRUST_PROXY_HOPS: '-1' }), /TRUST_PROXY/);
  assert.doesNotThrow(() => validarProducao(segredo, env));
});

test('pedidos da noite: janela 18h–24h, filtros, paginação e acesso administrativo', async t => {
  const { req, db } = await ambiente(t);
  const token = jwt.sign({ id: 'admin2', role: 'admin2' }, segredo);
  const headers = { Authorization: `Bearer ${token}` };
  db.tabelas.pedidos.push(
    { id: 'antes', data_criacao: '2026-09-24T20:59:59.000Z', status: 'pendente' },
    { id: 'inicio', data_criacao: '2026-09-24T21:00:00.000Z', status: 'pendente' },
    { id: 'fim', data_criacao: '2026-09-25T02:59:59.000Z', status: 'aceito' },
    { id: 'depois', data_criacao: '2026-09-25T03:00:00.000Z', status: 'pendente' }
  );
  assert.equal((await req('/api/pedidos?data=2026-09-24')).status, 401);
  const consultar = filtro => req('/api/pedidos?data=2026-09-24' + filtro, 'GET', undefined, headers);
  assert.deepEqual((await (await consultar('')).json()).pedidos.map(p => p.id), ['fim', 'inicio']);
  assert.deepEqual((await (await consultar('&status=pendente')).json()).pedidos.map(p => p.id), ['inicio']);
  for (const filtro of ['&status=inventado', '&pagina=-1', '&data=2026-09-25']) assert.equal((await consultar(filtro)).status, 400);
  assert.equal((await req('/api/pedidos?data=2026-02-30', 'GET', undefined, headers)).status, 400);
  for(let i=0;i<50;i++) db.tabelas.pedidos.push({id:`extra-${i}`,data_criacao:'2026-09-24T22:00:00.000Z',status:'em_preparo'});
  const primeira = await (await consultar('')).json(); assert.equal(primeira.pedidos.length,50); assert.equal(primeira.temMais,true);
  const segunda = await (await consultar('&pagina=1')).json(); assert.equal(segunda.pedidos.length,2); assert.equal(segunda.temMais,false);
});
