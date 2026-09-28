export const STATUS_PEDIDO = Object.freeze({
  pendente: ['Aguardando confirmação', 'Seu pedido foi enviado e aguarda a confirmação do restaurante.'],
  aceito: ['Pedido aceito pelo restaurante', 'A cozinha recebeu seu pedido.'],
  em_preparo: ['Pedido em preparo', 'Estamos preparando sua delícia com carinho.'],
  pronto_entrega: ['Pedido pronto / em entrega', 'Seu pedido está a caminho. Confirme quando receber.'],
  recebido: ['Pedido entregue', 'Obrigada pela preferência!'],
  cancelado: ['Pedido cancelado', 'Consulte a loja em caso de dúvidas sobre o pagamento.']
});

export const STATUS_PAGAMENTO = Object.freeze({
  pending: 'Pagamento aguardando confirmação',
  approved: 'Pagamento aprovado',
  in_process: 'Pagamento em processamento',
  authorized: 'Pagamento autorizado',
  rejected: 'Pagamento recusado',
  cancelled: 'Pagamento cancelado',
  refunded: 'Reembolsado',
  charged_back: 'Pagamento contestado/estornado',
  in_mediation: 'Pagamento em mediação'
});

export const statusPedido = status => STATUS_PEDIDO[status] || [
  status ? `Status do pedido: ${status}` : 'Status do pedido indisponível',
  'Consulte o restaurante para obter mais informações.'
];

export const textoPagamento = status => STATUS_PAGAMENTO[status] || (
  status ? `Status do pagamento: ${status}` : 'Status do pagamento indisponível'
);

export const pedidoNoHistorico = pedido => (
  ['recebido', 'cancelado'].includes(pedido?.status) ||
  ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(pedido?.pagamento_status)
);
