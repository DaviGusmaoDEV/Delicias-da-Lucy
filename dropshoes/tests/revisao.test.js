const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { limitarAutenticacao } = require('../middleware/limite-autenticacao');

test('limite de autenticação bloqueia excesso e libera após a janela', () => {
  let agora = 0;
  const limitar = limitarAutenticacao({ maximo: 2, janela: 1000, agora: () => agora });
  const resposta = () => ({ statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
  let chamadas = 0;
  const req = { ip: '127.0.0.1' };
  limitar(req, resposta(), () => chamadas++); limitar(req, resposta(), () => chamadas++);
  const bloqueado = resposta(); limitar(req, bloqueado, () => chamadas++);
  assert.equal(chamadas, 2); assert.equal(bloqueado.statusCode, 429); assert.equal(bloqueado.headers['Retry-After'], '1');
  agora = 1000; limitar(req, resposta(), () => chamadas++); assert.equal(chamadas, 3);
});

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? arquivos(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
test('páginas não possuem links locais, scripts ou imports quebrados', () => {
  const raiz = path.resolve(__dirname, '../public');
  const rotas = new Set(['/', '/login', '/login-cliente', '/cadastro', '/cadastro-cliente', '/admin/principal', '/admin/produtos', '/admin/fluxo-caixa', '/admin/meu-perfil', '/cliente/principal', '/cliente/produtos', '/cliente/carrinho', '/cliente/meu-perfil', '/vendor/sweetalert2.js', '/vendor/sweetalert2.esm.js']);
  for (const arquivo of arquivos(raiz)) {
    if (!/\.(html|js)$/.test(arquivo)) continue;
    const conteudo = fs.readFileSync(arquivo, 'utf8');
    const referencias = arquivo.endsWith('.html') ? [...conteudo.matchAll(/(?:src|href)="([^"]+)"/g)] : [...conteudo.matchAll(/(?:import\s+[^;]*?from\s*)['"]([^'"]+)['"]/g)];
    for (const [, referencia] of referencias) {
      if (/^(?:https?:|data:|mailto:|tel:|#)/.test(referencia) || rotas.has(referencia)) continue;
      const relativo = decodeURIComponent(referencia.split('?')[0]);
      const destino = relativo.startsWith('/') ? path.join(raiz, relativo) : path.resolve(path.dirname(arquivo), relativo);
      assert.ok(fs.existsSync(destino), `${arquivo}: ${referencia}`);
      // Também detecta diferenças de maiúsculas/minúsculas que falham em servidores Linux.
      assert.ok(fs.readdirSync(path.dirname(destino)).includes(path.basename(destino)), `${arquivo}: capitalização incorreta em ${referencia}`);
    }
  }
});

test('todos os scripts do navegador têm sintaxe válida', () => {
  for (const arquivo of arquivos(path.resolve(__dirname, '../public')).filter(p => p.endsWith('.js'))) {
    const resultado = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(arquivo, 'utf8'), encoding: 'utf8' });
    assert.equal(resultado.status, 0, `${arquivo}: ${resultado.stderr}`);
  }
});
