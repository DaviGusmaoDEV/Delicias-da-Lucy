import { api } from './api.js';
import { sessaoPronta } from './sessao.js';
import { pedidoNoHistorico, statusPedido, textoPagamento } from './status-pedidos.mjs';
import { rotuloPedido } from './numero-pedido.js';
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
async function confirmarRecebimento(id) { try { await api(`/api/pedidos/${id}/confirmar-recebimento`, { method: 'POST' }); await carregarPedidos(); } catch (erro) { alert(erro.message); } }
function dataPedido(valor) {
  const data = valor ? new Date(valor) : null;
  return data && !Number.isNaN(data.getTime()) ? data.toLocaleDateString('pt-BR') : 'Data indisponível';
}
function linhaPedido(pedido) {
  const [titulo, descricao] = statusPedido(pedido.status);
  const linha = document.createElement('tr'); linha.className = `linha-pedido status-${pedido.status || 'desconhecido'}`;
  const id = document.createElement('td'); id.textContent = rotuloPedido(pedido);
  const data = document.createElement('td'); data.textContent = dataPedido(pedido.data_criacao);
  const situacao = document.createElement('td');
  const selo = document.createElement('span'); selo.className = `status-pedido status-${pedido.status || 'desconhecido'}`; selo.textContent = titulo; situacao.append(selo);
  const detalhe = document.createElement('small'); detalhe.className = 'status-detalhe'; detalhe.textContent = descricao; situacao.append(detalhe);
  if (pedido.pagamento === 'site') {
    const pagamento = document.createElement('small'); pagamento.textContent = textoPagamento(pedido.pagamento_status); situacao.append(pagamento);
    const pagamentoFinalizado = ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(pedido.pagamento_status);
    if (!pedido.pago_em && pedido.status !== 'cancelado' && !pagamentoFinalizado) {
      const pagar = document.createElement('button'); pagar.className = 'btn btn-primary'; pagar.textContent = 'Continuar pagamento';
      pagar.onclick = async () => {
        pagar.disabled = true;
        try {
          const dados = await api(`/api/pedidos/${encodeURIComponent(pedido.id)}/pagar`, { method: 'POST' });
          if (dados.pagamento?.provider === 'mercadopago_pix') {
            sessionStorage.setItem('pagamentoPix', JSON.stringify({ pedido_id: dados.pedido.id, valor: dados.pedido.valor, pagamento: dados.pagamento }));
            window.location.assign(`../tela cliente/pagamento pix.html?pedido=${encodeURIComponent(dados.pedido.id)}`);
            return;
          }
          if (!dados.payment_url?.startsWith('https://')) throw new Error('Não foi possível abrir o pagamento. Tente novamente.');
          window.location.assign(dados.payment_url);
        }
        catch (erro) { mostrarErro(erro); pagar.disabled = false; }
      };
      situacao.append(pagar);
    }
  } else if (pedido.pagamento === 'entrega') {
    const pagamento = document.createElement('small'); pagamento.textContent = 'Pagamento na entrega — será cobrado quando receber o pedido.'; situacao.append(pagamento);
  }
  if (pedido.status === 'pronto_entrega') { const botao = document.createElement('button'); botao.className = 'btn btn-recebido'; botao.textContent = 'Confirmar que recebi'; botao.onclick = () => confirmarRecebimento(pedido.id); situacao.append(botao); }
  const total = document.createElement('td'); total.textContent = dinheiro(pedido.valor); linha.append(id, data, situacao, total); return linha;
}
function preencherTabela(elemento, pedidos, vazio) {
  elemento.replaceChildren();
  if (!pedidos.length) { const linha = document.createElement('tr'); const celula = document.createElement('td'); celula.colSpan = 4; celula.textContent = vazio; linha.append(celula); elemento.append(linha); return; }
  pedidos.forEach(pedido => elemento.append(linhaPedido(pedido)));
}
async function carregarPedidos() {
  const atuais = document.getElementById('pedidos-em-andamento'); const historico = document.getElementById('meus-pedidos'); if (!atuais || !historico) return;
  const pedidos = await api('/api/meus-pedidos');
  preencherTabela(atuais, pedidos.filter(pedido => !pedidoNoHistorico(pedido)), 'Nenhum pedido em andamento.');
  preencherTabela(historico, pedidos.filter(pedido => pedidoNoHistorico(pedido)), 'Nenhum pedido realizado ainda.');
}
function mostrarErro(erro) {
  let aviso = document.getElementById('erro-perfil');
  if (!aviso) { aviso = document.createElement('p'); aviso.id = 'erro-perfil'; aviso.setAttribute('role', 'alert'); document.querySelector('main')?.prepend(aviso); }
  aviso.textContent = erro.message;
}
document.addEventListener('DOMContentLoaded', async () => {
  const perfil = await sessaoPronta; if (!perfil) return;
  const campos = { 'boas-vindas-usuario': `Olá, ${perfil.nome || 'visitante'}.`, 'user-nome': perfil.nome || 'Visitante', 'user-email': perfil.email || 'Compra sem conta', 'user-fone': perfil.telefone || 'Não informado' };
  for (const [id, valor] of Object.entries(campos)) { const el = document.getElementById(id); if (el) el.textContent = valor; }
  if (perfil.visitanteNovo) { const corpo = document.getElementById('pedidos-em-andamento'); const historico = document.getElementById('meus-pedidos'); if (corpo) corpo.innerHTML = '<tr><td colspan="4">Finalize uma compra para acompanhar seus pedidos neste navegador.</td></tr>'; if (historico) historico.innerHTML = '<tr><td colspan="4">Nenhum pedido realizado ainda.</td></tr>'; return; }
  if (document.getElementById('meus-pedidos') && document.getElementById('pedidos-em-andamento')) {
    const atualizar = () => carregarPedidos().catch(mostrarErro);
    await atualizar(); window.setInterval(atualizar, 30000);
  }
});
