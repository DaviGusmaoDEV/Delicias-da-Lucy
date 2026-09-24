import { adicionarAoCarrinho } from './carrinho.js';

import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
let admin = false;
let carregando = false;
let produtos = [];
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const aviso = mensagem => { const area = document.getElementById('mensagem-produto'); if (area) area.textContent = mensagem; };

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
async function carregarProdutos(silencioso = false) {
  if (carregando) return;
  carregando = true;
  if (!silencioso) aviso('Carregando cardápio…');
  try {
    const atualizados = await api('/api/produtos');
    if (!silencioso || JSON.stringify(atualizados) !== JSON.stringify(produtos)) {
      produtos = atualizados; renderizar(); aviso(`${produtos.length} produto(s) no cardápio.`);
    }
  } catch (erro) { aviso(erro.message); }
  finally { carregando = false; }
}
function renderizar() {
  const lista = document.getElementById('lista-produtos'); const template = document.getElementById('template-card-produto'); const filtro = document.getElementById('filtro-categoria')?.value || 'todos';
  if (!lista || !template) return; lista.innerHTML = '';
  const tipo = document.getElementById('filtro-tipo')?.value || 'todos';
  const visiveis = produtos.filter(produto =>
    (filtro === 'todos' || (produto.categoria || 'outros') === filtro) &&
    (tipo === 'todos' || (tipo === 'promocional' ? produto.isEspecial === true : !produto.isEspecial)));
  if (!visiveis.length) { lista.innerHTML = '<p>Nenhum produto para os filtros selecionados.</p>'; return; }
  visiveis.forEach(produto => {
    const clone = template.content.cloneNode(true); const imagem = clone.querySelector('.img-vitrine');
    if (imagem) { imagem.src = produto.imagem_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=400'; imagem.alt = `Foto de ${produto.nome}`; }
    clone.querySelector('.titulo-vitrine').textContent = produto.nome;
    clone.querySelector('.descricao-vitrine').textContent = produto.descricao || '';
    clone.querySelector('.preco-vitrine').textContent = dinheiro(produto.preco);
    const destaque = clone.querySelector('.badge-especial'); if (destaque) { destaque.hidden = !produto.isEspecial; destaque.style.display = produto.isEspecial ? 'inline-block' : 'none'; }
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
    setInterval(() => { if (!document.hidden) carregarProdutos(true); }, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carregarProdutos(true); });
    window.addEventListener('focus', () => carregarProdutos(true));
  }
});
