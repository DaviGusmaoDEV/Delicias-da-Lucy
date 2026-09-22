const API_URL = window.location.origin;
const token = localStorage.getItem('token');
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
async function atualizarStatus(id, status) {
  const resposta = await fetch(`${API_URL}/api/pedidos/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) });
  if (!resposta.ok) return alert((await resposta.json()).erro || 'Não foi possível atualizar o pedido.'); carregar();
}
async function carregar() {
  const resposta = await fetch(`${API_URL}/api/pedidos`, { headers: { Authorization: `Bearer ${token}` } }); if (!resposta.ok) return;
  const pedidos = await resposta.json(); const area = document.getElementById('lista-pedidos'); area.innerHTML = pedidos.length ? '' : '<p>Nenhum pedido novo.</p>';
  pedidos.forEach(pedido => {
    const situacao = STATUS[pedido.status] || STATUS.pendente; const itens = pedido.itens_pedido.map(item => `${item.quantidade}x ${item.products?.nome || 'Item'}`).join(', '); const card = document.createElement('article');
    card.className = `pedido-card status-${pedido.status}`;
    card.innerHTML = `<div class="pedido-cabecalho"><h2>Pedido N${esc(pedido.id)}</h2><span class="status-pedido status-${esc(pedido.status)}">${situacao.texto}</span></div><p class="status-detalhe">${situacao.detalhe}</p><p><strong>Cliente:</strong> ${esc(pedido.profiles?.nome || 'Cliente')}</p><p><strong>Entrega:</strong> ${esc(pedido.endereco)}, nº ${esc(pedido.numero_casa)} — ${esc(pedido.bairro)}, CEP ${esc(pedido.cep)}</p><p><strong>Itens:</strong> ${esc(itens)}</p><p><strong>Total:</strong> ${dinheiro(pedido.valor)}</p><div class="pedido-acoes"></div>`;
    const acoes = card.querySelector('.pedido-acoes');
    if (situacao.proximo) { const botao = document.createElement('button'); botao.className = 'btn btn-primary'; botao.textContent = situacao.acao; botao.onclick = () => atualizarStatus(pedido.id, situacao.proximo); acoes.append(botao); }
    if (pedido.status !== 'recebido' && pedido.status !== 'cancelado') { const cancelar = document.createElement('button'); cancelar.className = 'btn btn-cancelar'; cancelar.textContent = 'Cancelar pedido'; cancelar.onclick = () => atualizarStatus(pedido.id, 'cancelado'); acoes.append(cancelar); }
    if (pedido.status === 'pronto_entrega' && pedido.profiles?.telefone) { const lembrete = document.createElement('a'); lembrete.className = 'btn btn-whatsapp'; const numero = String(pedido.profiles.telefone).replace(/\D/g, ''); lembrete.href = `https://wa.me/${numero.startsWith('55') ? numero : `55${numero}`}?text=${encodeURIComponent(`Olá, ${pedido.profiles.nome}! O pedido N${pedido.id} já foi entregue? Por favor, confirme o recebimento no site.`)}`; lembrete.target = '_blank'; lembrete.textContent = 'Enviar lembrete no WhatsApp'; acoes.append(lembrete); }
    const imprimir = document.createElement('button'); imprimir.className = 'btn imprimir'; imprimir.textContent = 'Imprimir bilhete'; imprimir.onclick = () => imprimirBilhete(pedido, itens); acoes.append(imprimir); area.append(card);
  });
}
function imprimirBilhete(pedido, itens) { const janela = window.open('', '_blank', 'width=360,height=600'); janela.document.write(`<!doctype html><title>Pedido N${pedido.id}</title><style>body{font:16px monospace;padding:16px}h1{font-size:22px;border-bottom:1px dashed}p{margin:8px 0}</style><h1>DELÍCIAS DA LUCY<br>Pedido N${esc(pedido.id)}</h1><p><b>Nome:</b> ${esc(pedido.profiles?.nome || 'Cliente')}</p><p><b>Endereço:</b> ${esc(pedido.endereco)}</p><p><b>Número da casa:</b> ${esc(pedido.numero_casa)}</p><p><b>Bairro:</b> ${esc(pedido.bairro)}</p><p><b>CEP:</b> ${esc(pedido.cep)}</p><p><b>Itens:</b> ${esc(itens)}</p><p><b>Total:</b> ${dinheiro(pedido.valor)}</p>`); janela.document.close(); janela.print(); }
document.addEventListener('DOMContentLoaded', () => { carregar(); window.setInterval(carregar, 30000); });
