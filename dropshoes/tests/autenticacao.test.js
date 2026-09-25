const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { criarAutenticacao, hashSenha, verificarSenha } = require('../config/autenticacao');
const secret = 'segredo-apenas-para-testes-locais';

function banco(contas = []) {
  return {
    contas, erro: null, conflito: false,
    from(tabela) {
      assert.equal(tabela, 'profiles');
      let filtros = [], operacao, valores, campos;
      const db = this;
      const query = {
        select(valor) { campos = valor; return this; },
        eq(campo, valor) { filtros.push([campo, valor]); return this; },
        insert(valor) { operacao = 'insert'; valores = valor[0]; return this; },
        update(valor) { operacao = 'update'; valores = valor; return this; },
        async maybeSingle() { return this.single(); },
        async single() {
          if (db.erro) return { data: null, error: db.erro };
          let conta = contas.find(c => filtros.every(([k, v]) => c[k] === v));
          if (operacao === 'insert') {
            if (db.conflito || contas.some(c => c.email === valores.email)) return { error: { code: '23505' } };
            conta = { id: String(contas.length + 1), ...valores }; contas.push(conta);
          }
          if (operacao === 'update' && conta) Object.assign(conta, valores);
          return { data: conta ? Object.fromEntries(campos.split(',').map(k => [k, conta[k]])) : null, error: null };
        }
      };
      return query;
    }
  };
}
async function chamar(handler, body, headers = {}) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  const req = { body, headers };
  await handler(req, res, () => { res.prosseguiu = true; });
  return { ...res, user: req.user };
}
const cliente = { nome: 'Maria Silva', email: ' Maria@Exemplo.com ', telefone: '(16) 99999-1234', senha: ' senha segura ' };

test('cadastro persiste cliente e login recupera dados; cargo injetado é ignorado', async () => {
  const db = banco(); const auth = criarAutenticacao({ db, secret });
  const cadastro = await chamar(auth.cadastro, { ...cliente, role: 'admin1', app_metadata: { role: 'admin1' } });
  assert.equal(cadastro.statusCode, 201);
  assert.equal(db.contas[0].role, 'cliente');
  assert.equal(db.contas[0].email, 'maria@exemplo.com');
  assert.notEqual(db.contas[0].senha, cliente.senha);
  assert.equal(cadastro.body.usuario.senha, undefined);
  const login = await chamar(auth.login, { identificador: ' MARIA@EXEMPLO.COM ', senha: cliente.senha });
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.nome, cliente.nome);
  assert.equal(jwt.verify(login.body.token, secret).role, 'cliente');
  assert.equal((await chamar(auth.login, { identificador: cliente.email, senha: cliente.senha.trim() })).statusCode, 401);
  assert.equal((await chamar(auth.login, { identificador: cliente.email, senha: cliente.senha, acesso: 'admin' })).statusCode, 403);
});

test('contas administrativas antigas preservam ID e cargo e migram senha', async () => {
  for (const role of ['admin1', 'admin2']) {
    const db = banco([{ id: 'original', nome: 'Admin', email: 'admin@exemplo.com', role, senha: 'antiga' }]);
    const auth = criarAutenticacao({ db, secret });
    const login = await chamar(auth.login, { identificador: 'admin@exemplo.com', senha: 'antiga', acesso: 'admin' });
    assert.equal(login.statusCode, 200); assert.equal(login.body.role, role);
    assert.equal(db.contas[0].id, 'original'); assert.match(db.contas[0].senha, /^scrypt\$/);
    assert.equal((await chamar(auth.login, { identificador: 'admin@exemplo.com', senha: 'antiga', acesso: 'admin' })).statusCode, 200);
    assert.equal((await chamar(auth.login, { identificador: 'admin@exemplo.com', senha: 'antiga' })).statusCode, 403);
  }
});

test('validação, duplicidades e erros de banco não criam contas nem expõem detalhes', async () => {
  const db = banco(); const auth = criarAutenticacao({ db, secret });
  for (const alteracao of [{ nome: {} }, { email: 'invalido', telefone: null }, { senha: 'curta' }, { senha: [] }, { email: null, telefone: {} }]) {
    assert.equal((await chamar(auth.cadastro, { ...cliente, ...alteracao })).statusCode, 400);
  }
  assert.equal(db.contas.length, 0);
  await chamar(auth.cadastro, cliente);
  assert.equal((await chamar(auth.cadastro, cliente)).statusCode, 409);
  db.conflito = true;
  assert.equal((await chamar(auth.cadastro, { ...cliente, email: 'outro@exemplo.com' })).statusCode, 409);
  db.erro = { message: 'detalhe privado do banco' };
  const erro = await chamar(auth.login, { identificador: cliente.email, senha: cliente.senha });
  assert.equal(erro.statusCode, 503); assert.doesNotMatch(JSON.stringify(erro.body), /privado/);
  assert.equal((await chamar(auth.cadastro, cliente)).statusCode, 503);
});

test('autorização usa cargo atual do Supabase e rejeita sessão inválida ou conta removida', async () => {
  const db = banco([{ id: '1', role: 'cliente' }]); const auth = criarAutenticacao({ db, secret });
  const token = jwt.sign({ id: '1', role: 'admin1' }, secret);
  const headers = { authorization: `Bearer ${token}` };
  const sessao = await chamar(auth.autenticar, {}, headers);
  assert.equal(sessao.prosseguiu, true); assert.equal(sessao.user.role, 'cliente');
  assert.equal((await chamar(auth.autenticar, {})).statusCode, 401);
  assert.equal((await chamar(auth.autenticar, {}, { authorization: `Bearer ${jwt.sign({ id: '1' }, 'outro')}` })).statusCode, 401);
  db.contas.splice(0);
  assert.equal((await chamar(auth.autenticar, {}, headers)).statusCode, 401);
});

test('senhas usam salts diferentes e configuração ausente falha de forma segura', async () => {
  const a = await hashSenha('senha de teste'); const b = await hashSenha('senha de teste');
  assert.notEqual(a, b); assert.equal(await verificarSenha('senha de teste', a), true);
  assert.equal(await verificarSenha('incorreta', a), false);
  assert.equal(await verificarSenha('senha', 'scrypt$invalido'), false);
  const auth = criarAutenticacao({ db: null, secret });
  assert.equal((await chamar(auth.cadastro, cliente)).statusCode, 503);
  assert.equal((await chamar(auth.login, {})).statusCode, 503);
});
