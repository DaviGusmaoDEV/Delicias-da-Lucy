import { bilhetePedido } from './bilhete.js';
import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
let pagina = 0;
let carregando = false;
let alterando = false;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const STATUS = {
  pendente: { texto: 'Aguardando confirmação', detalhe: 'O restaurante está visualizando este pedido.', proximo: 'aceito', acao: 'Aceitar pedido' },
  aceito: { texto: 'Pedido aceito', detalhe: 'Confirme quando a cozinha iniciar o preparo.', proximo: 'em_preparo', acao: 'Iniciar preparo' },
  em_preparo: { texto: 'Em preparo', detalhe: 'Avise quando sair para entrega.', proximo: 'pronto_entrega', acao: 'Pronto / em entrega' },
  pronto_entrega: { texto: 'Pronto / em entrega', detalhe: 'Aguardando o cliente confirmar o recebimento.' },
  recebido: { texto: 'Recebido pelo cliente', detalhe: 'Pedido concluído.' },
  cancelado: { texto: 'Cancelado', detalhe: 'Pedido cancelado.' }
};
const esc = valor => String(valor ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
function mostrarErro(erro) {
  let aviso = document.getElementById('erro-pedidos');
  if (!aviso) { aviso = document.createElement('p'); aviso.id = 'erro-pedidos'; aviso.setAttribute('role', 'alert'); document.getElementById('lista-pedidos')?.before(aviso); }
  aviso.textContent = erro.message;
}
async function atualizarStatus(id, status) {
  if (alterando) return;
  if (status === 'cancelado' && !window.confirm('Cancelar este pedido? Se já estiver pago, o reembolso precisa ser feito no Mercado Pago.')) return;
  alterando = true;
  document.querySelectorAll('.pedido-acoes button').forEach(botao => { botao.disabled = true; });
  try { await enviar(`/api/pedidos/${encodeURIComponent(id)}/status`, 'PATCH', { status }); await carregar(); }
  catch (erro) { mostrarErro(erro); }
  finally { alterando = false; document.querySelectorAll('.pedido-acoes button').forEach(botao => { botao.disabled = false; }); }
}
async function carregar() {
  if (carregando) return;
  carregando = true;
  const parametros = new URLSearchParams({ data: document.getElementById('data-pedidos').value, status: document.getElementById('status-pedidos').value, pagina: String(pagina) });
  try {
  const { pedidos, temMais } = await api(`/api/pedidos?${parametros}`);
  const aviso = document.getElementById('erro-pedidos'); if (aviso) aviso.textContent = '';
  const area = document.getElementById('lista-pedidos'); area.innerHTML = pedidos.length ? '' : '<p>Nenhum pedido encontrado entre 18h e meia-noite para os filtros selecionados.</p>';
  pedidos.forEach(pedido => {
    const situacao = STATUS[pedido.status] || STATUS.pendente; const itens = (pedido.itens_pedido || []).map(item => `${item.quantidade}x ${item.products?.nome || 'Item'}`).join(', '); const card = document.createElement('article');
    card.className = `pedido-card status-${pedido.status}`;
    card.innerHTML = `<div class="pedido-cabecalho"><h2>Pedido N${esc(pedido.id)}</h2><span class="status-pedido status-${esc(pedido.status)}">${situacao.texto}</span></div><p class="status-detalhe">${situacao.detalhe}</p><p><strong>Cliente:</strong> ${esc(pedido.cliente_nome || pedido.profiles?.nome || 'Cliente')}</p><p><strong>Telefone:</strong> ${esc(pedido.cliente_telefone || pedido.profiles?.telefone || 'Não informado')}</p><p><strong>Horário:</strong> ${esc(new Date(pedido.data_criacao).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</p><p><strong>Entrega:</strong> ${esc(pedido.endereco)}, nº ${esc(pedido.numero_casa)} — ${esc(pedido.bairro)}, CEP ${esc(pedido.cep)}</p><p><strong>Itens:</strong> ${esc(itens)}</p><p><strong>Total:</strong> ${dinheiro(pedido.valor)}</p><div class="pedido-acoes"></div>`;
    if (pedido.observacao_geral) { const obs = document.createElement('p'); obs.textContent = `Observação: ${pedido.observacao_geral}`; card.append(obs); }
    const provedor = String(pedido.pagamento_id || '').startsWith('infinitepay:') ? 'InfinitePay' : 'Mercado Pago';
    const pagamento = document.createElement('p'); pagamento.textContent = pedido.pagamento === 'site' ? (pedido.pagamento_status === 'approved' ? `Pagamento aprovado — ${provedor}` : `Pagamento: ${pedido.pagamento_status || 'pendente'} — ${provedor}`) : 'Pedido anterior à integração'; card.append(pagamento);
    const acoes = card.querySelector('.pedido-acoes');
    if (situacao.proximo && (pedido.pagamento !== 'site' || pedido.pagamento_status === 'approved')) { const botao = document.createElement('button'); botao.className = 'btn btn-primary'; botao.textContent = situacao.acao; botao.onclick = () => atualizarStatus(pedido.id, situacao.proximo); acoes.append(botao); }
    if (['pendente', 'aceito', 'em_preparo'].includes(pedido.status)) { const cancelar = document.createElement('button'); cancelar.className = 'btn btn-cancelar'; cancelar.textContent = 'Cancelar pedido'; cancelar.onclick = () => atualizarStatus(pedido.id, 'cancelado'); acoes.append(cancelar); }
    const imprimir = document.createElement('button'); imprimir.className = 'btn imprimir'; imprimir.textContent = 'Imprimir bilhete'; imprimir.onclick = () => imprimirBilhete(pedido, itens); acoes.append(imprimir); area.append(card);
  });
  document.getElementById('pagina-anterior').disabled = pagina === 0;
  document.getElementById('pagina-proxima').disabled = !temMais;
  document.getElementById('pagina-pedidos').textContent = `Página ${pagina + 1}`;
  document.getElementById('atualizacao-pedidos').textContent = `${pedidos.length} pedido(s) nesta página. Atualizado às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Atualização automática a cada 15 segundos.`;
  } finally { carregando = false; }
}
function imprimirBilhete(pedido) {
  const janela = window.open('', '_blank', 'width=360,height=600');
  if (!janela) return mostrarErro(new Error('Permita a abertura da janela para imprimir o bilhete.'));
  janela.document.write(bilhetePedido(pedido)); janela.document.close();
  janela.focus(); janela.print();
}
document.addEventListener('DOMContentLoaded', async () => {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const valor = tipo => partes.find(p => p.type === tipo).value;
  document.getElementById('data-pedidos').value = `${valor('year')}-${valor('month')}-${valor('day')}`;
  if (!(await sessaoPronta)) return;
  const atualizar = () => carregar().catch(mostrarErro);
  document.getElementById('filtros-pedidos').addEventListener('submit', event => { event.preventDefault(); if (carregando || alterando) return; pagina = 0; atualizar(); });
  document.getElementById('pagina-anterior').addEventListener('click', () => { if (carregando || alterando) return; pagina = Math.max(0, pagina - 1); atualizar(); });
  document.getElementById('pagina-proxima').addEventListener('click', () => { if (carregando || alterando) return; pagina++; atualizar(); });
  await atualizar();
  window.setInterval(() => { if (!document.hidden && !alterando) atualizar(); }, 15000);
});
