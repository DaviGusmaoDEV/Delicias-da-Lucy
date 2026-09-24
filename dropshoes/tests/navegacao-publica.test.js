const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Executa os módulos reais do navegador em um DOM mínimo, sem conexão ao banco.
async function navegar({ acesso = 'cliente', status = 401, perfil, falhaLogout = false } = {}) {
  const redirecionamentos = [], chamadas = [], eventos = {};
  const valores = new Map([['carrinho', '[{"id":"p1","quantidade":2}]'], ['role', 'admin1'], ['token', 'antigo']]);
  const sair = { addEventListener: (evento, fn) => { eventos[evento] = fn; } };
  const contexto = vm.createContext({
    AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: k => valores.get(k), setItem: (k,v) => valores.set(k,v), removeItem: k => valores.delete(k) },
    sessionStorage: { removeItem() {} },
    window: { location: { assign: url => redirecionamentos.push(url) } },
    document: {
      // Sem data-publica de propósito: páginas de cliente nunca exigem login automático.
      body: { dataset: { acesso }, hasAttribute: () => false },
      querySelectorAll: seletor => seletor === '[data-sair]' ? [sair] : [],
      querySelector: () => ({ prepend() {} }),
      createElement: () => ({ setAttribute() {} })
    },
    fetch: async url => {
      chamadas.push(url);
      const codigo = url === '/api/logout' ? (falhaLogout ? 503 : 204) : status;
      return { status: codigo, ok: codigo < 400, json: async () => perfil ? { perfil } : { erro: 'Sessão indisponível' } };
    }
  });
  const ler = nome => fs.readFileSync(path.join(__dirname, '../public/js', nome), 'utf8').replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
  vm.runInContext(ler('api.js') + '\n' + ler('sessao.js') + '\nglobalThis.pronta = sessaoPronta;', contexto);
  const resultado = await contexto.pronta;
  return { resultado, redirecionamentos, chamadas, valores, eventos, contexto };
}

test('cliente sem sessão ou com sessão expirada navega sem login e preserva carrinho', async () => {
  for (const acesso of ['cliente', undefined]) {
    const r = await navegar({ acesso });
    assert.equal(r.resultado.role, 'visitante');
    assert.equal(r.redirecionamentos.length, 0);
    assert.ok(r.valores.get('carrinho'));
    assert.equal(r.valores.get('token'), undefined);
    await assert.rejects(vm.runInContext("api('/api/pedidos')", r.contexto));
    assert.equal(r.redirecionamentos.length, 0);
  }
});

test('sessão administrativa anterior não redireciona compra sem entrar para login', async () => {
  const r = await navegar({ status: 200, perfil: { role: 'admin1', nome: 'Admin' } });
  assert.equal(r.resultado.role, 'visitante');
  assert.deepEqual(r.chamadas, ['/api/meu-perfil', '/api/logout']);
  assert.equal(r.redirecionamentos.length, 0);
  assert.ok(r.valores.get('carrinho'));
});

test('cliente autenticado permanece na loja e sair retorna ao catálogo', async () => {
  const r = await navegar({ status: 200, perfil: { role: 'cliente', nome: 'Cliente' } });
  assert.equal(r.resultado.role, 'cliente');
  assert.equal(r.redirecionamentos.length, 0);
  await r.eventos.click({ preventDefault() {} });
  assert.deepEqual(r.redirecionamentos, ['../tela cliente/Produtos.html']);
});

test('falha de sessão ou logout não redireciona visitante; administração continua protegida', async () => {
  for (const opcoes of [{ status: 503 }, { falhaLogout: true }]) {
    const r = await navegar(opcoes);
    assert.equal(r.resultado.role, 'visitante');
    assert.equal(r.redirecionamentos.length, 0);
  }
  const admin = await navegar({ acesso: 'admin' });
  assert.equal(admin.resultado, null);
  assert.deepEqual(admin.redirecionamentos, ['../tela de login/login.html']);
});
