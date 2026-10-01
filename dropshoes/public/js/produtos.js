import { adicionarAoCarrinho, obterCarrinho } from './carrinho.js';

import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
let admin = false;
let carregando = false;
let produtos = [];
let ultimaAtualizacao = 0;
let temporizadorFeedback = null;
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
    const atualizados = await api('/api/produtos');
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
    const botaoCarrinho = clone.querySelector('.btn-add-cart'); if (botaoCarrinho) { botaoCarrinho.hidden = admin; botaoCarrinho.onclick = () => adicionarAoCarrinho(produto); }
    const editar = clone.querySelector('.btn-editar'); const excluir = clone.querySelector('.btn-excluir');
    if (editar) { editar.hidden = !admin; editar.onclick = () => abrirModal(produto, Boolean(produto.isEspecial)); }
    if (excluir) { excluir.hidden = !admin; excluir.onclick = () => excluirProduto(produto.id); }
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
  if (!admin || !modal || !form) return; form.reset();
  document.getElementById(`prod-id${sufixo}`).value = produto?.id || '';
  document.getElementById(`prod-nome${sufixo}`).value = produto?.nome || '';
  document.getElementById(`prod-preco${sufixo}`).value = produto ? dinheiro(produto.preco).replace('R$ ', '') : '';
  document.getElementById(`prod-descricao${sufixo}`).value = produto?.descricao || '';
  document.getElementById(`modal-produto-titulo${sufixo}`).textContent = produto ? 'Editar produto' : especial ? 'Novo produto promocional' : 'Novo produto';
  const categoria = document.getElementById(`prod-categoria${sufixo}`); if (categoria && produto?.categoria) categoria.value = produto.categoria;
  modal.showModal();
}
async function salvarProduto(event, especial) {
  event.preventDefault(); if (!admin) return;
  const produto = dadosDoFormulario(especial); const erro = validarProduto(produto);
  if (erro) return aviso(erro);
  const botao = event.target.querySelector('[type="submit"]');
  if (botao?.disabled) return;
  if (botao) botao.disabled = true;
  try {
    const retorno = await enviar(`/api/produtos${produto.id ? `/${encodeURIComponent(produto.id)}` : ''}`, produto.id ? 'PUT' : 'POST', produto);
    document.getElementById(`modal-produto${especial ? '-especial' : ''}`).close();
    await carregarProdutos(); aviso(`“${retorno.nome}” foi salvo.`);
  } catch (erro) { aviso(erro.message); alert(erro.message); }
  finally { if (botao) botao.disabled = false; }
}
async function excluirProduto(id) {
  if (!confirm('Excluir este produto do cardápio?')) return;
  try { await api(`/api/produtos/${encodeURIComponent(id)}`, { method: 'DELETE' }); await carregarProdutos(); }
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
  document.getElementById('filtro-categoria')?.addEventListener('change', renderizar);
  document.getElementById('filtro-tipo')?.addEventListener('change', renderizar);
  document.getElementById('abrirModalProduto')?.addEventListener('click', () => abrirModal());
  document.getElementById('abrirModalProdutoEspecial')?.addEventListener('click', () => abrirModal(null, true));
  document.getElementById('form-produto')?.addEventListener('submit', evento => salvarProduto(evento, false));
  document.getElementById('form-produto-especial')?.addEventListener('submit', evento => salvarProduto(evento, true));
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
