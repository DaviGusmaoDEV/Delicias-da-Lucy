import { sessaoPronta } from './sessao.js';
import Swal from '/vendor/sweetalert2.esm.js';
import { api, enviar } from './api.js';
let carrinho = [];
try {
  const salvo = JSON.parse(localStorage.getItem('carrinho') || '[]');
  if (Array.isArray(salvo)) carrinho = salvo.filter(item => item && item.id && typeof item.nome === 'string' && Number.isFinite(item.preco) && item.preco > 0 && Number.isInteger(item.quantidade) && item.quantidade > 0 && item.quantidade <= 50);
} catch { localStorage.removeItem('carrinho'); }
let valorFreteAtual = 0;
let finalizando = false;
let calculoAtual = 0;
let cotacaoAnterior = null;
let consultaCepAnterior = '';
let consultaCepEmAndamento = null;
let cotacaoEmAndamento = null;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const salvar = () => localStorage.setItem('carrinho', JSON.stringify(carrinho));
export const obterCarrinho = () => carrinho.map(item => ({ ...item }));
export function limparCarrinho() { carrinho = []; localStorage.removeItem('carrinho'); renderizarCarrinho(); }
export function adicionarAoCarrinho(produto) {
  if (['admin1', 'admin2'].includes(localStorage.getItem('role'))) return;
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
  const entregaAtual = camposEntrega();
  const chave = JSON.stringify(entregaAtual);
  if (cotacaoAnterior?.chave === chave) { valorFreteAtual = cotacaoAnterior.dados.taxa; atualizarResumo(); return true; }
  if (cotacaoEmAndamento?.chave === chave) return cotacaoEmAndamento.promise;
  const cep = entregaAtual.cep;
  valorFreteAtual = 0; atualizarResumo();
  const promessa = (async () => { try {
    if (!cep) throw new Error('Informe o CEP para calcular a entrega.');
    const parametros = new URLSearchParams({ cep, endereco: entregaAtual.endereco, bairro: entregaAtual.bairro, numero_casa: entregaAtual.numero_casa });
    const dados = await api(`/api/taxa-entrega?${parametros}`);
    if (versao !== calculoAtual || cep !== document.getElementById('cep')?.value.trim()) return false;
    if (!Number.isFinite(Number(dados.taxa)) || Number(dados.taxa) < 0) throw new Error('Taxa de entrega inválida.');
    valorFreteAtual = Number(dados.taxa);
    for (const campo of ['endereco', 'bairro']) {
      const input = document.getElementById(campo);
      if (input && !input.value.trim()) input.value = dados[campo] || '';
    }
    cotacaoAnterior = { chave: JSON.stringify(camposEntrega()), dados };
    document.getElementById('info-frete').textContent = `Trajeto aproximado pelo CEP: ${Number(dados.distancia_km).toFixed(2).replace('.', ',')} km. ${valorFreteAtual === 0 ? 'Entrega grátis até 2 km.' : `Entrega: ${dinheiro(valorFreteAtual)}`}`;
    atualizarResumo(); return true;
  } catch (erro) {
    const aviso = document.getElementById('info-frete'); if (aviso && versao === calculoAtual) aviso.textContent = erro.message;
    return false;
  } })();
  cotacaoEmAndamento = { chave, promise: promessa };
  try { return await promessa; } finally { if (cotacaoEmAndamento?.promise === promessa) cotacaoEmAndamento = null; }
}
export async function finalizarCompra() {
  if (finalizando) return;
  if (!carrinho.length) return Swal.fire({ icon: 'info', title: 'Carrinho vazio', text: 'Escolha os produtos antes de continuar.' });
  const perfil = await sessaoPronta;
  if (!perfil) return Swal.fire({ icon: 'error', text: 'Não foi possível verificar sua sessão. Atualize a página e tente novamente.' });
  const cliente_nome = document.getElementById('cliente-nome')?.value.trim() || '';
  const cliente_telefone = document.getElementById('cliente-telefone')?.value.trim() || '';
  if (cliente_nome.length < 2 || !/^(?:55)?\d{10,11}$/.test(cliente_telefone.replace(/[\s()+-]/g, ''))) return Swal.fire({ icon: 'info', text: 'Preencha nome e telefone com DDD.' });
  const entrega = camposEntrega();
  if (Object.values(entrega).some(valor => !valor)) return Swal.fire({ icon: 'info', title: 'Complete o endereço', text: 'Rua, número, bairro e CEP são necessários para a entrega.' });
  const botao = document.querySelector('.btn-finalizar'); finalizando = true; if (botao) botao.disabled = true;
  try {
    if (!(await atualizarEntrega())) return;
    if (JSON.stringify(entrega) !== JSON.stringify(camposEntrega())) throw new Error('O endereço mudou. Confira os dados e tente novamente.');
    if (perfil?.role === 'visitante') await enviar('/api/cadastro-cliente', 'POST', { nome: cliente_nome, telefone: cliente_telefone, cep: entrega.cep });
    const corpo = { ...entrega, cliente_nome, cliente_telefone, observacao_geral: document.getElementById('observacao-geral')?.value.trim() || '', pagamento: 'site', itens: carrinho.map(item => ({ produto_id: item.id, quantidade: item.quantidade, observacao_item: item.observacao || '' })) };
    const resumo = new TextEncoder().encode(JSON.stringify(corpo));
    const assinatura = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', resumo)), b => b.toString(16).padStart(2, '0')).join('');
    let tentativa;
    try { tentativa = JSON.parse(sessionStorage.getItem('checkoutAtual')); } catch {}
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, chave: crypto.randomUUID() };
    sessionStorage.setItem('checkoutAtual', JSON.stringify(tentativa));
    const dados = await enviar('/api/pedidos', 'POST', { ...corpo, checkout_chave: tentativa.chave });
    if (!dados.payment_url || !dados.payment_url.startsWith('https://')) throw new Error('Não foi possível abrir o pagamento. Tente novamente.');
    limparCarrinho(); sessionStorage.removeItem('checkoutAtual');
    window.location.assign(dados.payment_url);
  } catch (erro) { await Swal.fire({ icon: 'error', title: 'Não foi possível finalizar', text: erro.message }); }
  finally { finalizando = false; if (botao) botao.disabled = false; }
}
async function preencherEnderecoPeloCep() {
  const cep = document.getElementById('cep')?.value.trim();
  if (!cep || cep.replace(/\D/g, '').length !== 8) return false;
  const cepNormalizado = cep.replace(/\D/g, '');
  if (consultaCepAnterior === cepNormalizado) return true;
  if (consultaCepEmAndamento) return consultaCepEmAndamento;
  consultaCepEmAndamento = (async () => {
  try {
    const dados = await api(`/api/endereco?cep=${encodeURIComponent(cep)}`);
    for (const [campo, id] of [['endereco', 'endereco'], ['bairro', 'bairro']]) {
      const input = document.getElementById(id);
      if (input && !input.value.trim()) input.value = dados[campo] || '';
    }
    consultaCepAnterior = cepNormalizado;
    return true;
  } catch (erro) {
    const aviso = document.getElementById('info-frete'); if (aviso) aviso.textContent = erro.message;
    return false;
  } finally { consultaCepEmAndamento = null; }
  })();
  return consultaCepEmAndamento;
}
async function atualizarEntrega() { await preencherEnderecoPeloCep(); return calcularFrete(); }
window.calcularFrete = atualizarEntrega; window.finalizarCompra = finalizarCompra;
document.addEventListener('DOMContentLoaded', async () => {
  const perfil = await sessaoPronta;
  for (const [id, campo] of [['cliente-nome', 'nome'], ['cliente-telefone', 'telefone'], ['cep', 'cep']]) {
    const input = document.getElementById(id); if (input && perfil?.[campo]) input.value = perfil[campo];
    if (input && perfil?.role === 'cliente' && ['cliente-nome', 'cliente-telefone'].includes(id)) input.readOnly = true;
  }
  renderizarCarrinho();
  document.getElementById('btn-calcular-frete')?.addEventListener('click', atualizarEntrega);
  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', finalizarCompra);
  document.getElementById('cep')?.addEventListener('blur', () => { if (document.getElementById('cep').value.replace(/\D/g, '').length === 8) atualizarEntrega(); });
  document.getElementById('cep')?.addEventListener('input', () => { ++calculoAtual; cotacaoAnterior = null; cotacaoEmAndamento = null; consultaCepAnterior = ''; valorFreteAtual = 0; atualizarResumo(); document.getElementById('info-frete').textContent = 'Calcule a entrega para o novo CEP.'; });
});
