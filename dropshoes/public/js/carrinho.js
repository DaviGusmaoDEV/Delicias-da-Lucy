import Swal from '/vendor/sweetalert2.esm.js';
import { api, enviar } from './api.js';
const WHATSAPP_LOJA = '5516996200385';
let carrinho = [];
try {
  const salvo = JSON.parse(localStorage.getItem('carrinho') || '[]');
  if (Array.isArray(salvo)) carrinho = salvo.filter(item => item && item.id && typeof item.nome === 'string' && Number.isFinite(item.preco) && item.preco > 0 && Number.isInteger(item.quantidade) && item.quantidade > 0 && item.quantidade <= 50);
} catch { localStorage.removeItem('carrinho'); }
let valorFreteAtual = 0;
let finalizando = false;
let calculoAtual = 0;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const salvar = () => localStorage.setItem('carrinho', JSON.stringify(carrinho));
export const obterCarrinho = () => carrinho.map(item => ({ ...item }));
export function limparCarrinho() { carrinho = []; localStorage.removeItem('carrinho'); renderizarCarrinho(); }
export function adicionarAoCarrinho(produto) {
  if (localStorage.getItem('role') !== 'cliente') return;
  if (!produto?.id || !produto.nome || !Number.isFinite(Number(produto.preco)) || Number(produto.preco) <= 0) return;
  const existente = carrinho.find(item => String(item.id) === String(produto.id));
  if (existente?.quantidade >= 50) return Swal.fire({ icon: 'info', text: 'O limite é de 50 unidades por produto.' });
  existente ? existente.quantidade++ : carrinho.push({ id: produto.id, nome: produto.nome, preco: Number(produto.preco), quantidade: 1 });
  salvar(); Swal.fire({ icon: 'success', title: 'Adicionado ao carrinho', timer: 1200, showConfirmButton: false }); renderizarCarrinho();
}
const subtotal = () => carrinho.reduce((total, item) => total + Math.round(item.preco * 100) * item.quantidade, 0) / 100;
function atualizarResumo() {
  for (const [id, valor] of [['cart-subtotal', subtotal()], ['cart-frete', valorFreteAtual], ['cart-total', subtotal() + valorFreteAtual]]) {
    const el = document.getElementById(id); if (el) el.textContent = dinheiro(valor);
  }
}
function renderizarCarrinho() {
  const container = document.getElementById('itens-carrinho'); const vazio = document.getElementById('carrinho-vazio-mensagem'); const template = document.getElementById('template-item-carrinho');
  if (!container || !template) return;
  container.innerHTML = ''; if (vazio) vazio.hidden = carrinho.length > 0;
  carrinho.forEach(item => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.carrinho-item-nome').textContent = item.nome;
    clone.querySelector('.carrinho-item-detalhes').textContent = `${dinheiro(item.preco)} cada`;
    clone.querySelector('.carrinho-item-qtd').textContent = item.quantidade;
    clone.querySelector('.carrinho-item-total').textContent = dinheiro(item.preco * item.quantidade);
    clone.querySelector('.btn-qtd-mais').onclick = () => mudar(item.id, 1);
    clone.querySelector('.btn-qtd-menos').onclick = () => mudar(item.id, -1);
    container.append(clone);
  }); atualizarResumo();
}
function mudar(id, delta) {
  if (finalizando) return;
  const item = carrinho.find(p => String(p.id) === String(id));
  if (!item || item.quantidade + delta > 50) return;
  item.quantidade += delta; carrinho = carrinho.filter(p => p.quantidade > 0); salvar(); renderizarCarrinho();
}
function camposEntrega() {
  return Object.fromEntries([['endereco', 'endereco'], ['numero_casa', 'numero-casa'], ['bairro', 'bairro'], ['cep', 'cep']].map(([chave, id]) => [chave, document.getElementById(id)?.value.trim() || '']));
}
export async function calcularFrete() {
  const versao = ++calculoAtual;
  const cep = document.getElementById('cep')?.value.trim();
  valorFreteAtual = 0; atualizarResumo();
  try {
    if (!cep) throw new Error('Informe o CEP para calcular a entrega.');
    const dados = await api(`/api/taxa-entrega?cep=${encodeURIComponent(cep)}`);
    if (versao !== calculoAtual || cep !== document.getElementById('cep')?.value.trim()) return false;
    if (!Number.isFinite(Number(dados.taxa)) || Number(dados.taxa) < 0) throw new Error('Taxa de entrega inválida.');
    valorFreteAtual = Number(dados.taxa);
    document.getElementById('info-frete').textContent = `Entrega em ${dados.cidade}: ${dinheiro(valorFreteAtual)}`;
    atualizarResumo(); return true;
  } catch (erro) {
    const aviso = document.getElementById('info-frete'); if (aviso && versao === calculoAtual) aviso.textContent = erro.message;
    return false;
  }
}
export async function finalizarCompra() {
  if (finalizando) return;
  if (!carrinho.length) return Swal.fire({ icon: 'info', title: 'Carrinho vazio', text: 'Escolha os produtos antes de continuar.' });
  const entrega = camposEntrega();
  if (Object.values(entrega).some(valor => !valor)) return Swal.fire({ icon: 'info', title: 'Complete o endereço', text: 'Rua, número, bairro e CEP são necessários para a entrega.' });
  const botao = document.querySelector('.btn-finalizar'); finalizando = true; if (botao) botao.disabled = true;
  try {
    if (!(await calcularFrete())) return;
    if (JSON.stringify(entrega) !== JSON.stringify(camposEntrega())) throw new Error('O endereço mudou. Confira os dados e tente novamente.');
    const pagamento = document.querySelector('input[name="pagamento"]:checked')?.value || 'a_combinar';
    const dados = await enviar('/api/pedidos', 'POST', { ...entrega, observacao_geral: document.getElementById('observacao-geral')?.value.trim() || '', pagamento, itens: carrinho.map(item => ({ produto_id: item.id, quantidade: item.quantidade, observacao_item: item.observacao || '' })) });
    const mensagem = `Olá! Quero confirmar o pedido #${dados.pedido.id}.\nNome: ${localStorage.getItem('nomeUsuario') || ''}\nEndereço: ${entrega.endereco}, nº ${entrega.numero_casa} - ${entrega.bairro}\nCEP: ${entrega.cep}\nTotal: ${dinheiro(dados.pedido.valor)}`;
    limparCarrinho();
    const online = pagamento === 'site' && dados.payment_url;
    const result = await Swal.fire({ icon: 'success', title: `Pedido #${dados.pedido.id} recebido!`, text: online ? 'Continue para pagar pelo site.' : 'Combine o pagamento com o restaurante pelo WhatsApp.', showDenyButton: true, showCancelButton: true, confirmButtonText: online ? 'Pagar pelo site' : 'Abrir WhatsApp', denyButtonText: 'Acompanhar pedido', cancelButtonText: 'Voltar ao cardápio' });
    if (result.isConfirmed && online) { window.location.assign(dados.payment_url); return; }
    if (result.isConfirmed) window.open(`https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent(mensagem)}`, '_blank', 'noopener');
    window.location.assign(result.isDismissed ? '../tela cliente/Produtos.html' : '../tela cliente/meu perfil cliente.html');
  } catch (erro) { await Swal.fire({ icon: 'error', title: 'Não foi possível finalizar', text: erro.message }); }
  finally { finalizando = false; if (botao) botao.disabled = false; }
}
window.calcularFrete = calcularFrete; window.finalizarCompra = finalizarCompra;
document.addEventListener('DOMContentLoaded', () => {
  renderizarCarrinho();
  document.getElementById('cep')?.addEventListener('input', () => { ++calculoAtual; valorFreteAtual = 0; atualizarResumo(); document.getElementById('info-frete').textContent = 'Calcule a entrega para o novo CEP.'; });
});
