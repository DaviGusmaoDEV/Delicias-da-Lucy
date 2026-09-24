const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const exec = promisify(execFile);

test('PostgreSQL real: receita atômica, duplicidade, estorno e acesso da RPC', { skip: process.env.RUN_POSTGRES_TESTS !== '1' }, async t => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'lucy-pg-'));
  const data = path.join(raiz, 'data');
  execFileSync('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', data, '-l', path.join(raiz, 'postgres.log'), '-o', `-k ${raiz} -p 55439 -c listen_addresses=''`, '-w', 'start'], { stdio: 'pipe' });
  t.after(() => { execFileSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' }); fs.rmSync(raiz, { recursive: true, force: true }); });
  const args = ['-h', raiz, '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'];
  const sql = source => execFileSync('psql', [...args, '-c', source], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table profiles(id uuid primary key);
    create table pedidos(id uuid primary key, valor numeric(10,2), pagamento text);
    create table fluxo_caixa(id uuid primary key default gen_random_uuid(), descricao text not null, tipo text not null, valor numeric(10,2) not null check(valor>0), data date not null);`);
  execFileSync('psql', [...args, '-f', path.join(__dirname, '../database/schema-pagamentos-caixa.sql')], { stdio: 'pipe' });
  // Idempotência também da migração.
  execFileSync('psql', [...args, '-f', path.join(__dirname, '../database/schema-pagamentos-caixa.sql')], { stdio: 'pipe' });
  const pedido = '00000000-0000-4000-8000-000000000001';
  sql(`insert into pedidos(id,valor,pagamento) values ('${pedido}',20,'site');`);
  const chamar = (status, valor = 20, estorno = 0, dia = 23, pagamento = '123') => `select registrar_pagamento_pedido('${pedido}','${pagamento}','${status}',${valor},${estorno},'2026-09-${dia} 12:00:00+00','2026-09-23 12:00:00+00');`;
  sql(chamar('pending')); assert.equal(sql('select count(*) from fluxo_caixa'), '0');
  assert.throws(() => sql(chamar('approved', 1))); assert.equal(sql('select count(*) from fluxo_caixa'), '0');
  await Promise.all(Array.from({ length: 4 }, () => exec('psql', [...args, '-c', chamar('approved')])));
  assert.equal(sql("select count(*)||':'||sum(valor) from fluxo_caixa where tipo='receita'"), '1:20.00');
  assert.equal(sql('select pagamento_status from pedidos'), 'approved');
  sql(chamar('pending',20,0,22)); assert.equal(sql('select pagamento_status from pedidos'), 'approved');
  assert.throws(() => sql(chamar('approved',20,0,24,'outro')));
  sql(chamar('approved',20,5,24)); sql(chamar('approved',20,5,24));
  assert.equal(sql("select count(*)||':'||sum(valor) from fluxo_caixa where tipo='despesa'"), '1:5.00');
  sql(chamar('refunded',20,20,25)); sql(chamar('refunded',20,20,25));
  assert.equal(sql("select sum(case when tipo='receita' then valor else -valor end) from fluxo_caixa"), '0.00');
  assert.equal(sql("select has_function_privilege('anon','registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz)','EXECUTE')"), 'f');
  assert.equal(sql("select has_function_privilege('service_role','registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz)','EXECUTE')"), 't');
  // A migração de visitantes bloqueia leitura e escrita diretas por chaves públicas.
  sql(`alter table pedidos alter column id set default gen_random_uuid();
    alter table pedidos add column usuario_id uuid, add column subtotal numeric(10,2),
      add column taxa_entrega numeric(10,2), add column status text, add column observacao_geral text,
      add column endereco text, add column numero_casa text, add column bairro text, add column cep text;
    create table products(id uuid primary key);
    create table itens_pedido(id uuid primary key default gen_random_uuid(), pedido_id uuid references pedidos(id),
      produto_id uuid references products(id), quantidade integer, preco_unitario numeric(10,2), observacao_item text);`);
  execFileSync('psql', [...args, '-f', path.join(__dirname, '../database/schema-seguranca-visitantes.sql')], { stdio: 'pipe' });
  execFileSync('psql', [...args, '-f', path.join(__dirname, '../database/schema-seguranca-visitantes.sql')], { stdio: 'pipe' });
  for (const role of ['anon','authenticated']) {
    for(const tabela of ['profiles','pedidos','products','itens_pedido','fluxo_caixa','clientes_visitantes']) {
      assert.throws(() => sql(`set role ${role}; select * from ${tabela};`));
      assert.throws(() => sql(`set role ${role}; delete from ${tabela} where false;`));
      assert.throws(() => sql(`set role ${role}; insert into ${tabela}(id) values(gen_random_uuid());`));
    }
  }
  assert.throws(() => sql("insert into pedidos(id,valor,pagamento) values(gen_random_uuid(),20,'site')"));
  const visitante = '00000000-0000-4000-8000-000000000090';
  const produto = '00000000-0000-4000-8000-000000000091';
  sql(`insert into clientes_visitantes(id,nome,telefone,cep) values('${visitante}','Teste','16999991234','14060040'); insert into products(id) values('${produto}');`);
  const dados = chave => JSON.stringify({ visitante_id: visitante, checkout_chave: chave, cliente_nome: 'Teste', cliente_telefone: '16999991234', valor: 20, subtotal: 20, taxa_entrega: 0 });
  const itens = JSON.stringify([{ produto_id: produto, quantidade: 2, preco_unitario: 10 }]);
  const chave = '00000000-0000-4000-8000-000000000092';
  const criar = `set role service_role; select criar_pedido_com_itens('${dados(chave)}','${itens}');`;
  await Promise.all(Array.from({ length: 3 }, () => exec('psql', [...args, '-c', criar])));
  assert.equal(sql(`select count(*) from pedidos where checkout_chave='${chave}'`), '1');
  assert.equal(sql('select count(*) from itens_pedido'), '1');
  const chaveFalha = '00000000-0000-4000-8000-000000000093';
  const invalidos = JSON.stringify([{ produto_id: visitante, quantidade: 1, preco_unitario: 10 }]);
  assert.throws(() => sql(`set role service_role; select criar_pedido_com_itens('${dados(chaveFalha)}','${invalidos}');`));
  assert.equal(sql(`select count(*) from pedidos where checkout_chave='${chaveFalha}'`), '0');
  assert.equal(sql("select has_function_privilege('anon','criar_pedido_com_itens(jsonb,jsonb)','EXECUTE')"), 'f');
  assert.equal(sql("select has_function_privilege('authenticated','criar_pedido_com_itens(jsonb,jsonb)','EXECUTE')"), 'f');
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.clientes_visitantes'::regclass"),'t');

});
