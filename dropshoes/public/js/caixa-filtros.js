export function filtrarTransacoes(transacoes, filtros) {
  return transacoes.filter(item => (!filtros.inicio || item.data >= filtros.inicio) &&
    (!filtros.fim || item.data <= filtros.fim) &&
    (!filtros.busca || item.descricao.toLowerCase().includes(filtros.busca)) &&
    (!filtros.tipo || filtros.tipo === 'todos' || (filtros.tipo === 'custos' ? ['despesa', 'total-despesa-funcionario'].includes(item.tipo) : item.tipo === filtros.tipo)));
}
