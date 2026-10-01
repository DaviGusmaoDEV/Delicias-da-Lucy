import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';

const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const moeda = valor => { const numero = Number(String(valor).replace(/\./g, '').replace(',', '.')); return Number.isFinite(numero) ? numero : NaN; };
const aviso = mensagem => { const area = document.getElementById('mensagem-regras'); if (area) { area.textContent = mensagem; area.hidden = false; } };
let podeEditar = false;
let produtos = [];

function montarLinhaAdicional(adicional) {
  const linha = document.createElement('article'); linha.className = 'regra-card';
  linha.innerHTML = `<div><strong></strong><span class="regra-status"></span></div><span class="regra-preco"></span><div class="regra-acoes"><button type="button" class="btn btn-secondary btn-editar-regra">Editar</button><button type="button" class="btn btn-danger btn-toggle-regra"></button></div>`;
  linha.querySelector('strong').textContent = adicional.nome;
  linha.querySelector('.regra-preco').textContent = dinheiro(adicional.preco);
  linha.querySelector('.regra-status').textContent = adicional.ativo ? 'Ativo' : 'Inativo';
  linha.querySelector('.regra-status').dataset.estado = adicional.ativo ? 'ativo' : 'inativo';
  linha.querySelector('.btn-editar-regra').disabled = !podeEditar;
  linha.querySelector('.btn-toggle-regra').textContent = adicional.ativo ? 'Desativar' : 'Ativar';
  linha.querySelector('.btn-toggle-regra').disabled = !podeEditar;
  linha.querySelector('.btn-editar-regra').onclick = async () => {
    const nome = window.prompt('Nome do adicional:', adicional.nome); if (nome === null) return;
    const precoTexto = window.prompt('Preço (ex.: 5,00):', String(adicional.preco).replace('.', ',')); if (precoTexto === null) return;
    try { await enviar(`/api/admin/adicionais/${encodeURIComponent(adicional.id)}`, 'PATCH', { nome, preco: moeda(precoTexto) }); aviso('Adicional atualizado.'); carregarAdicionais(); } catch (erro) { aviso(erro.message); }
  };
  linha.querySelector('.btn-toggle-regra').onclick = async () => {
    if (!window.confirm(`${adicional.ativo ? 'Desativar' : 'Ativar'} este adicional?`)) return;
    try { await enviar(`/api/admin/adicionais/${encodeURIComponent(adicional.id)}`, 'PATCH', { ativo: !adicional.ativo }); aviso(`Adicional ${adicional.ativo ? 'desativado' : 'ativado'}.`); carregarAdicionais(); } catch (erro) { aviso(erro.message); }
  };
  return linha;
}
async function carregarAdicionais() {
  const lista = document.getElementById('lista-adicionais-admin'); if (!lista) return;
  try { const adicionais = await api('/api/admin/adicionais'); lista.replaceChildren(...adicionais.map(montarLinhaAdicional)); } catch (erro) { aviso(erro.message); }
}
function montarLinhaTaxa(taxa) {
  const linha = document.createElement('article'); linha.className = 'regra-card';
  linha.innerHTML = `<div><strong></strong><small></small><span class="regra-status"></span></div><span class="regra-preco"></span><div class="regra-acoes"><button type="button" class="btn btn-secondary btn-editar-regra">Editar</button><button type="button" class="btn btn-danger btn-toggle-regra"></button></div>`;
  linha.querySelector('strong').textContent = taxa.nome;
  linha.querySelector('small').textContent = `${taxa.cidade}/${taxa.uf}`;
  linha.querySelector('.regra-preco').textContent = dinheiro(taxa.taxa);
  linha.querySelector('.regra-status').textContent = taxa.ativo ? 'Ativo' : 'Inativo';
  linha.querySelector('.regra-status').dataset.estado = taxa.ativo ? 'ativo' : 'inativo';
  linha.querySelector('.btn-editar-regra').disabled = !podeEditar;
  linha.querySelector('.btn-toggle-regra').textContent = taxa.ativo ? 'Desativar' : 'Ativar'; linha.querySelector('.btn-toggle-regra').disabled = !podeEditar;
  linha.querySelector('.btn-editar-regra').onclick = async () => {
    const nome = window.prompt('Bairro:', taxa.nome); if (nome === null) return;
    const precoTexto = window.prompt('Taxa (ex.: 7,00):', String(taxa.taxa).replace('.', ',')); if (precoTexto === null) return;
    try { await enviar(`/api/admin/taxas-entrega/${encodeURIComponent(taxa.id)}`, 'PATCH', { nome, taxa: moeda(precoTexto) }); aviso('Taxa de entrega atualizada.'); carregarTaxas(); } catch (erro) { aviso(erro.message); }
  };
  linha.querySelector('.btn-toggle-regra').onclick = async () => {
    if (!window.confirm(`${taxa.ativo ? 'Desativar' : 'Ativar'} esta taxa?`)) return;
    try { await enviar(`/api/admin/taxas-entrega/${encodeURIComponent(taxa.id)}`, 'PATCH', { ativo: !taxa.ativo }); aviso(`Taxa ${taxa.ativo ? 'desativada' : 'ativada'}.`); carregarTaxas(); } catch (erro) { aviso(erro.message); }
  };
  return linha;
}
async function carregarTaxas() {
  const lista = document.getElementById('lista-taxas-admin'); if (!lista) return;
  try { const taxas = await api('/api/admin/taxas-entrega'); lista.replaceChildren(...taxas.map(montarLinhaTaxa)); } catch (erro) { aviso(erro.message); }
}
async function carregarAssociacoes() {
  const produtoId = document.getElementById('regra-produto')?.value; const lista = document.getElementById('lista-associacoes-admin'); if (!produtoId || !lista) return;
  try {
    const adicionais = await api(`/api/admin/produtos/${encodeURIComponent(produtoId)}/adicionais`);
    lista.replaceChildren(...adicionais.map(adicional => {
      const label = document.createElement('label'); label.className = 'opcao-adicional-admin';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = adicional.id; input.checked = adicional.associado; input.disabled = !podeEditar;
      const texto = document.createElement('span'); texto.textContent = `${adicional.nome} + ${dinheiro(adicional.preco)}${adicional.ativo ? '' : ' (inativo)'}`;
      label.append(input, texto); return label;
    }));
  } catch (erro) { aviso(erro.message); }
}
async function carregarProdutosAdmin() {
  produtos = await api('/api/admin/produtos');
  const select = document.getElementById('regra-produto'); if (!select) return;
  select.replaceChildren(...produtos.map(produto => { const option = document.createElement('option'); option.value = produto.id; option.textContent = produto.nome; return option; }));
  await carregarAssociacoes();
}
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('painel-regras-comerciais')) return;
  const perfil = await sessaoPronta; if (!perfil) return;
  podeEditar = perfil.role === 'admin1';
  document.querySelectorAll('[data-admin1-only]').forEach(elemento => { elemento.hidden = !podeEditar; });
  try { await carregarProdutosAdmin(); await carregarAdicionais(); await carregarTaxas(); } catch (erro) { aviso(erro.message); }
  document.getElementById('regra-produto')?.addEventListener('change', carregarAssociacoes);
  document.getElementById('salvar-associacoes')?.addEventListener('click', async () => {
    if (!podeEditar) return;
    const produtoId = document.getElementById('regra-produto').value;
    const adicional_ids = [...document.querySelectorAll('#lista-associacoes-admin input:checked')].map(input => input.value);
    try { await enviar(`/api/admin/produtos/${encodeURIComponent(produtoId)}/adicionais`, 'PUT', { adicional_ids }); aviso('Adicionais do produto atualizados.'); await carregarAssociacoes(); } catch (erro) { aviso(erro.message); }
  });
  document.getElementById('form-novo-adicional')?.addEventListener('submit', async evento => {
    evento.preventDefault(); if (!podeEditar) return;
    const form = evento.currentTarget; try { await enviar('/api/admin/adicionais', 'POST', { nome: form.nome.value, preco: moeda(form.preco.value), ativo: form.ativo.checked }); form.reset(); form.ativo.checked = true; aviso('Adicional criado.'); await carregarAdicionais(); } catch (erro) { aviso(erro.message); }
  });
  document.getElementById('form-nova-taxa')?.addEventListener('submit', async evento => {
    evento.preventDefault(); if (!podeEditar) return;
    const form = evento.currentTarget; try { await enviar('/api/admin/taxas-entrega', 'POST', { nome: form.nome.value, cidade: form.cidade.value, uf: form.uf.value, taxa: moeda(form.taxa.value), ativo: true }); form.reset(); aviso('Taxa de entrega criada.'); await carregarTaxas(); } catch (erro) { aviso(erro.message); }
  });
});
