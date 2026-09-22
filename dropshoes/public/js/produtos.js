import { adicionarAoCarrinho } from './carrinho.js';

const API_URL = window.location.origin;
const admin = ['admin1', 'admin2'].includes(localStorage.getItem('role'));
let produtos = [];
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
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
async function carregarProdutos() {
  aviso('Carregando cardápio…');
  try {
    const resposta = await fetch(`${API_URL}/api/produtos`, { headers: headers() });
    if (!resposta.ok) throw new Error((await resposta.json()).erro || 'Não foi possível carregar o cardápio.');
    produtos = await resposta.json(); renderizar(); aviso(`${produtos.length} produto(s) no cardápio.`);
  } catch (erro) { aviso(erro.message); }
}
function renderizar() {
  const lista = document.getElementById('lista-produtos'); const template = document.getElementById('template-card-produto'); const filtro = document.getElementById('filtro-categoria')?.value || 'todos';
  if (!lista || !template) return; lista.innerHTML = '';
  const visiveis = produtos.filter(produto => filtro === 'todos' || produto.categoria === filtro);
  if (!visiveis.length) { lista.innerHTML = '<p>Nenhum produto nesta categoria.</p>'; return; }
  visiveis.forEach(produto => {
    const clone = template.content.cloneNode(true); const imagem = clone.querySelector('.img-vitrine');
    if (imagem) { imagem.src = produto.imagem_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=400'; imagem.alt = `Foto de ${produto.nome}`; }
    clone.querySelector('.titulo-vitrine').textContent = produto.nome;
    clone.querySelector('.preco-vitrine').textContent = dinheiro(produto.preco);
    const destaque = clone.querySelector('.badge-especial'); if (destaque) destaque.style.display = produto.isEspecial ? 'inline-block' : 'none';
    const botaoCarrinho = clone.querySelector('.btn-add-cart'); if (botaoCarrinho) botaoCarrinho.onclick = () => adicionarAoCarrinho(produto);
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
    isEspecial: especial
  };
}
function abrirModal(produto = null, especial = false) {
  const sufixo = especial ? '-especial' : ''; const modal = document.getElementById(`modal-produto${sufixo}`); const form = document.getElementById(`form-produto${sufixo}`);
  if (!modal || !form) return; form.reset();
  document.getElementById(`prod-id${sufixo}`).value = produto?.id || '';
  document.getElementById(`prod-nome${sufixo}`).value = produto?.nome || '';
  document.getElementById(`prod-preco${sufixo}`).value = produto ? dinheiro(produto.preco).replace('R$ ', '') : '';
  const categoria = document.getElementById(`prod-categoria${sufixo}`); if (categoria && produto?.categoria) categoria.value = produto.categoria;
  modal.showModal();
}
async function salvarProduto(event, especial) {
  event.preventDefault(); if (!admin) return;
  const produto = dadosDoFormulario(especial); const erro = validarProduto(produto);
  if (erro) return aviso(erro);
  const resposta = await fetch(`${API_URL}/api/produtos${produto.id ? `/${produto.id}` : ''}`, { method: produto.id ? 'PUT' : 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(produto) });
  const retorno = await resposta.json().catch(() => ({}));
  if (!resposta.ok) return aviso(retorno.erro || 'Não foi possível salvar o produto.');
  document.getElementById(`modal-produto${especial ? '-especial' : ''}`).close(); aviso(`“${retorno.nome}” foi salvo e já está visível no cardápio.`); carregarProdutos();
}
async function excluirProduto(id) {
  if (!confirm('Excluir este produto do cardápio?')) return;
  const resposta = await fetch(`${API_URL}/api/produtos/${id}`, { method: 'DELETE', headers: headers() });
  if (!resposta.ok) return aviso('Não foi possível excluir o produto.'); carregarProdutos();
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filtro-categoria')?.addEventListener('change', renderizar);
  document.getElementById('abrirModalProduto')?.addEventListener('click', () => abrirModal());
  document.getElementById('abrirModalProdutoEspecial')?.addEventListener('click', () => abrirModal(null, true));
  document.getElementById('form-produto')?.addEventListener('submit', evento => salvarProduto(evento, false));
  document.getElementById('form-produto-especial')?.addEventListener('submit', evento => salvarProduto(evento, true));
  document.getElementById('btn-fechar-modal')?.addEventListener('click', () => document.getElementById('modal-produto').close());
  document.getElementById('btn-fechar-modal-especial')?.addEventListener('click', () => document.getElementById('modal-produto-especial').close());
  carregarProdutos();
});
