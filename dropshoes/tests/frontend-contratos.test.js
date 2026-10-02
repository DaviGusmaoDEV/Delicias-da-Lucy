const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLICO = path.resolve(__dirname, '../public');
const ler = caminho => fs.readFileSync(path.join(PUBLICO, caminho), 'utf8');
const escapar = valor => valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const possuiAtributo = (html, tag, atributo, valor) => {
  const esperado = valor === undefined ? `\\b${escapar(atributo)}(?:\\s|=|>)` : `\\b${escapar(atributo)}=["']${escapar(valor)}["']`;
  assert.match(html, new RegExp(`<${tag}\\b[^>]*${esperado}`, 'i'), `${tag} precisa preservar ${atributo}${valor === undefined ? '' : `="${valor}"`}`);
};
const possuiId = (html, id) => possuiAtributo(html, '[a-z][a-z0-9-]*', 'id', id);

const contratos = [
  {
    arquivo: 'tela cliente/Produtos.html', acesso: 'cliente', publica: true,
    ids: ['filtro-categoria', 'filtro-tipo', 'lista-produtos', 'mensagem-produto', 'template-card-produto'],
    classes: ['img-vitrine', 'titulo-vitrine', 'descricao-vitrine', 'preco-vitrine', 'badge-especial', 'btn-add-cart']
  },
  {
    arquivo: 'tela cliente/carrino cliente.html', acesso: 'cliente', publica: true,
    ids: ['itens-carrinho', 'carrinho-vazio-mensagem', 'observacao-geral', 'cliente-nome', 'cliente-telefone', 'endereco', 'numero-casa', 'bairro', 'cep', 'btn-calcular-frete', 'info-frete', 'cart-subtotal', 'cart-frete', 'cart-total', 'btn-finalizar-pedido', 'template-item-carrinho'],
    classes: ['carrinho-item-nome', 'carrinho-item-detalhes', 'carrinho-item-qtd', 'carrinho-item-total', 'btn-qtd-menos', 'btn-qtd-mais']
  },
  {
    arquivo: 'tela cliente/pagamento pix.html', acesso: 'cliente',
    ids: ['pix-pedido', 'pix-total', 'pix-pendente', 'pix-conteudo', 'pix-qr', 'pix-copiar', 'pix-feedback', 'pix-expira', 'pix-finalizado', 'pix-finalizado-titulo', 'pix-finalizado-texto', 'pix-novo', 'pix-erro']
  },
  {
    arquivo: 'tela cliente/meu perfil cliente.html', acesso: 'cliente', publica: true,
    ids: ['boas-vindas-usuario', 'user-nome', 'user-email', 'user-fone', 'painel-cliente-pedidos', 'pedidos-em-andamento', 'meus-pedidos']
  },
  {
    arquivo: 'tela admin/Dashboard.html', acesso: 'admin',
    ids: ['dashboard-periodo', 'dashboard-data', 'dashboard-pedidos', 'dashboard-pagos', 'dashboard-entradas', 'dashboard-saldo', 'dashboard-atualizacao', 'dashboard-lista-pedidos', 'dashboard-lista-caixa', 'dashboard-movimentos', 'dashboard-total-movimentos']
  },
  {
    arquivo: 'tela admin/pedidos clientes.html', acesso: 'admin',
    ids: ['filtros-pedidos', 'data-pedidos', 'status-pedidos', 'atualizacao-pedidos', 'erro-pedidos', 'lista-pedidos', 'pagina-anterior', 'pagina-proxima', 'pagina-pedidos']
  },
  {
    arquivo: 'tela admin/fluxo de caixa.html', acesso: 'admin', caixa: true,
    ids: ['corpo-tabela-fluxo-caixa', 'template-linha-transacao', 'modalFiltro', 'modalTransacao', 'modalEditar', 'form-transacao', 'form-editar-transacao', 'btnAbrirModalFiltro', 'btnAbrirModalTransacao', 'btnAplicarFiltro', 'btnLimparFiltro']
  },
  {
    arquivo: 'tela admin/produtos.html', acesso: 'admin',
    ids: ['pesquisa-produto', 'filtro-categoria', 'filtro-status', 'filtro-tipo', 'abrirModalProduto', 'abrirModalProdutoEspecial', 'lista-produtos', 'mensagem-produto', 'modal-produto', 'form-produto', 'modal-produto-especial', 'form-produto-especial', 'template-card-produto'],
    classes: ['img-vitrine', 'titulo-vitrine', 'descricao-vitrine', 'preco-vitrine', 'badge-especial', 'btn-editar', 'btn-excluir']
  },
  {
    arquivo: 'tela admin/regras comerciais.html', acesso: 'admin',
    ids: ['painel-adicionais', 'painel-taxas', 'lista-adicionais-admin', 'lista-taxas-admin', 'modal-aplicar-adicional', 'lista-associacoes-produtos', 'contador-associacoes']
  },
  {
    arquivo: 'tela admin/meu perfil.html', acesso: 'admin',
    ids: ['boas-vindas-usuario', 'user-nome', 'user-email', 'user-fone']
  }
];

test('páginas preservam os IDs, classes e data attributes usados pelo JavaScript', () => {
  for (const contrato of contratos) {
    const html = ler(contrato.arquivo);
    possuiAtributo(html, 'body', 'data-acesso', contrato.acesso);
    if (contrato.publica) possuiAtributo(html, 'body', 'data-publica');
    if (contrato.caixa) possuiAtributo(html, 'body', 'data-caixa');
    for (const id of contrato.ids) possuiId(html, id);
    for (const classe of contrato.classes || []) assert.match(html, new RegExp(`class=["'][^"']*\\b${escapar(classe)}\\b`, 'i'), `${contrato.arquivo} precisa preservar .${classe}`);
  }
});

test('checkout preserva o grupo e os valores dos provedores de pagamento', () => {
  const html = ler('tela cliente/carrino cliente.html');
  for (const valor of ['mercadopago_pix', 'infinitepay', 'entrega']) {
    assert.match(html, new RegExp(`<input\\b(?=[^>]*name=["']provedor-pagamento["'])(?=[^>]*value=["']${valor}["'])[^>]*>`, 'i'));
  }
});

test('formulários de autenticação preservam os contratos de login e cadastro', () => {
  for (const arquivo of ['tela de login/login cliente.html', 'tela de login/login.html']) {
    const html = ler(arquivo);
    possuiId(html, 'form-login');
    possuiId(html, 'identificador');
    possuiId(html, 'senha');
  }
  const cadastro = ler('tela de login/cadastro cliente.html');
  for (const id of ['form-cadastro-cliente', 'nome', 'identificador', 'senha', 'cep']) possuiId(cadastro, id);
  for (const nome of ['nome', 'identificador', 'senha', 'cep']) possuiAtributo(cadastro, 'input', 'name', nome);
});

test('navegação preserva os gatilhos de sessão e autorização', () => {
  const paginas = [
    'tela cliente/principal.html', 'tela cliente/Produtos.html', 'tela cliente/carrino cliente.html', 'tela cliente/meu perfil cliente.html',
    'tela admin/principal.html', 'tela admin/Dashboard.html', 'tela admin/pedidos clientes.html', 'tela admin/fluxo de caixa.html', 'tela admin/produtos.html', 'tela admin/regras comerciais.html', 'tela admin/meu perfil.html'
  ];
  for (const arquivo of paginas) {
    const html = ler(arquivo);
    possuiId(html, 'sidebar');
    possuiAtributo(html, 'a', 'data-sair');
  }
  for (const arquivo of paginas.filter(nome => nome.startsWith('tela admin/'))) {
    assert.match(ler(arquivo), /\bdata-caixa(?:\s|=|>)/i, `${arquivo} precisa preservar data-caixa`);
  }
});

function arquivosHtml(diretorio = PUBLICO) {
  return fs.readdirSync(diretorio, { withFileTypes: true }).flatMap(item => {
    const destino = path.join(diretorio, item.name);
    return item.isDirectory() ? arquivosHtml(destino) : destino.endsWith('.html') ? [destino] : [];
  });
}

test('todas as páginas têm viewport, skip link e destino principal sem bloquear zoom', () => {
  for (const arquivo of arquivosHtml()) {
    const html = fs.readFileSync(arquivo, 'utf8');
    assert.match(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=["'][^"']*width=device-width[^"']*initial-scale=1[^"']*["']/i, arquivo);
    assert.doesNotMatch(html, /maximum-scale|user-scalable\s*=\s*no/i, arquivo);
    assert.match(html, /<a\b[^>]*class=["'][^"']*\bskip-link\b[^"']*["'][^>]*href=["']#conteudo-principal["'][^>]*>Ir para o conteúdo principal<\/a>/i, arquivo);
    assert.match(html, /<main\b[^>]*id=["']conteudo-principal["']/i, arquivo);
  }
});

test('páginas com sidebar oferecem menu textual acessível e página atual', () => {
  for (const arquivo of arquivosHtml()) {
    const html = fs.readFileSync(arquivo, 'utf8');
    if (!/class=["'][^"']*\bsidebar\b/i.test(html)) continue;
    assert.match(html, /src=["'][^"']*navegacao\.js["']/i, arquivo);
    assert.match(html, /<button\b(?=[^>]*data-menu-toggle)(?=[^>]*aria-controls=["']navegacao-principal["'])(?=[^>]*aria-expanded=["']false["'])[^>]*>[\s\S]*?Menu[\s\S]*?<\/button>/i, arquivo);
    assert.match(html, /<nav\b[^>]*id=["']navegacao-principal["'][^>]*aria-labelledby=["']menu-principal-titulo["']/i, arquivo);
    assert.match(html, /<a\b[^>]*aria-current=["']page["']/i, arquivo);
  }
});

test('navegação do cliente mantém ações importantes com rótulos explícitos', () => {
  const paginas = ['principal.html', 'Produtos.html', 'carrino cliente.html', 'meu perfil cliente.html'];
  for (const pagina of paginas) {
    const html = ler(`tela cliente/${pagina}`);
    for (const rotulo of ['Início', 'Cardápio', 'Meu carrinho', 'Meus pedidos', 'Meu perfil', 'Sair']) {
      assert.match(html, new RegExp(`>\\s*(?:<span[^>]*>[^<]*<\\/span>\\s*)?${rotulo}\\s*<`, 'i'), `${pagina}: ação ${rotulo} precisa de texto visível`);
    }
  }
});

const cor = (css, nome) => {
  const encontrada = css.match(new RegExp(`--${nome}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(encontrada, `token --${nome} precisa ser uma cor hexadecimal`);
  return encontrada[1];
};
const luminancia = hexadecimal => {
  const canais = [1, 3, 5].map(indice => parseInt(hexadecimal.slice(indice, indice + 2), 16) / 255);
  return canais.map(valor => valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4)
    .reduce((total, valor, indice) => total + valor * [0.2126, 0.7152, 0.0722][indice], 0);
};
const contraste = (a, b) => {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
};

test('tokens principais de cor atendem contraste WCAG AA para texto normal', () => {
  const css = ler('css/style.css');
  const pares = [
    ['color-brand', 'color-on-brand'],
    ['color-brand-hover', 'color-on-brand'],
    ['color-brand-strong', '#ffffff'],
    ['color-success', '#ffffff'],
    ['color-danger', '#ffffff'],
    ['color-focus', '#ffffff'],
    ['color-text-muted', '#ffffff']
  ];
  for (const [frente, fundo] of pares) {
    const a = cor(css, frente);
    const b = fundo.startsWith('#') ? fundo : cor(css, fundo);
    assert.ok(contraste(a, b) >= 4.5, `${frente}/${fundo}: ${contraste(a, b).toFixed(2)}:1`);
  }
});

test('fundação CSS protege foco, movimento reduzido e overflow estrutural', () => {
  const css = ler('css/style.css');
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /transition\s*:\s*all\b/i);
  assert.doesNotMatch(css, /overflow-x\s*:\s*hidden/i);
  assert.doesNotMatch(css, /width\s*:\s*76px/i);
  for (const token of ['space-1', 'radius-sm', 'shadow-sm', 'control-height', 'content-max', 'z-sidebar', 'duration-fast']) {
    assert.match(css, new RegExp(`--${token}:`), `token --${token} ausente`);
  }
});

test('script de navegação controla expansão, Escape e contenção de foco', () => {
  const js = ler('js/navegacao.js');
  assert.match(js, /aria-expanded/);
  assert.match(js, /event\.key\s*===\s*'Escape'/);
  assert.match(js, /event\.key\s*!==\s*'Tab'/);
  assert.match(js, /botao\.focus\(\)/);
  assert.match(js, /max-width:\s*1023px/);
});
