import { sessaoPronta } from './sessao.js';
import Swal from '/vendor/sweetalert2.esm.js';
import { api, enviar } from './api.js';
let carrinho = [];
try {
  const salvo = JSON.parse(localStorage.getItem('carrinho') || '[]');
  if (Array.isArray(salvo)) carrinho = salvo.filter(item => item && item.id && typeof item.nome === 'string' && Number.isFinite(item.preco) && item.preco > 0 && Number.isInteger(item.quantidade) && item.quantidade > 0 && item.quantidade <= 50).map(item => ({ ...item, adicionais: Array.isArray(item.adicionais) ? item.adicionais.filter(adicional => adicional?.id != null && typeof adicional.nome === 'string' && Number.isFinite(Number(adicional.preco)) && Number(adicional.preco) >= 0).map(adicional => ({ id: adicional.id, nome: adicional.nome, preco: Number(adicional.preco) })).sort((a, b) => String(a.id).localeCompare(String(b.id))) : [] }));
} catch { localStorage.removeItem('carrinho'); }
let valorFreteAtual = 0;
let finalizando = false;
let calculoAtual = 0;
let cotacaoAnterior = null;
let consultaCepAnterior = '';
let consultaCepEmAndamento = null;
let cotacaoEmAndamento = null;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const precoUnitarioVisual = item => Number(item.preco || 0) + (item.adicionais || []).reduce((total, adicional) => total + Number(adicional.preco || 0), 0);
function informarFrete(mensagem, erro = false) {
  const aviso = document.getElementById('info-frete');
  if (!aviso) return;
  aviso.textContent = mensagem;
  aviso.classList.toggle('info-frete-erro', erro);
  aviso.setAttribute('role', erro ? 'alert' : 'status');
}
const cepComFormatoValido = cep => /^\d{8}$/.test(String(cep || '').replace(/\D/g, ''));
const salvar = () => localStorage.setItem('carrinho', JSON.stringify(carrinho));
const quantidadeTotal = () => carrinho.reduce((total, item) => total + item.quantidade, 0);
function emitirAtualizacao(acao, item = null) {
  window.dispatchEvent(new CustomEvent('carrinho:atualizado', {
    detail: { acao, item: item ? { ...item } : null, quantidadeTotal: quantidadeTotal() }
  }));
}
function limparErroCampo(id) {
  const campo = document.getElementById(id);
  const erro = document.getElementById(`erro-${id}`);
  if (campo) campo.setAttribute('aria-invalid', 'false');
  if (erro) { erro.textContent = ''; erro.hidden = true; }
}
function marcarErroCampo(id, mensagem, focar = false) {
  const campo = document.getElementById(id);
  const erro = document.getElementById(`erro-${id}`);
  if (campo) campo.setAttribute('aria-invalid', 'true');
  if (erro) { erro.textContent = mensagem; erro.hidden = false; }
  if (focar) campo?.focus();
}
function limparErrosCheckout() {
  document.querySelectorAll('[aria-invalid="true"]').forEach(campo => campo.setAttribute('aria-invalid', 'false'));
  document.querySelectorAll('.form-error').forEach(erro => { erro.textContent = ''; erro.hidden = true; });
}
function atualizarTipoPagamentoEntrega() {
  const provedor = document.querySelector('input[name="provedor-pagamento"]:checked')?.value;
  const tipo = document.querySelector('input[name="tipo-pagamento-entrega"]:checked')?.value;
  const area = document.getElementById('tipo-pagamento-entrega');
  const ativo = provedor === 'entrega';
  if (area) area.hidden = !ativo;
  const campoTroco = document.getElementById('troco-pagamento-container');
  const mostrarTroco = ativo && tipo === 'dinheiro';
  if (campoTroco) campoTroco.hidden = !mostrarTroco;
  if (!mostrarTroco) {
    const input = document.getElementById('troco-pagamento');
    if (input) input.value = '';
    const erroTroco = document.getElementById('erro-troco-pagamento');
    if (erroTroco) { erroTroco.textContent = ''; erroTroco.hidden = true; }
  }
  if (!ativo) {
    document.querySelectorAll('input[name="tipo-pagamento-entrega"]').forEach(opcao => { opcao.checked = false; });
    const erro = document.getElementById('erro-tipo-pagamento-entrega');
    if (erro) { erro.textContent = ''; erro.hidden = true; }
  }
}
function parseMoedaBrasileira(valor) {
  const texto = String(valor || '').trim().replace(/R\$\s*/gi, '').replace(/\s/g, '');
  if (!texto) return null;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : NaN;
}
export const obterCarrinho = () => carrinho.map(item => ({ ...item }));
export function limparCarrinho() { carrinho = []; localStorage.removeItem('carrinho'); renderizarCarrinho(); emitirAtualizacao('limpar'); }
export const identidadeItem = (produtoId, adicionais = []) => `${String(produtoId)}|${adicionais.map(adicional => String(adicional.id)).sort((a, b) => a.localeCompare(b)).join(',')}`;
function adicionaisNormalizados(adicionais) {
  if (!Array.isArray(adicionais)) return [];
  const vistos = new Set();
  return adicionais.filter(adicional => adicional?.id != null && typeof adicional.nome === 'string' && Number.isFinite(Number(adicional.preco)) && Number(adicional.preco) >= 0).map(adicional => ({ id: adicional.id, nome: adicional.nome, preco: Number(adicional.preco) })).filter(adicional => !vistos.has(String(adicional.id)) && vistos.add(String(adicional.id))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
export function adicionarAoCarrinho(produto, adicionais = []) {
  if (['admin1', 'admin2'].includes(localStorage.getItem('role'))) return false;
  if (!produto?.id || !produto.nome || !Number.isFinite(Number(produto.preco)) || Number(produto.preco) <= 0) return false;
  const adicionaisSelecionados = adicionaisNormalizados(adicionais);
  const identidade = identidadeItem(produto.id, adicionaisSelecionados);
  const existente = carrinho.find(item => identidadeItem(item.id, item.adicionais || []) === identidade);
  if (existente?.quantidade >= 50) { Swal.fire({ icon: 'info', text: 'O limite é de 50 unidades por produto.' }); return false; }
  existente ? existente.quantidade++ : carrinho.push({ id: produto.id, nome: produto.nome, preco: Number(produto.preco), quantidade: 1, adicionais: adicionaisSelecionados });
  const itemAtualizado = carrinho.find(item => identidadeItem(item.id, item.adicionais || []) === identidade);
  salvar(); renderizarCarrinho(); emitirAtualizacao('adicionar', itemAtualizado); return true;
}
const subtotal = () => carrinho.reduce((total, item) => total + Math.round(precoUnitarioVisual(item) * 100) * item.quantidade, 0) / 100;
function atualizarResumo() {
  for (const [id, valor] of [['cart-subtotal', subtotal()], ['cart-frete', valorFreteAtual], ['cart-total', subtotal() + valorFreteAtual]]) {
    const el = document.getElementById(id); if (el) el.textContent = dinheiro(valor);
  }
}
function renderizarCarrinho() {
  const container = document.getElementById('itens-carrinho'); const vazioMensagem = document.getElementById('carrinho-vazio-mensagem'); const vazio = vazioMensagem?.closest('.carrinho-vazio') || vazioMensagem; const template = document.getElementById('template-item-carrinho');
  if (!container || !template) return;
  container.innerHTML = ''; if (vazio) vazio.hidden = carrinho.length > 0;
  carrinho.forEach(item => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.carrinho-item-nome').textContent = item.nome;
    clone.querySelector('.carrinho-item-detalhes').textContent = `${dinheiro(item.preco + (item.adicionais || []).reduce((total, adicional) => total + Number(adicional.preco || 0), 0))} cada`;
    const adicionaisEl = clone.querySelector('.carrinho-item-adicionais');
    const adicionaisTexto = (item.adicionais || []).map(adicional => `${adicional.nome} + ${dinheiro(adicional.preco)}`).join(' · ');
    if (adicionaisEl) { adicionaisEl.textContent = adicionaisTexto; adicionaisEl.hidden = !adicionaisTexto; }
    clone.querySelector('.carrinho-item-qtd').textContent = item.quantidade;
    clone.querySelector('.carrinho-item-total').textContent = dinheiro(precoUnitarioVisual(item) * item.quantidade);
    clone.querySelector('.btn-qtd-mais').setAttribute('aria-label', `Aumentar quantidade de ${item.nome}`);
    clone.querySelector('.btn-qtd-menos').setAttribute('aria-label', `Diminuir quantidade de ${item.nome}`);
    clone.querySelector('.btn-qtd-mais').onclick = () => mudar(item, 1);
    clone.querySelector('.btn-qtd-menos').onclick = () => mudar(item, -1);
    clone.querySelector('.btn-remover-item').setAttribute('aria-label', `Remover ${item.nome} do carrinho`);
    clone.querySelector('.btn-remover-item').onclick = () => removerItem(item);
    container.append(clone);
  }); atualizarResumo();
}
function mudar(referencia, delta) {
  if (finalizando) return;
  const identidade = typeof referencia === 'object' ? identidadeItem(referencia.id, referencia.adicionais || []) : String(referencia);
  const item = carrinho.find(p => identidadeItem(p.id, p.adicionais || []) === identidade);
  if (!item || item.quantidade + delta > 50) return;
  item.quantidade += delta; carrinho = carrinho.filter(p => p.quantidade > 0); salvar(); renderizarCarrinho(); emitirAtualizacao('alterar', item.quantidade > 0 ? item : null);
}
function removerItem(referencia) {
  if (finalizando) return;
  const identidade = typeof referencia === 'object' ? identidadeItem(referencia.id, referencia.adicionais || []) : String(referencia);
  const item = carrinho.find(p => identidadeItem(p.id, p.adicionais || []) === identidade);
  if (!item) return;
  carrinho = carrinho.filter(p => identidadeItem(p.id, p.adicionais || []) !== identidade);
  salvar(); renderizarCarrinho(); emitirAtualizacao('remover', item);
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
    if (!cepComFormatoValido(cep)) throw new Error('CEP inválido. Informe os 8 números para calcular a entrega.');
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
    limparErroCampo('cep');
    const mensagemFrete = dados.tipo === 'bairro'
      ? `Taxa fixa para ${dados.bairro || 'este bairro'}: ${dinheiro(valorFreteAtual)}`
      : `Trajeto aproximado pelo CEP: ${Number(dados.distancia_km).toFixed(2).replace('.', ',')} km. ${valorFreteAtual === 0 ? 'Entrega grátis até 2 km.' : `Entrega: ${dinheiro(valorFreteAtual)}`}`;
    informarFrete(mensagemFrete);
    atualizarResumo(); return true;
  } catch (erro) {
    if (versao === calculoAtual) informarFrete(erro.message, true);
    return false;
  } })();
  cotacaoEmAndamento = { chave, promise: promessa };
  try { return await promessa; } finally { if (cotacaoEmAndamento?.promise === promessa) cotacaoEmAndamento = null; }
}
export async function finalizarCompra() {
  if (finalizando) return;
  limparErrosCheckout();
  if (!carrinho.length) return Swal.fire({ icon: 'info', title: 'Carrinho vazio', text: 'Escolha os produtos antes de continuar.' });
  const cliente_nome = document.getElementById('cliente-nome')?.value.trim() || '';
  const cliente_telefone = document.getElementById('cliente-telefone')?.value.trim() || '';
  const provedor_pagamento = document.querySelector('input[name="provedor-pagamento"]:checked')?.value || 'infinitepay';
  const pagamento = provedor_pagamento === 'entrega' ? 'entrega' : 'site';
  const tipo_pagamento_entrega = pagamento === 'entrega' ? document.querySelector('input[name="tipo-pagamento-entrega"]:checked')?.value : undefined;
  if (pagamento === 'entrega' && !tipo_pagamento_entrega) {
    const erro = document.getElementById('erro-tipo-pagamento-entrega');
    if (erro) { erro.textContent = 'Escolha se o pagamento na entrega será em dinheiro ou cartão.'; erro.hidden = false; }
    document.getElementById('tipo-pagamento-entrega')?.focus({ preventScroll: false });
    return;
  }
  const textoTroco = tipo_pagamento_entrega === 'dinheiro' ? document.getElementById('troco-pagamento')?.value : '';
  const troco_para = textoTroco?.trim() ? parseMoedaBrasileira(textoTroco) : null;
  if (tipo_pagamento_entrega === 'dinheiro' && troco_para !== null && (!Number.isFinite(troco_para) || troco_para <= 0)) {
    const erro = document.getElementById('erro-troco-pagamento');
    if (erro) { erro.textContent = 'Informe um valor de troco válido.'; erro.hidden = false; }
    document.getElementById('troco-pagamento')?.focus();
    return;
  }
  if (cliente_nome.length < 2) { marcarErroCampo('cliente-nome', 'Informe seu nome completo.', true); return; }
  if (!/^(?:55)?\d{10,11}$/.test(cliente_telefone.replace(/[\s()+-]/g, ''))) { marcarErroCampo('cliente-telefone', 'Informe um telefone válido com DDD.', true); return; }
  const enderecoInicial = camposEntrega();
  if (!enderecoInicial.numero_casa) { marcarErroCampo('numero-casa', 'Informe o número da casa.', true); return; }
  if (!enderecoInicial.cep) { marcarErroCampo('cep', 'Informe o CEP para calcular a entrega.', true); return; }
  const botao = document.querySelector('.btn-finalizar'); const textoBotao = botao?.textContent || ''; finalizando = true; if (botao) { botao.disabled = true; botao.setAttribute('aria-busy', 'true'); botao.textContent = 'Processando pedido…'; }
  try {
    if (!(await atualizarEntrega())) return;
    const entrega = camposEntrega();
    if (!entrega.endereco) { marcarErroCampo('endereco', 'Confira a rua ou avenida.', true); return; }
    if (!entrega.bairro) { marcarErroCampo('bairro', 'Confira o bairro.', true); return; }
    if (Object.values(entrega).some(valor => !valor)) { informarFrete('Confira os dados do endereço para calcular a entrega.', true); return; }
    // Visitantes compram sem conta: o próprio POST do pedido cria uma sessão técnica HttpOnly.
    const corpo = { ...entrega, taxa_entrega: valorFreteAtual, subtotal_esperado: subtotal(), cliente_nome, cliente_telefone, provedor_pagamento, tipo_pagamento_entrega: tipo_pagamento_entrega || null, troco_para: tipo_pagamento_entrega === 'dinheiro' ? troco_para : null, observacao_geral: document.getElementById('observacao-geral')?.value.trim() || '', pagamento, itens: carrinho.map(item => ({ produto_id: item.id, quantidade: item.quantidade, adicionais_ids: (item.adicionais || []).map(adicional => adicional.id), observacao_item: item.observacao || '' })) };
    const resumo = new TextEncoder().encode(JSON.stringify(corpo));
    const assinatura = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', resumo)), b => b.toString(16).padStart(2, '0')).join('');
    let tentativa;
    try { tentativa = JSON.parse(sessionStorage.getItem('checkoutAtual')); } catch {}
    if (tentativa?.assinatura !== assinatura) tentativa = { assinatura, chave: crypto.randomUUID() };
    sessionStorage.setItem('checkoutAtual', JSON.stringify(tentativa));
    const dados = await enviar('/api/pedidos', 'POST', { ...corpo, checkout_chave: tentativa.chave });
    if (dados.pedido?.taxa_entrega != null) { valorFreteAtual = Number(dados.pedido.taxa_entrega); atualizarResumo(); }
    limparCarrinho(); sessionStorage.removeItem('checkoutAtual');
    if (dados.tipo_pagamento === 'entrega' || dados.pedido?.pagamento === 'entrega') {
      await Swal.fire({ icon: 'success', title: 'Pedido realizado!', text: 'O pagamento será feito na entrega.' });
      window.location.assign('../tela cliente/meu perfil cliente.html');
    } else if (dados.pagamento?.provider === 'mercadopago_pix') {
      sessionStorage.setItem('pagamentoPix', JSON.stringify({ pedido_id: dados.pedido.id, valor: dados.pedido.valor, pagamento: dados.pagamento }));
      window.location.assign(`../tela cliente/pagamento pix.html?pedido=${encodeURIComponent(dados.pedido.id)}`);
    } else {
      if (!dados.payment_url || !dados.payment_url.startsWith('https://')) throw new Error('Não foi possível abrir o pagamento. Tente novamente.');
      window.location.assign(dados.payment_url);
    }
  } catch (erro) { await Swal.fire({ icon: 'error', title: 'Não foi possível finalizar', text: erro.message }); }
  finally { finalizando = false; if (botao) { botao.disabled = false; botao.removeAttribute('aria-busy'); botao.textContent = textoBotao; } }
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
    informarFrete(erro.message, true);
    marcarErroCampo('cep', erro.message, false);
    return false;
  } finally { consultaCepEmAndamento = null; }
  })();
  return consultaCepEmAndamento;
}
async function atualizarEntrega() {
  const cep = document.getElementById('cep')?.value.trim() || '';
  if (!cepComFormatoValido(cep)) {
    informarFrete(cep ? 'CEP inválido. Informe os 8 números para calcular a entrega.' : 'Informe o CEP para calcular a entrega.', true);
    marcarErroCampo('cep', cep ? 'Informe um CEP válido com 8 números.' : 'Informe o CEP.', false);
    return false;
  }
  if (!(await preencherEnderecoPeloCep())) return false;
  return calcularFrete();
}
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
  const atualizarTextoPagamento = () => {
    const provedor = document.querySelector('input[name="provedor-pagamento"]:checked')?.value;
    const botaoPagamento = document.getElementById('btn-finalizar-pedido');
    if (botaoPagamento) botaoPagamento.textContent = provedor === 'entrega' ? 'Realizar pedido' : provedor === 'infinitepay' ? 'Continuar para InfinitePay' : 'Pagamento via pix';
    atualizarTipoPagamentoEntrega();
  };
  document.querySelectorAll('input[name="provedor-pagamento"]').forEach(opcao => opcao.addEventListener('change', atualizarTextoPagamento));
  document.querySelectorAll('input[name="tipo-pagamento-entrega"]').forEach(opcao => opcao.addEventListener('change', atualizarTipoPagamentoEntrega));
  atualizarTextoPagamento();
  document.getElementById('cep')?.addEventListener('blur', () => { if (document.getElementById('cep').value.replace(/\D/g, '').length === 8) atualizarEntrega(); });
  document.getElementById('cep')?.addEventListener('input', () => { ++calculoAtual; cotacaoAnterior = null; cotacaoEmAndamento = null; consultaCepAnterior = ''; valorFreteAtual = 0; limparErroCampo('cep'); atualizarResumo(); informarFrete('Calcule a entrega para o novo CEP.'); });
});
