// Ponto de entrada legado: mantém apenas um fluxo de finalização.
import { finalizarCompra } from './carrinho.js';
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', finalizarCompra);
});
