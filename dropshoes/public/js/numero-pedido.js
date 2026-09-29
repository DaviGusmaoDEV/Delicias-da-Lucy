export function numeroComercial(pedido) {
  const numero = Number(pedido?.numero_pedido);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

export function rotuloPedido(pedido, { historico = 'Pedido histórico', tecnico = false } = {}) {
  const numero = numeroComercial(pedido);
  if (numero) return `Pedido N${numero}`;
  return tecnico && pedido?.id != null ? `${historico} (ID técnico ${pedido.id})` : historico;
}
