import { api } from './api.js';
import { sessaoPronta } from './sessao.js';
const el = id => document.getElementById(id);
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const textoStatus = { pendente: 'Aguardando preparo', aceito: 'Aceito', em_preparo: 'Em preparo', pronto_entrega: 'Em entrega', recebido: 'Concluído', cancelado: 'Cancelado' };
function hoje() {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const parte = tipo => partes.find(item => item.type === tipo).value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}
function periodo(data, tipo) {
  if (tipo === 'mes') return { inicio: `${data.slice(0, 8)}01`, fim: data, texto: 'do mês atual' };
  if (tipo === 'semana') {
    const inicio = new Date(`${data}T12:00:00-03:00`); inicio.setDate(inicio.getDate() - 6);
    return { inicio: inicio.toISOString().slice(0, 10), fim: data, texto: 'dos últimos 7 dias' };
  }
  return { inicio: data, fim: data, texto: 'de hoje' };
}
function periodoSelecionado(data, tipo) {
  if (tipo !== 'personalizado') return periodo(data, tipo);
  const selecionada = el('dashboard-data')?.value || data;
  return { inicio: selecionada, fim: selecionada, texto: `de ${selecionada}` };
}
async function carregar() {
  const data = hoje();
  const tipo = el('dashboard-periodo')?.value || 'dia';
  const faixa = periodoSelecionado(data, tipo);
  const [resultadoPedidos, caixa] = await Promise.all([api(`/api/pedidos?${new URLSearchParams({ data, pagina: '0' })}`), api('/api/fluxo-caixa')]);
  const pedidos = resultadoPedidos.pedidos || [];
  const movimentos = caixa.filter(item => item.data >= faixa.inicio && item.data <= faixa.fim);
  const entradas = movimentos.filter(item => item.tipo === 'receita').reduce((total, item) => total + Number(item.valor), 0);
  const saidas = movimentos.filter(item => item.tipo !== 'receita').reduce((total, item) => total + Number(item.valor), 0);
  el('dashboard-pedidos').textContent = pedidos.length;
  el('dashboard-pagos').textContent = pedidos.filter(item => item.pagamento_status === 'approved').length;
  el('dashboard-entradas').textContent = dinheiro(entradas);
  el('dashboard-saldo').textContent = dinheiro(entradas - saidas);
  renderizarPedidos(pedidos);
  renderizarCaixa(movimentos);
  renderizarQuadro(movimentos);
  if (el('dashboard-rotulo-entradas')) el('dashboard-rotulo-entradas').textContent = `Entradas ${faixa.texto}`;
  if (el('dashboard-rotulo-saldo')) el('dashboard-rotulo-saldo').textContent = `Saldo ${faixa.texto}`;
  if (el('dashboard-titulo-caixa')) el('dashboard-titulo-caixa').textContent = `Movimentações ${faixa.texto}`;
  el('dashboard-atualizacao').textContent = `Período: ${faixa.inicio} até ${faixa.fim}. Atualizado agora.`;
}
function renderizarQuadro(movimentos) {
  const corpo = el('dashboard-movimentos');
  if (!corpo) return;
  corpo.replaceChildren();
  const total = el('dashboard-total-movimentos');
  if (total) total.textContent = `${movimentos.length} lançamento${movimentos.length === 1 ? '' : 's'}`;
  if (!movimentos.length) { const linha = document.createElement('tr'); const celula = document.createElement('td'); celula.colSpan = 5; celula.textContent = 'Nenhuma movimentação registrada nesse período.'; linha.append(celula); corpo.append(linha); return; }
  const nomes = { receita: 'Entrada', despesa: 'Saída', 'total-despesa-funcionario': 'Despesa de funcionário' };
  movimentos.slice().sort((a, b) => `${b.data}${b.criado_em || ''}`.localeCompare(`${a.data}${a.criado_em || ''}`)).forEach(movimento => {
    const linha = document.createElement('tr');
    linha.className = movimento.tipo === 'receita' ? 'movimento-entrada' : movimento.tipo === 'total-despesa-funcionario' ? 'movimento-funcionario' : 'movimento-saida';
    for (const valor of [movimento.data, movimento.descricao, nomes[movimento.tipo] || movimento.tipo, movimento.pedido_id ? `#${movimento.pedido_id}` : 'Manual', dinheiro(movimento.valor)]) { const celula = document.createElement('td'); celula.textContent = valor; linha.append(celula); }
    corpo.append(linha);
  });
}
function vazio(lista, mensagem) { const item = document.createElement('li'); item.textContent = mensagem; lista.replaceChildren(item); }
function renderizarPedidos(pedidos) {
  const lista = el('dashboard-lista-pedidos');
  if (!pedidos.length) return vazio(lista, 'Nenhum pedido no período.');
  const itens = pedidos.slice(0, 5).map(pedido => {
    const item = document.createElement('li');
    const titulo = document.createElement('strong'); titulo.textContent = `#${pedido.id} — ${pedido.cliente_nome || pedido.profiles?.nome || 'Cliente'}`;
    const detalhe = document.createElement('span'); detalhe.textContent = `${textoStatus[pedido.status] || pedido.status} · ${pedido.pagamento_status === 'approved' ? 'Pago' : 'Aguardando pagamento'} · ${dinheiro(pedido.valor)}`;
    item.append(titulo, detalhe); return item;
  });
  lista.replaceChildren(...itens);
}
function renderizarCaixa(movimentos) {
  const lista = el('dashboard-lista-caixa');
  if (!movimentos.length) return vazio(lista, 'Nenhuma movimentação hoje.');
  const itens = movimentos.slice(0, 5).map(movimento => {
    const item = document.createElement('li');
    const titulo = document.createElement('strong'); titulo.textContent = movimento.descricao;
    const detalhe = document.createElement('span'); detalhe.textContent = `${movimento.tipo === 'receita' ? 'Entrada' : 'Saída'} · ${dinheiro(movimento.valor)}`;
    item.append(titulo, detalhe); return item;
  });
  lista.replaceChildren(...itens);
}
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await sessaoPronta)) return;
  const seletorPeriodo = el('dashboard-periodo');
  const campoData = el('dashboard-data');
  if (campoData) campoData.value = hoje();
  seletorPeriodo?.addEventListener('change', () => { if (campoData) campoData.hidden = seletorPeriodo.value !== 'personalizado'; carregar().catch(erro => { el('dashboard-atualizacao').textContent = erro.message; }); });
  campoData?.addEventListener('change', () => carregar().catch(erro => { el('dashboard-atualizacao').textContent = erro.message; }));
  try { await carregar(); window.setInterval(() => { if (!document.hidden) carregar().catch(erro => { el('dashboard-atualizacao').textContent = erro.message; }); }, 30000); } catch (erro) { el('dashboard-atualizacao').textContent = erro.message; }
});
