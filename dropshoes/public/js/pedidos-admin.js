import { api, enviar } from './api.js';
import { sessaoPronta } from './sessao.js';
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
  try { await enviar(`/api/pedidos/${encodeURIComponent(id)}/status`, 'PATCH', { status }); await carregar(); }
  catch (erro) { mostrarErro(erro); }
}
async function carregar() {
  const pedidos = await api('/api/pedidos');
  const aviso = document.getElementById('erro-pedidos'); if (aviso) aviso.textContent = '';
  const area = document.getElementById('lista-pedidos'); area.innerHTML = pedidos.length ? '' : '<p>Nenhum pedido novo.</p>';
  pedidos.forEach(pedido => {
    const situacao = STATUS[pedido.status] || STATUS.pendente; const itens = (pedido.itens_pedido || []).map(item => `${item.quantidade}x ${item.products?.nome || 'Item'}`).join(', '); const card = document.createElement('article');
    card.className = `pedido-card status-${pedido.status}`;
    card.innerHTML = `<div class="pedido-cabecalho"><h2>Pedido N${esc(pedido.id)}</h2><span class="status-pedido status-${esc(pedido.status)}">${situacao.texto}</span></div><p class="status-detalhe">${situacao.detalhe}</p><p><strong>Cliente:</strong> ${esc(pedido.profiles?.nome || 'Cliente')}</p><p><strong>Entrega:</strong> ${esc(pedido.endereco)}, nº ${esc(pedido.numero_casa)} — ${esc(pedido.bairro)}, CEP ${esc(pedido.cep)}</p><p><strong>Itens:</strong> ${esc(itens)}</p><p><strong>Total:</strong> ${dinheiro(pedido.valor)}</p><div class="pedido-acoes"></div>`;
    const acoes = card.querySelector('.pedido-acoes');
    if (situacao.proximo) { const botao = document.createElement('button'); botao.className = 'btn btn-primary'; botao.textContent = situacao.acao; botao.onclick = () => atualizarStatus(pedido.id, situacao.proximo); acoes.append(botao); }
    if (['pendente', 'aceito', 'em_preparo'].includes(pedido.status)) { const cancelar = document.createElement('button'); cancelar.className = 'btn btn-cancelar'; cancelar.textContent = 'Cancelar pedido'; cancelar.onclick = () => atualizarStatus(pedido.id, 'cancelado'); acoes.append(cancelar); }
    if (pedido.status === 'pronto_entrega' && pedido.profiles?.telefone) { const lembrete = document.createElement('a'); lembrete.className = 'btn btn-whatsapp'; const numero = String(pedido.profiles.telefone).replace(/\D/g, ''); lembrete.href = `https://wa.me/${numero.startsWith('55') ? numero : `55${numero}`}?text=${encodeURIComponent(`Olá, ${pedido.profiles.nome}! O pedido N${pedido.id} já foi entregue? Por favor, confirme o recebimento no site.`)}`; lembrete.target = '_blank'; lembrete.rel = 'noopener'; lembrete.textContent = 'Enviar lembrete no WhatsApp'; acoes.append(lembrete); }
    const imprimir = document.createElement('button'); imprimir.className = 'btn imprimir'; imprimir.textContent = 'Imprimir bilhete'; imprimir.onclick = () => imprimirBilhete(pedido, itens); acoes.append(imprimir); area.append(card);
  });
}
function imprimirBilhete(pedido, itens) { const janela = window.open('', '_blank', 'width=360,height=600'); if (!janela) return mostrarErro(new Error('Permita a abertura da janela para imprimir o bilhete.')); janela.document.write(`<!doctype html><title>Pedido N${esc(pedido.id)}</title><style>body{font:16px monospace;padding:16px}h1{font-size:22px;border-bottom:1px dashed}p{margin:8px 0}</style><h1>DELÍCIAS DA LUCY<br>Pedido N${esc(pedido.id)}</h1><p><b>Nome:</b> ${esc(pedido.profiles?.nome || 'Cliente')}</p><p><b>Endereço:</b> ${esc(pedido.endereco)}</p><p><b>Número da casa:</b> ${esc(pedido.numero_casa)}</p><p><b>Bairro:</b> ${esc(pedido.bairro)}</p><p><b>CEP:</b> ${esc(pedido.cep)}</p><p><b>Itens:</b> ${esc(itens)}</p><p><b>Total:</b> ${dinheiro(pedido.valor)}</p>`); janela.document.close(); janela.print(); }
document.addEventListener('DOMContentLoaded', async () => { if (!(await sessaoPronta)) return; const atualizar = () => carregar().catch(mostrarErro); await atualizar(); window.setInterval(atualizar, 30000); });
