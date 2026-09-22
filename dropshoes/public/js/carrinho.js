import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';
const API_URL = window.location.origin;
const WHATSAPP_LOJA = '5516996200385';
let carrinho = JSON.parse(localStorage.getItem('carrinho') || '[]');
let valorFreteAtual = 0;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const salvar = () => localStorage.setItem('carrinho', JSON.stringify(carrinho));
export const obterCarrinho = () => [...carrinho];
export function limparCarrinho() { carrinho = []; localStorage.removeItem('carrinho'); }
export function adicionarAoCarrinho(produto) {
  if (!produto?.id || !produto.nome || Number(produto.preco) <= 0) return;
  const existente = carrinho.find(item => String(item.id) === String(produto.id));
  existente ? existente.quantidade++ : carrinho.push({ id: produto.id, nome: produto.nome, preco: Number(produto.preco), quantidade: 1 });
  salvar(); Swal.fire({ icon: 'success', title: 'Adicionado ao carrinho', timer: 1200, showConfirmButton: false }); renderizarCarrinho();
}
function subtotal() { return carrinho.reduce((total, item) => total + item.preco * item.quantidade, 0); }
function atualizarResumo() { document.getElementById('cart-subtotal').textContent = dinheiro(subtotal()); document.getElementById('cart-frete').textContent = dinheiro(valorFreteAtual); document.getElementById('cart-total').textContent = dinheiro(subtotal() + valorFreteAtual); }
function renderizarCarrinho() {
  const container = document.getElementById('itens-carrinho'); const vazio = document.getElementById('carrinho-vazio-mensagem'); const template = document.getElementById('template-item-carrinho');
  if (!container || !template) return; container.innerHTML = ''; vazio.hidden = carrinho.length > 0;
  carrinho.forEach(item => { const clone = template.content.cloneNode(true); clone.querySelector('.carrinho-item-nome').textContent = item.nome; clone.querySelector('.carrinho-item-detalhes').textContent = `${dinheiro(item.preco)} cada`; clone.querySelector('.carrinho-item-qtd').textContent = item.quantidade; clone.querySelector('.carrinho-item-total').textContent = dinheiro(item.preco * item.quantidade); clone.querySelector('.btn-qtd-mais').onclick = () => mudar(item.id, 1); clone.querySelector('.btn-qtd-menos').onclick = () => mudar(item.id, -1); container.append(clone); }); atualizarResumo();
}
function mudar(id, delta) { const item = carrinho.find(p => String(p.id) === String(id)); if (!item) return; item.quantidade += delta; carrinho = carrinho.filter(p => p.quantidade > 0); salvar(); renderizarCarrinho(); }
function camposEntrega() { return { endereco: document.getElementById('endereco').value.trim(), numero_casa: document.getElementById('numero-casa').value.trim(), bairro: document.getElementById('bairro').value.trim(), cep: document.getElementById('cep').value.trim() }; }
async function calcularFrete() {
  const cep = document.getElementById('cep').value.trim(); if (!cep) return Swal.fire({ icon: 'info', title: 'Informe o CEP', text: 'Digite o CEP de Ribeirão Preto para calcular a entrega.' });
  const resposta = await fetch(`${API_URL}/api/taxa-entrega?cep=${encodeURIComponent(cep)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); const dados = await resposta.json();
  if (!resposta.ok) return Swal.fire({ icon: 'warning', title: 'Entrega indisponível', text: dados.erro }); valorFreteAtual = Number(dados.taxa); document.getElementById('info-frete').textContent = `Entrega em ${dados.cidade}: ${dinheiro(valorFreteAtual)}`; atualizarResumo();
}
async function finalizarCompra() {
  if (!carrinho.length) return Swal.fire({ icon: 'info', title: 'Carrinho vazio', text: 'Escolha os produtos antes de continuar.' });
  const entrega = camposEntrega(); if (Object.values(entrega).some(valor => !valor)) return Swal.fire({ icon: 'info', title: 'Complete o endereço', text: 'Rua, número, bairro e CEP são necessários para a entrega.' });
  await calcularFrete(); if (!valorFreteAtual) return;
  const resposta = await fetch(`${API_URL}/api/pedidos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ ...entrega, observacao_geral: document.getElementById('observacao-geral').value.trim(), pagamento: document.querySelector('input[name="pagamento"]:checked')?.value || 'a_combinar', itens: carrinho.map(item => ({ produto_id: item.id, quantidade: item.quantidade, observacao_item: item.observacao || '' })) }) });
  const dados = await resposta.json(); if (!resposta.ok) return Swal.fire({ icon: 'error', title: 'Não foi possível criar o pedido', text: dados.erro });
  const mensagem = `Olá! Quero confirmar o pedido #${dados.pedido.id}.\nNome: ${localStorage.getItem('nomeUsuario') || ''}\nEndereço: ${entrega.endereco}, nº ${entrega.numero_casa} - ${entrega.bairro}\nCEP: ${entrega.cep}\nTotal: ${dinheiro(dados.pedido.valor)}`;
  const peloSite = document.querySelector('input[name="pagamento"]:checked')?.value === 'site';
  limparCarrinho(); await Swal.fire({ icon: 'success', title: `Pedido #${dados.pedido.id} recebido!`, text: peloSite ? 'Continue para pagar com segurança pelo site ou acompanhe com o restaurante.' : 'Confirme o pagamento ou acompanhe pelo WhatsApp do restaurante.', showDenyButton: true, showCancelButton: true, confirmButtonText: peloSite ? 'Pagar pelo site' : 'Pagar pelo WhatsApp', denyButtonText: 'Acompanhar pedido', cancelButtonText: 'Voltar ao cardápio' }).then(result => { if (result.isConfirmed) { if (peloSite && dados.payment_url) window.location.assign(dados.payment_url); else window.open(`https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent(mensagem)}`, '_blank'); } if (result.isDenied) window.open(`https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent(mensagem)}`, '_blank'); if (!peloSite || !dados.payment_url || result.isDenied || result.isDismissed) window.location.href = result.isDenied ? './meu perfil cliente.html' : './Produtos.html'; });
}
window.calcularFrete = calcularFrete; window.finalizarCompra = finalizarCompra;
document.addEventListener('DOMContentLoaded', renderizarCarrinho);
