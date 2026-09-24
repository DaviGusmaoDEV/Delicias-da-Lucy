const esc = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
const dinheiro = valor => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function bilhetePedido(pedido) {
  const itens = (pedido.itens_pedido || []).map(item => `<li><b>${esc(item.quantidade)}x ${esc(item.products?.nome || 'Item')}</b><br>${esc(dinheiro(item.preco_unitario * item.quantidade))}${item.observacao_item ? `<br>Obs.: ${esc(item.observacao_item)}` : ''}</li>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Pedido ${esc(pedido.id)}</title><style>
  @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;font:13px monospace;color:#000}h1{font-size:19px;text-align:center}h2{font-size:15px}section{border-top:1px dashed;padding:8px 0}p{margin:5px 0;overflow-wrap:anywhere}ul{list-style:none;padding:0}li{margin-bottom:10px;break-inside:avoid}footer{text-align:center;margin:12px 0}
  </style></head><body><h1>DELÍCIAS DA LUCY</h1><h2>Pedido #${esc(pedido.id)}</h2>
  <section><p><b>Nome:</b> ${esc(pedido.cliente_nome || pedido.profiles?.nome || 'Cliente')}</p><p><b>Bairro:</b> ${esc(pedido.bairro)}</p><p><b>Rua:</b> ${esc(pedido.endereco)}</p><p><b>Número:</b> ${esc(pedido.numero_casa)}</p></section>
  <section><ul>${itens}</ul>${pedido.observacao_geral ? `<p><b>Observação:</b> ${esc(pedido.observacao_geral)}</p>` : ''}</section>
  <section><p>Subtotal: ${esc(dinheiro(pedido.subtotal))}</p><p>Entrega: ${esc(dinheiro(pedido.taxa_entrega))}</p><p><b>Total: ${esc(dinheiro(pedido.valor))}</b></p><p>${pedido.pagamento_status === 'approved' ? `PAGO — ${String(pedido.pagamento_id || '').startsWith('infinitepay:') ? 'InfinitePay' : 'Mercado Pago'}` : 'PAGAMENTO NÃO CONFIRMADO'}</p></section><footer>Obrigada pela preferência!</footer></body></html>`;
}
