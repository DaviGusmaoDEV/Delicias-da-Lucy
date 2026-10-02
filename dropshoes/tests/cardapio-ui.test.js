const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLICO = path.resolve(__dirname, '../public');
const ler = caminho => fs.readFileSync(path.join(PUBLICO, caminho), 'utf8');

test('cardápio apresenta orientação, filtros, carrinho persistente e regiões de estado acessíveis', () => {
  const html = ler('tela cliente/Produtos.html');
  assert.match(html, /<body\b[^>]*class=["'][^"']*\bpagina-cardapio\b/i);
  assert.match(html, /<h1[^>]*>\s*Cardápio\s*<\/h1>/i);
  assert.match(html, /<label[^>]*for=["']filtro-categoria["']/i);
  assert.match(html, /<label[^>]*for=["']filtro-tipo["']/i);
  assert.match(html, /<a\b(?=[^>]*id=["']atalho-carrinho["'])(?=[^>]*href=["'][^"']*carrino cliente\.html["'])[^>]*>/i);
  assert.match(html, /data-carrinho-contador/i);
  assert.match(html, /id=["']feedback-carrinho["'][^>]*role=["']status["'][^>]*aria-live=["']polite["'][^>]*aria-atomic=["']true["']/i);
  assert.match(html, /id=["']mensagem-produto["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/i);
});

test('template do produto mantém seletores funcionais e ação textual explícita', () => {
  const html = ler('tela cliente/Produtos.html');
  for (const classe of ['product-card', 'img-vitrine', 'produto-sem-imagem', 'titulo-vitrine', 'descricao-vitrine', 'preco-vitrine', 'preco-rotulo', 'preco-atual', 'badge-especial', 'btn-add-cart']) {
    assert.match(html, new RegExp(`class=["'][^"']*\\b${classe}\\b`, 'i'), `classe .${classe} ausente`);
  }
  assert.match(html, /<article\b[^>]*class=["'][^"']*product-card/i);
  assert.match(html, /<img[^>]+class=["'][^"']*img-vitrine[^"']*["'][^>]*loading=["']lazy["']/i);
  assert.match(html, /Adicionar ao pedido/i);
  assert.doesNotMatch(html, /style=["'][^"']*width\s*:\s*200px/i);
  assert.match(html, /seletor-adicionais/);
  assert.match(html, /lista-adicionais/);
  assert.match(html, /btn-confirmar-configuracao/);
  assert.match(html, /Adicionais opcionais/i);
  assert.match(html, /Escolha se quiser adicionar algo/i);
  assert.match(html, /Adicionar ao carrinho/i);
  assert.doesNotMatch(html, /<input[^>]+required/i);
});

test('seleção de adicionais usa identidade determinística por combinação', () => {
  const fonte = ler('js/carrinho.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__identidade = identidadeItem;');
  const contexto = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, document: { addEventListener: () => {} }, window: {}, Swal: { fire: () => {} } };
  vm.runInNewContext(fonte, contexto);
  assert.equal(contexto.__identidade(10, [{ id: 'b' }, { id: 'a' }]), contexto.__identidade(10, [{ id: 'a' }, { id: 'b' }]));
  assert.notEqual(contexto.__identidade(10, [{ id: 'a' }]), contexto.__identidade(10, [{ id: 'b' }]));
});

test('cardápio reutiliza o carrinho existente e oferece feedback sem alerta temporário duplicado', () => {
  const produtos = ler('js/produtos.js');
  const carrinho = ler('js/carrinho.js');
  assert.match(produtos, /import\s*\{[^}]*adicionarAoCarrinho[^}]*obterCarrinho[^}]*\}\s*from\s*['"]\.\/carrinho\.js['"]/s);
  assert.doesNotMatch(produtos, /localStorage\.(?:getItem|setItem)\(['"]carrinho['"]/);
  assert.match(produtos, /carrinho:atualizado/);
  assert.match(carrinho, /new CustomEvent\(['"]carrinho:atualizado['"]/);
  assert.doesNotMatch(carrinho, /title:\s*['"]Adicionado ao carrinho['"]/);
});

test('personalização permite zero adicionais e oferece foco/escape', () => {
  const js = ler('js/produtos.js');
  assert.match(js, /adicionarAoCarrinho\(produto, selecionados(?:, escolhasSelecionadas)?\)/);
  assert.match(js, /btn-confirmar-configuracao/);
  assert.match(js, /const primeiroCheckbox = listaEscolhas\.querySelector\('input'\) \|\| lista\.querySelector\('input'\)/);
  assert.match(js, /evento\.key === 'Escape'/);
  assert.doesNotMatch(ler('tela cliente/Produtos.html'), /<input[^>]+required/i);
});

test('produto somente com escolhas mantém a ação final fora da seção de adicionais', () => {
  const html = ler('tela cliente/Produtos.html');
  const inicioAdicionais = html.indexOf('<section class="seletor-adicionais"');
  const fimAdicionais = html.indexOf('</section>', inicioAdicionais);
  const acao = html.indexOf('class="acoes-configuracao-produto"');
  assert.ok(inicioAdicionais >= 0 && fimAdicionais > inicioAdicionais && acao > fimAdicionais);
  assert.match(html, /class="[^"]*\bbtn-confirmar-configuracao\b[^"]*"[^>]*>\s*Adicionar ao carrinho/);
  assert.match(html, /class="[^"]*\bbtn-cancelar-configuracao\b[^"]*"[^>]*>\s*Cancelar/);
});

test('limites configuráveis aceitam somente as quantidades min/max do grupo', () => {
  const fonte = ler('js/produtos.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__escolhasValidas = escolhasValidas;');
  const contexto = { document: { addEventListener: () => {} }, window: {} };
  vm.runInNewContext(fonte, contexto);
  const valido = (grupos, totais) => contexto.__escolhasValidas(grupos, id => totais[id] || 0);
  assert.equal(valido([{ id: 'g', min_escolhas: 0, max_escolhas: 5 }], { g: 0 }), true);
  assert.equal(valido([{ id: 'g', min_escolhas: 0, max_escolhas: 5 }], { g: 5 }), true);
  assert.equal(valido([{ id: 'g', min_escolhas: 1, max_escolhas: 5 }], { g: 0 }), false);
  assert.equal(valido([{ id: 'g', min_escolhas: 1, max_escolhas: 5 }], { g: 1 }), true);
  assert.equal(valido([{ id: 'g', min_escolhas: 0, max_escolhas: 3 }], { g: 4 }), false);
  assert.equal(valido([{ id: 'g', min_escolhas: 1, max_escolhas: 3 }], { g: 3 }), true);
});

test('renderização contempla carregamento, erro, vazio, filtro, promoção e imagem ausente', () => {
  const js = ler('js/produtos.js');
  for (const texto of ['Carregando cardápio', 'Não foi possível carregar', 'cardápio está sem produtos', 'Nenhum produto encontrado', 'Oferta especial', 'Imagem não disponível']) {
    assert.match(js, new RegExp(texto, 'i'), `estado ausente: ${texto}`);
  }
  assert.match(js, /imagem\.addEventListener\(['"]error['"]/);
  assert.match(js, /produto\.isEspecial/);
});

test('CSS do cardápio usa grid fluido, imagens proporcionais e ação móvel sem cobrir conteúdo', () => {
  const css = ler('css/style.css');
  assert.match(css, /\.pagina-cardapio\s+\.grid-produtos\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(/s);
  assert.match(css, /\.pagina-cardapio\s+\.produto-imagem-wrapper\s*\{[^}]*aspect-ratio:/s);
  assert.match(css, /\.pagina-cardapio\s+\.produto-imagem-wrapper img\s*\{[^}]*object-fit:\s*cover/s);
  assert.match(css, /\.pagina-cardapio\s+\.btn-add-cart\s*\{[^}]*min-height:\s*var\(--control-height-large\)/s);
  assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*\.pagina-cardapio\s+\.atalho-carrinho\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.pagina-cardapio\s+\.container\s*\{[^}]*padding-bottom:/s);
});

test('adição continua persistindo no carrinho e emite a quantidade real para a interface', () => {
  const armazenado = new Map();
  const eventos = [];
  const fonte = ler('js/carrinho.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__carrinhoTeste = { adicionarAoCarrinho, obterCarrinho, limparCarrinho };');
  const contexto = {
    localStorage: {
      getItem: chave => armazenado.get(chave) ?? null,
      setItem: (chave, valor) => armazenado.set(chave, valor),
      removeItem: chave => armazenado.delete(chave)
    },
    document: { getElementById: () => null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { dispatchEvent: evento => eventos.push(evento), addEventListener: () => {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    Swal: { fire: () => {} }, URLSearchParams, console
  };
  vm.runInNewContext(fonte, contexto);
  const produto = { id: 'p1', nome: 'Pastel de queijo', preco: 12.5 };
  assert.equal(contexto.__carrinhoTeste.adicionarAoCarrinho(produto), true);
  assert.equal(contexto.__carrinhoTeste.adicionarAoCarrinho(produto), true);
  assert.equal(JSON.parse(armazenado.get('carrinho'))[0].quantidade, 2);
  assert.equal(contexto.__carrinhoTeste.obterCarrinho()[0].quantidade, 2);
  assert.equal(eventos.at(-1).type, 'carrinho:atualizado');
  assert.equal(eventos.at(-1).detail.quantidadeTotal, 2);
  assert.equal(eventos.at(-1).detail.item.nome, produto.nome);
});

test('combinações iguais agregam e combinações diferentes permanecem separadas', () => {
  const armazenado = new Map();
  const fonte = ler('js/carrinho.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__carrinhoCombos = { adicionarAoCarrinho, obterCarrinho };');
  const contexto = {
    localStorage: { getItem: chave => armazenado.get(chave) ?? null, setItem: (chave, valor) => armazenado.set(chave, valor), removeItem: () => {} },
    document: { getElementById: () => null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { dispatchEvent: () => {}, addEventListener: () => {} }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    Swal: { fire: () => {} }, URLSearchParams, console
  };
  vm.runInNewContext(fonte, contexto);
  const produto = { id: 10, nome: 'X-Bacon', preco: 20 };
  contexto.__carrinhoCombos.adicionarAoCarrinho(produto, [{ id: 'b', nome: 'Ovo', preco: 3 }, { id: 'a', nome: 'Cheddar', preco: 5 }]);
  contexto.__carrinhoCombos.adicionarAoCarrinho(produto, [{ id: 'a', nome: 'Cheddar', preco: 5 }, { id: 'b', nome: 'Ovo', preco: 3 }]);
  contexto.__carrinhoCombos.adicionarAoCarrinho(produto, [{ id: 'c', nome: 'Catupiry', preco: 5 }]);
  const linhas = contexto.__carrinhoCombos.obterCarrinho();
  assert.equal(linhas.length, 2);
  assert.equal(linhas.find(item => item.adicionais.some(adicional => adicional.id === 'a')).quantidade, 2);
});

test('escolhas incluídas persistem, não alteram preço e distinguem configurações', () => {
  const armazenado = new Map();
  const fonte = ler('js/carrinho.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__carrinhoEscolhas = { adicionarAoCarrinho, obterCarrinho };');
  const criarContexto = () => {
    const contexto = {
      localStorage: { getItem: chave => armazenado.get(chave) ?? null, setItem: (chave, valor) => armazenado.set(chave, valor), removeItem: chave => armazenado.delete(chave) },
      document: { getElementById: () => null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
      window: { dispatchEvent: () => {}, addEventListener: () => {} }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      Swal: { fire: () => {} }, URLSearchParams, console
    };
    vm.runInNewContext(fonte, contexto);
    return contexto.__carrinhoEscolhas;
  };
  const produto = { id: 'p-escolhas', nome: 'Produto configurável', preco: 20 };
  const escolhasAB = [{ id: 'a', nome: 'A', grupo_id: 'g1', grupo_nome: 'Grupo' }, { id: 'b', nome: 'B', grupo_id: 'g1', grupo_nome: 'Grupo' }];
  const escolhasAC = [{ id: 'a', nome: 'A', grupo_id: 'g1', grupo_nome: 'Grupo' }, { id: 'c', nome: 'C', grupo_id: 'g1', grupo_nome: 'Grupo' }];
  const carrinho = criarContexto();
  carrinho.adicionarAoCarrinho(produto, [], escolhasAB);
  carrinho.adicionarAoCarrinho(produto, [], escolhasAB);
  carrinho.adicionarAoCarrinho(produto, [{ id: 'extra', nome: 'Extra', preco: 3 }], escolhasAC);
  const linhas = carrinho.obterCarrinho();
  assert.equal(linhas.length, 2);
  assert.equal(linhas.find(item => item.escolhas.some(escolha => escolha.id === 'b')).quantidade, 2);
  assert.equal(linhas.find(item => item.escolhas.some(escolha => escolha.id === 'c')).preco, 20);
  assert.equal(linhas.find(item => item.escolhas.some(escolha => escolha.id === 'c')).adicionais[0].preco, 3);
  assert.deepEqual(JSON.parse(armazenado.get('carrinho')).map(item => item.escolhas.map(escolha => escolha.id)), [['a', 'b'], ['a', 'c']]);
  const recarregado = criarContexto().obterCarrinho();
  assert.equal(recarregado.length, 2);
  assert.deepEqual([...recarregado[0].escolhas.map(escolha => escolha.id)], ['a', 'b']);
});

test('filtros preservam categoria, produtos normais e ofertas especiais', () => {
  const fonte = ler('js/produtos.js')
    .replace(/^import .*;$/gm, '')
    .replace(/\bexport\s+(?=(?:const|function|async\s+function)\b)/g, '')
    .concat('\n;globalThis.__filtrarProdutos = filtrarProdutos;');
  const contexto = { document: { addEventListener: () => {} }, window: {} };
  vm.runInNewContext(fonte, contexto);
  const lista = [
    { id: '1', categoria: 'pasteis-salgados', isEspecial: false },
    { id: '2', categoria: 'pasteis-doces', isEspecial: true },
    { id: '3', categoria: null, isEspecial: false }
  ];
  assert.deepEqual([...contexto.__filtrarProdutos(lista, 'todos', 'todos')].map(item => item.id), ['1', '2', '3']);
  assert.deepEqual([...contexto.__filtrarProdutos(lista, 'pasteis-doces', 'promocional')].map(item => item.id), ['2']);
  assert.deepEqual([...contexto.__filtrarProdutos(lista, 'pasteis-salgados', 'normal')].map(item => item.id), ['1']);
  assert.deepEqual([...contexto.__filtrarProdutos(lista, 'outros', 'normal')].map(item => item.id), ['3']);
});
