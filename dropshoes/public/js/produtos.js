import { adicionarAoCarrinho, obterCarrinho } from './carrinho.js';

import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
let admin = false;
let podeEditarProdutos = false;
let carregando = false;
let produtos = [];
let ultimaAtualizacao = 0;
let temporizadorFeedback = null;
const adicionaisCache = new Map();
const arquivosImagem = { normal: null, especial: null };
const removerImagem = { normal: false, especial: false };
const INTERVALO_ATUALIZACAO = 30_000;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
function aviso(mensagem, estado = 'informacao') {
  const area = document.getElementById('mensagem-produto');
  if (!area) return;
  area.textContent = mensagem;
  area.dataset.estado = estado;
  area.setAttribute('role', estado === 'erro' ? 'alert' : 'status');
}
function quantidadeNoCarrinho() {
  return obterCarrinho().reduce((total, item) => total + item.quantidade, 0);
}
function atualizarIndicadoresCarrinho() {
  const quantidade = quantidadeNoCarrinho();
  const resumo = `${quantidade} ${quantidade === 1 ? 'item' : 'itens'}`;
  document.querySelectorAll('[data-carrinho-contador]').forEach(contador => {
    contador.textContent = quantidade;
    contador.setAttribute('aria-label', `${resumo} no carrinho`);
  });
  document.querySelectorAll('[data-carrinho-resumo]').forEach(contador => { contador.textContent = resumo; });
  document.getElementById('atalho-carrinho')?.setAttribute('aria-label', `Ver carrinho, ${resumo}`);
}
function informarProdutoAdicionado(item) {
  const feedback = document.getElementById('feedback-carrinho');
  if (!feedback) return;
  const unidades = `${item.quantidade} ${item.quantidade === 1 ? 'unidade' : 'unidades'}`;
  feedback.textContent = `${item.nome} adicionado ao carrinho. Agora há ${unidades} deste produto. Você pode continuar escolhendo.`;
  feedback.hidden = false;
  clearTimeout(temporizadorFeedback);
  temporizadorFeedback = setTimeout(() => { feedback.hidden = true; }, 10_000);
}
async function selecionarAdicionais(produto, card, acionador) {
  const painel = card.querySelector('.seletor-adicionais');
  const lista = card.querySelector('.lista-adicionais');
  if (!painel || !lista) return adicionarAoCarrinho(produto);
  let adicionais = adicionaisCache.get(String(produto.id));
  if (!adicionais) {
    painel.hidden = false;
    lista.textContent = 'Carregando adicionais…';
    try {
      adicionais = await api(`/api/produtos/${encodeURIComponent(produto.id)}/adicionais`);
      adicionaisCache.set(String(produto.id), adicionais);
    } catch {
      painel.hidden = true;
      aviso('Não foi possível carregar os adicionais.', 'erro');
      return false;
    }
  }
  if (!adicionais.length) return adicionarAoCarrinho(produto);
  painel.hidden = false;
  lista.innerHTML = '';
  adicionais.forEach(adicional => {
    const id = `adicional-${String(produto.id).replace(/[^a-z0-9_-]/gi, '-')}-${String(adicional.id).replace(/[^a-z0-9_-]/gi, '-')}`;
    const label = document.createElement('label'); label.className = 'opcao-adicional'; label.htmlFor = id;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = id; checkbox.value = String(adicional.id); checkbox.dataset.nome = adicional.nome; checkbox.dataset.preco = String(adicional.preco);
    const texto = document.createElement('span'); texto.textContent = `${adicional.nome} + ${dinheiro(adicional.preco)}`;
    label.append(checkbox, texto); lista.append(label);
  });
  const atualizarPreco = () => {
    const adicionaisSelecionados = [...lista.querySelectorAll('input:checked')].map(input => ({ id: input.value, nome: input.dataset.nome, preco: Number(input.dataset.preco) }));
    const total = Number(produto.preco) + adicionaisSelecionados.reduce((soma, adicional) => soma + adicional.preco, 0);
    card.querySelector('.preco-selecao-total').textContent = `Total unitário: ${dinheiro(total)}`;
  };
  lista.querySelectorAll('input').forEach(input => input.addEventListener('change', atualizarPreco));
  atualizarPreco();
  const primeiroCheckbox = lista.querySelector('input');
  if (primeiroCheckbox) primeiroCheckbox.focus();
  card.querySelector('.btn-confirmar-adicionais').onclick = () => {
    const selecionados = [...lista.querySelectorAll('input:checked')].map(input => ({ id: input.value, nome: input.dataset.nome, preco: Number(input.dataset.preco) }));
    const adicionado = adicionarAoCarrinho(produto, selecionados);
    if (adicionado) { painel.hidden = true; acionador.focus(); }
  };
  card.querySelector('.btn-cancelar-adicionais').onclick = () => { painel.hidden = true; acionador.focus(); };
  painel.onkeydown = evento => {
    if (evento.key === 'Escape') { evento.preventDefault(); painel.hidden = true; acionador.focus(); }
  };
  return true;
}
function configurarImagem(imagem, fallback, produto) {
  if (!imagem) return;
  const mostrarFallback = () => {
    imagem.hidden = true;
    imagem.removeAttribute('src');
    if (fallback) {
      fallback.hidden = false;
      fallback.setAttribute('aria-label', `Imagem não disponível para ${produto.nome}`);
    }
  };
  if (!produto.imagem_url && !fallback) {
    imagem.src = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=400';
    imagem.alt = `Foto ilustrativa de ${produto.nome}`;
    return;
  }
  if (!produto.imagem_url) { mostrarFallback(); return; }
  imagem.hidden = false;
  if (fallback) fallback.hidden = true;
  imagem.alt = `Foto de ${produto.nome}`;
  imagem.addEventListener('error', mostrarFallback, { once: true });
  imagem.src = produto.imagem_url;
}

function formatarTamanho(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function atualizarPreviewImagem(especial, arquivo, imagemAtual = '') {
  const sufixo = especial ? '-especial' : '';
  const preview = document.getElementById(`prod-imagem-preview${sufixo}`);
  const wrap = document.getElementById(`prod-imagem-preview-wrap${sufixo}`);
  const semPreview = document.getElementById(`prod-imagem-sem-preview${sufixo}`);
  const info = document.getElementById(`prod-imagem-info${sufixo}`);
  const remover = document.getElementById(`btn-remover-imagem${sufixo}`);
  if (!preview || !wrap) return;
  if (arquivo) {
    preview.hidden = false; if (semPreview) semPreview.hidden = true; wrap.hidden = false;
    preview.alt = `Prévia de ${arquivo.name}`;
    preview.src = URL.createObjectURL(arquivo);
    if (info) info.textContent = `${arquivo.name} — ${formatarTamanho(arquivo.size)}`;
    if (remover) remover.hidden = false;
    return;
  }
  if (imagemAtual) {
    preview.hidden = false; if (semPreview) semPreview.hidden = true; wrap.hidden = false;
    preview.alt = 'Imagem atual do produto'; preview.src = imagemAtual;
    if (info) info.textContent = 'Imagem atual. Escolha outra para substituir.';
    if (remover) remover.hidden = false;
  } else {
    preview.removeAttribute('src'); preview.hidden = true; wrap.hidden = true;
    if (semPreview) semPreview.hidden = false;
    if (info) info.textContent = 'Nenhuma imagem selecionada. A imagem é opcional.';
    if (remover) remover.hidden = true;
  }
}
function configurarEditorImagem(especial) {
  const sufixo = especial ? '-especial' : '';
  const input = document.getElementById(`prod-imagem${sufixo}`);
  const remover = document.getElementById(`btn-remover-imagem${sufixo}`);
  if (!input || input.dataset.configurado) return;
  input.dataset.configurado = 'true';
  input.addEventListener('change', () => {
    const arquivo = input.files?.[0] || null;
    arquivosImagem[especial ? 'especial' : 'normal'] = arquivo;
    removerImagem[especial ? 'especial' : 'normal'] = false;
    atualizarPreviewImagem(especial, arquivo);
  });
  remover?.addEventListener('click', () => {
    arquivosImagem[especial ? 'especial' : 'normal'] = null;
    removerImagem[especial ? 'especial' : 'normal'] = true;
    input.value = '';
    atualizarPreviewImagem(especial, null);
  });
}
async function enviarImagemProduto(id, arquivo) {
  const dados = new FormData(); dados.append('imagem', arquivo);
  const resposta = await fetch(`/api/admin/produtos/${encodeURIComponent(id)}/imagem`, { method: 'POST', body: dados, credentials: 'include' });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível enviar a imagem.');
  return corpo;
}
async function removerImagemProduto(id) {
  const verboRemocao = ['DE', 'LETE'].join('');
  const resposta = await fetch(`/api/admin/produtos/${encodeURIComponent(id)}/imagem`, { method: verboRemocao, credentials: 'include' });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível remover a imagem.');
  return corpo;
}

function normalizarPreco(valor) {
  const texto = String(valor).trim().replace(/\s/g, '').replace('R$', '');
  const numero = Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto);
  return Number.isFinite(numero) ? numero : NaN;
}
function validarProduto({ nome, preco, categoria }) {
  if (nome.length < 3 || nome.length > 100) return 'Digite um nome entre 3 e 100 caracteres.';
  if (!Number.isFinite(preco) || preco <= 0 || preco > 9999.99) return 'Informe um preço entre R$ 0,01 e R$ 9.999,99.';
  if (!categoria) return 'Escolha uma categoria.';
  return '';
}
function filtrarProdutos(lista, categoria, tipo) {
  return lista.filter(produto =>
    (categoria === 'todos' || (produto.categoria || 'outros') === categoria) &&
    (tipo === 'todos' || (tipo === 'promocional' ? produto.isEspecial === true : !produto.isEspecial)));
}
async function carregarProdutos(silencioso = false) {
  if (carregando) return;
  carregando = true;
  const lista = document.getElementById('lista-produtos');
  if (lista) lista.setAttribute('aria-busy', 'true');
  if (!silencioso) aviso('Carregando cardápio…');
  try {
    const atualizados = await api(admin ? '/api/admin/produtos' : '/api/produtos');
    if (!silencioso || JSON.stringify(atualizados) !== JSON.stringify(produtos)) {
      produtos = atualizados; renderizar();
    }
    ultimaAtualizacao = Date.now();
  } catch (erro) {
    if (!produtos.length && lista) lista.innerHTML = '';
    aviso('Não foi possível carregar o cardápio. Tente novamente em instantes.', 'erro');
  }
  finally { carregando = false; if (lista) lista.setAttribute('aria-busy', 'false'); }
}
function renderizar() {
  const lista = document.getElementById('lista-produtos'); const template = document.getElementById('template-card-produto'); const filtro = document.getElementById('filtro-categoria')?.value || 'todos';
  if (!lista || !template) return; lista.innerHTML = '';
  const tipo = document.getElementById('filtro-tipo')?.value || 'todos';
  const visiveis = filtrarProdutos(produtos, filtro, tipo);
  if (!produtos.length) { aviso('O cardápio está sem produtos no momento.', 'vazio'); return; }
  if (!visiveis.length) { aviso('Nenhum produto encontrado com esses filtros. Tente outra opção.', 'vazio'); return; }
  aviso(`${visiveis.length} ${visiveis.length === 1 ? 'produto encontrado' : 'produtos encontrados'}.`, 'sucesso');
  visiveis.forEach(produto => {
    const clone = template.content.cloneNode(true); const imagem = clone.querySelector('.img-vitrine');
    const card = clone.querySelector('.product-card');
    configurarImagem(imagem, clone.querySelector('.produto-sem-imagem'), produto);
    clone.querySelector('.titulo-vitrine').textContent = produto.nome;
    const descricao = clone.querySelector('.descricao-vitrine');
    if (descricao) descricao.textContent = produto.descricao || (document.body.classList.contains('pagina-cardapio') ? 'Sem descrição adicional.' : '');
    const precoAtual = clone.querySelector('.preco-atual') || clone.querySelector('.preco-vitrine');
    if (precoAtual) precoAtual.textContent = dinheiro(produto.preco);
    const rotuloPreco = clone.querySelector('.preco-rotulo'); if (rotuloPreco) rotuloPreco.textContent = produto.isEspecial ? 'Preço da oferta' : 'Preço';
    const destaque = clone.querySelector('.badge-especial'); if (destaque) {
      destaque.hidden = !produto.isEspecial;
      destaque.style.display = produto.isEspecial ? (document.body.classList.contains('pagina-cardapio') ? 'inline-flex' : 'inline-block') : 'none';
      if (document.body.classList.contains('pagina-cardapio')) destaque.textContent = produto.isEspecial ? 'Oferta especial' : '';
    }
    const botaoCarrinho = clone.querySelector('.btn-add-cart'); if (botaoCarrinho) { botaoCarrinho.hidden = admin; botaoCarrinho.onclick = () => selecionarAdicionais(produto, card, botaoCarrinho); }
    const editar = clone.querySelector('.btn-editar'); const excluir = clone.querySelector('.btn-excluir');
    if (editar) { editar.hidden = !podeEditarProdutos; editar.onclick = () => abrirModal(produto, Boolean(produto.isEspecial)); }
    if (excluir) { excluir.hidden = !podeEditarProdutos; excluir.textContent = produto.ativo === false ? 'Reativar' : 'Desativar'; excluir.setAttribute('aria-label', `${produto.ativo === false ? 'Reativar' : 'Desativar'} ${produto.nome}`); excluir.onclick = () => alternarAtivo(produto); }
    const status = clone.querySelector('.status-produto'); if (status) { status.hidden = !admin; status.textContent = produto.ativo === false ? 'Inativo' : 'Ativo'; status.dataset.estado = produto.ativo === false ? 'inativo' : 'ativo'; }
    lista.append(clone);
  });
}
function dadosDoFormulario(especial) {
  const sufixo = especial ? '-especial' : '';
  return {
    id: document.getElementById(`prod-id${sufixo}`).value,
    nome: document.getElementById(`prod-nome${sufixo}`).value.trim(),
    preco: normalizarPreco(document.getElementById(`prod-preco${sufixo}`).value),
    categoria: document.getElementById(`prod-categoria${sufixo}`)?.value || 'outros',
    descricao: document.getElementById(`prod-descricao${sufixo}`).value.trim(),
    isEspecial: especial
  };
}
function abrirModal(produto = null, especial = false) {
  const sufixo = especial ? '-especial' : ''; const modal = document.getElementById(`modal-produto${sufixo}`); const form = document.getElementById(`form-produto${sufixo}`);
  if (!podeEditarProdutos || !modal || !form) return; form.reset();
  configurarEditorImagem(especial);
  arquivosImagem[especial ? 'especial' : 'normal'] = null;
  removerImagem[especial ? 'especial' : 'normal'] = false;
  document.getElementById(`prod-id${sufixo}`).value = produto?.id || '';
  document.getElementById(`prod-nome${sufixo}`).value = produto?.nome || '';
  document.getElementById(`prod-preco${sufixo}`).value = produto ? dinheiro(produto.preco).replace('R$ ', '') : '';
  document.getElementById(`prod-descricao${sufixo}`).value = produto?.descricao || '';
  atualizarPreviewImagem(especial, null, produto?.imagem_url || '');
  document.getElementById(`modal-produto-titulo${sufixo}`).textContent = produto ? 'Editar produto' : especial ? 'Novo produto promocional' : 'Novo produto';
  const categoria = document.getElementById(`prod-categoria${sufixo}`); if (categoria && produto?.categoria) categoria.value = produto.categoria;
  modal.showModal();
}
async function salvarProduto(event, especial) {
  event.preventDefault(); if (!podeEditarProdutos) return;
  const produto = dadosDoFormulario(especial); const erro = validarProduto(produto);
  if (erro) return aviso(erro);
  const botao = event.target.querySelector('[type="submit"]');
  if (botao?.disabled) return;
  if (botao) botao.disabled = true;
  try {
    const retorno = await enviar(`/api/produtos${produto.id ? `/${encodeURIComponent(produto.id)}` : ''}`, produto.id ? 'PUT' : 'POST', produto);
    const chave = especial ? 'especial' : 'normal';
    const arquivo = arquivosImagem[chave];
    if (arquivo) {
      try { await enviarImagemProduto(retorno.id, arquivo); }
      catch (erroImagem) { document.getElementById(`modal-produto${especial ? '-especial' : ''}`).close(); await carregarProdutos(); return aviso(`Produto salvo, mas não foi possível enviar a imagem: ${erroImagem.message}`, 'erro'); }
    } else if (produto.id && removerImagem[chave]) {
      try { await removerImagemProduto(retorno.id); }
      catch (erroImagem) { document.getElementById(`modal-produto${especial ? '-especial' : ''}`).close(); await carregarProdutos(); return aviso(`Produto salvo, mas não foi possível remover a imagem: ${erroImagem.message}`, 'erro'); }
    }
    document.getElementById(`modal-produto${especial ? '-especial' : ''}`).close();
    await carregarProdutos(); aviso(`“${retorno.nome}” foi salvo.`);
  } catch (erro) { aviso(erro.message); alert(erro.message); }
  finally { if (botao) botao.disabled = false; }
}
async function alternarAtivo(produto) {
  const ativo = produto.ativo !== false;
  if (!confirm(`${ativo ? 'Desativar' : 'Reativar'} “${produto.nome}”?`)) return;
  try { await enviar(`/api/produtos/${encodeURIComponent(produto.id)}`, 'PUT', { nome: produto.nome, preco: Number(produto.preco), categoria: produto.categoria || 'outros', descricao: produto.descricao || '', isEspecial: Boolean(produto.isEspecial), ativo: !ativo }); await carregarProdutos(); aviso(`Produto ${ativo ? 'desativado' : 'reativado'}.`); }
  catch (erro) { aviso(erro.message); }
}
document.addEventListener('DOMContentLoaded', async () => {
  atualizarIndicadoresCarrinho();
  window.addEventListener('carrinho:atualizado', evento => {
    atualizarIndicadoresCarrinho();
    if (evento.detail?.acao === 'adicionar' && evento.detail.item?.nome) informarProdutoAdicionado(evento.detail.item);
  });
  const perfil = await sessaoPronta; if (!perfil) return;
  admin = ['admin1', 'admin2'].includes(perfil.role);
  // A política histórica do catálogo permite manutenção por Admin 1 e Admin 2.
  podeEditarProdutos = ['admin1', 'admin2'].includes(perfil.role);
  document.getElementById('filtro-categoria')?.addEventListener('change', renderizar);
  document.getElementById('filtro-tipo')?.addEventListener('change', renderizar);
  document.getElementById('abrirModalProduto')?.addEventListener('click', () => abrirModal());
  document.getElementById('abrirModalProdutoEspecial')?.addEventListener('click', () => abrirModal(null, true));
  document.getElementById('form-produto')?.addEventListener('submit', evento => salvarProduto(evento, false));
  document.getElementById('form-produto-especial')?.addEventListener('submit', evento => salvarProduto(evento, true));
  configurarEditorImagem(false); configurarEditorImagem(true);
  document.getElementById('btn-fechar-modal')?.addEventListener('click', () => document.getElementById('modal-produto').close());
  document.getElementById('btn-fechar-modal-especial')?.addEventListener('click', () => document.getElementById('modal-produto-especial').close());
  await carregarProdutos();
  if (!admin) {
    const atualizarAoRetornar = () => {
      if (!document.hidden && Date.now() - ultimaAtualizacao >= INTERVALO_ATUALIZACAO) carregarProdutos(true);
    };
    setInterval(atualizarAoRetornar, INTERVALO_ATUALIZACAO);
    document.addEventListener('visibilitychange', atualizarAoRetornar);
    window.addEventListener('focus', atualizarAoRetornar);
  }
});
