import { filtrarTransacoes } from './caixa-filtros.js';
import Swal from '/vendor/sweetalert2.esm.js';
import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
const el = id => document.getElementById(id);
const dinheiro = valor => Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let transacoes = [];
let idEmEdicao = null;
let filtros = { inicio: '', fim: '', busca: '', tipo: 'todos' };
const erro = causa => Swal.fire({ icon: 'error', title: 'Fluxo de caixa', text: causa.message });

async function carregar() {
  transacoes = (await api('/api/fluxo-caixa')).map(item => ({ ...item, valor: Number(item.valor) }));
  renderizar();
}
function renderizar() {
  const visiveis = filtrarTransacoes(transacoes, filtros);
  const corpo = el('corpo-tabela-fluxo-caixa'); corpo.replaceChildren();
  if (!visiveis.length) corpo.innerHTML = '<tr><td colspan="5">Nenhuma transação encontrada.</td></tr>';
  const totais = { receita: 0, despesa: 0, 'total-despesa-funcionario': 0 };
  const nomes = { receita: 'Entrada', despesa: 'Saída', 'total-despesa-funcionario': 'Despesa Funcionário' };
  visiveis.forEach(item => {
    const clone = el('template-linha-transacao').content.cloneNode(true);
    clone.querySelector('.col-data').textContent = new Date(`${item.data.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
    clone.querySelector('.txt-descricao').textContent = item.descricao;
    clone.querySelector('.badge-origem').textContent = item.pedido_id ? 'Mercado Pago · automático' : 'Lançamento manual';
    const badge = clone.querySelector('.badge-tipo'); badge.textContent = nomes[item.tipo] || item.tipo;
    const valor = clone.querySelector('.col-valor'); valor.textContent = dinheiro(item.valor);
    const classe = item.tipo === 'total-despesa-funcionario' ? 'status-despesa-funcionario' : `status-${item.tipo}`;
    badge.classList.add(classe); valor.classList.add(classe);
    clone.querySelector('.btn-edicao').onclick = () => {
      idEmEdicao = item.id;
      for (const campo of ['descricao', 'tipo', 'valor', 'data']) el(`${campo}-edicao`).value = campo === 'data' ? item.data.slice(0, 10) : item[campo];
      el('modalEditar').showModal();
    };
    clone.querySelector('.btn-exclusao').onclick = async () => {
      const decisao = await Swal.fire({ title: 'Excluir transação?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Excluir', cancelButtonText: 'Cancelar' });
      if (!decisao.isConfirmed) return;
      try { await api(`/api/fluxo-caixa/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); transacoes = transacoes.filter(t => t.id !== item.id); renderizar(); }
      catch (causa) { erro(causa); }
    };
    if (item.pedido_id) { clone.querySelector('.btn-edicao').remove(); clone.querySelector('.btn-exclusao').remove(); }
    corpo.append(clone); if (item.tipo in totais) totais[item.tipo] += Math.round(item.valor * 100);
  });
  el('total-faturamento').textContent = dinheiro(totais.receita / 100);
  el('total-despesa').textContent = dinheiro(totais.despesa / 100);
  el('total-despesa-funcionario').textContent = dinheiro(totais['total-despesa-funcionario'] / 100);
  el('saldo-liquido').textContent = dinheiro((totais.receita - totais.despesa - totais['total-despesa-funcionario']) / 100);
}
async function salvar(event, edicao) {
  event.preventDefault(); const botao = event.target.querySelector('[type="submit"]');
  if (botao.disabled) return;
  botao.disabled = true;
  const sufixo = edicao ? '-edicao' : '';
  const dados = Object.fromEntries(['descricao', 'tipo', 'valor', 'data'].map(campo => [campo, campo === 'valor' ? Number(el(campo + sufixo).value) : el(campo + sufixo).value.trim()]));
  try {
    const registro = await enviar(`/api/fluxo-caixa${edicao ? `/${encodeURIComponent(idEmEdicao)}` : ''}`, edicao ? 'PUT' : 'POST', dados);
    const normalizado = { ...registro, valor: Number(registro.valor) };
    transacoes = edicao ? transacoes.map(t => t.id === idEmEdicao ? normalizado : t) : [...transacoes, normalizado];
    transacoes.sort((a, b) => b.data.localeCompare(a.data)); renderizar();
    el(edicao ? 'modalEditar' : 'modalTransacao').close(); event.target.reset();
  } catch (causa) { erro(causa); }
  finally { botao.disabled = false; }
}
document.addEventListener('DOMContentLoaded', async () => {
  const perfil = await sessaoPronta; if (perfil?.role !== 'admin1') return;
  for (const [botao, modal] of [['btnAbrirModalTransacao', 'modalTransacao'], ['btnAbrirModalFiltro', 'modalFiltro']]) el(botao).onclick = () => el(modal).showModal();
  for (const [botao, modal] of [['btnFecharModalTransacao-add', 'modalTransacao'], ['btnFecharModalFiltro', 'modalFiltro'], ['btn-edicao-fechar', 'modalEditar']]) el(botao).onclick = () => el(modal).close();
  el('form-transacao').onsubmit = event => salvar(event, false);
  el('form-editar-transacao').onsubmit = event => salvar(event, true);
  el('btnAplicarFiltro').onclick = () => {
    const inicio = el('data-inicial').value; const fim = el('data-final').value;
    if (inicio && fim && inicio > fim) return erro(new Error('A data inicial deve ser anterior à data final.'));
    filtros = { inicio, fim, tipo: el('tipo-filtro').value, busca: el('funcionario-filtro').value.trim().toLowerCase() }; renderizar(); el('modalFiltro').close();
  };
  el('btnLimparFiltro').onclick = () => {
    ['data-inicial', 'data-final', 'funcionario-filtro'].forEach(id => { el(id).value = ''; });
    el('tipo-filtro').value = 'todos';
    filtros = { inicio: '', fim: '', busca: '', tipo: 'todos' }; renderizar(); el('modalFiltro').close();
  };
  try { await carregar(); } catch (causa) { erro(causa); }
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) carregar().catch(erro); }, 15000);
});
