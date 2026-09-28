function bancoSimulado() {
  const tabelas = {
    profiles: [
      { id: 'admin1', nome: 'Dona', email: 'dona@example.test', senha: 'senha-admin', role: 'admin1' },
      { id: 'admin2', nome: 'Equipe', email: 'equipe@example.test', senha: 'senha-admin', role: 'admin2' }
    ],
    products: [{ id: 'p1', nome: 'Produto teste', preco: 12.35, categoria: 'outros', imagem_url: 'https://example.test/foto.jpg', descricao: 'Descrição existente' }],
    clientes_visitantes: [], pedidos: [], itens_pedido: [], fluxo_caixa: [], pagamento_eventos: []
  };
  let contador = 0;
  const db = {
    tabelas, falhar: null, concorrer: false, rpcPagamentoLegado: false,
    async rpc(nome, argumentos = {}) {
      if (nome === 'confirmar_recebimento_pedido') {
        const pedido = tabelas.pedidos.find(item => String(item.id) === String(argumentos.p_pedido_id));
        if (!pedido || pedido.status !== 'pronto_entrega' || db.concorrer) return { data: null, error: { code: 'P0001' } };
        const recebidoEm = argumentos.p_recebido_em;
        Object.assign(pedido, { status: 'recebido', recebido_em: recebidoEm });
        if (pedido.pagamento === 'entrega') {
          Object.assign(pedido, { pagamento_status: 'approved', pagamento_id: pedido.pagamento_id || `entrega:${pedido.id}`, pagamento_atualizado: recebidoEm, pago_em: pedido.pago_em || recebidoEm });
          if (!tabelas.fluxo_caixa.some(item => item.pedido_id === String(pedido.id) && item.tipo === 'receita')) tabelas.fluxo_caixa.push({ id: `novo-${++contador}`, descricao: `Pedido #${pedido.id} — pagamento na entrega`, tipo: 'receita', valor: pedido.valor, data: recebidoEm.slice(0, 10), pedido_id: String(pedido.id) });
        }
        return { data: { ...pedido }, error: null };
      }
      if (nome === 'excluir_pedido_cancelado') {
        const pedido = tabelas.pedidos.find(item => String(item.id) === String(argumentos.p_pedido_id));
        const financeiro = pedido && (pedido.pago_em || ['approved', 'refunded', 'charged_back'].includes(pedido.pagamento_status) || tabelas.fluxo_caixa.some(item => item.pedido_id === String(pedido.id)));
        if (!pedido) return { data: false, error: null };
        if (pedido.status !== 'cancelado' || financeiro) return { data: null, error: { code: 'P0001' } };
        tabelas.itens_pedido = tabelas.itens_pedido.filter(item => String(item.pedido_id) !== String(pedido.id));
        tabelas.pedidos = tabelas.pedidos.filter(item => item !== pedido);
        return { data: true, error: null };
      }
      if (nome !== 'criar_pedido_com_itens') throw new Error('RPC desconhecida');
      const { p_pedido, p_itens } = argumentos;
      if (db.falhar === 'pedidos' || db.falhar === 'itens_pedido') return { data: null, error: { code: 'simulado' } };
      const anterior = tabelas.pedidos.find(p => p.checkout_chave === p_pedido.checkout_chave);
      if (anterior) return { data: anterior, error: null };
      // Simula a versão antiga da função instalada no Supabase, que ignorava
      // pagamento: "entrega" e persistia "site".
      const pedido = { id: `novo-${++contador}`, data_criacao: new Date().toISOString(), ...p_pedido, ...(db.rpcPagamentoLegado ? { pagamento: 'site' } : {}) };
      tabelas.pedidos.push(pedido);
      tabelas.itens_pedido.push(...p_itens.map(item => ({ id: `novo-${++contador}`, ...item, pedido_id: pedido.id })));
      return { data: { ...pedido }, error: null };
    },
    from(tabela) {
      let filtros = [], valores, operacao = 'select', campos = '*', unico = false, retornar = false, ordem, intervalo;
      const query = {
        select(valor = '*') { campos = valor; retornar = true; return this; },
        eq(campo, valor) { filtros.push(row => String(row[campo]) === String(valor)); return this; },
        gte(campo, valor) { filtros.push(row => row[campo] >= valor); return this; },
        lte(campo, valor) { filtros.push(row => row[campo] <= valor); return this; },
        lt(campo, valor) { filtros.push(row => row[campo] < valor); return this; },
        range(inicio, fim) { intervalo = [inicio, fim]; return this; },
        is(campo, valor) { filtros.push(row => valor === null ? row[campo] == null : row[campo] === valor); return this; },
        in(campo, lista) { filtros.push(row => lista.map(String).includes(String(row[campo]))); return this; },
        order(campo, opcoes = {}) { ordem = { campo, asc: opcoes.ascending !== false }; return this; },
        insert(valor) { operacao = 'insert'; valores = valor; return this; },
        update(valor) { operacao = 'update'; valores = valor; return this; },
        delete() { operacao = 'delete'; return this; },
        single() { unico = true; return this; },
        maybeSingle() { unico = true; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (db.falhar === tabela) throw new Error('Falha interna simulada, não expor');
            let linhas = tabelas[tabela].filter(row => filtros.every(f => f(row)));
            if (operacao === 'insert') {
              if (tabela === 'profiles' && tabelas.profiles.some(p => p.email === valores[0].email)) return { data: null, error: { code: '23505' } };
              if (tabela === 'pagamento_eventos' && tabelas.pagamento_eventos.some(p => p.provedor === valores[0].provedor && (p.evento_id === valores[0].evento_id || (p.pagamento_id === valores[0].pagamento_id && p.status === valores[0].status)))) return { data: null, error: { code: '23505' } };
              linhas = valores.map(v => ({ id: `novo-${++contador}`, ...v })); tabelas[tabela].push(...linhas);
            }
            if (operacao === 'update') {
              if (db.concorrer && tabela === 'pedidos') linhas = [];
              linhas.forEach(row => Object.assign(row, valores));
            }
            if (operacao === 'delete') tabelas[tabela] = tabelas[tabela].filter(row => !linhas.includes(row));
            let data = linhas.map(row => campos.includes('*') || campos.includes('(') ? { ...row } : Object.fromEntries(campos.split(',').map(k => [k, row[k]])));
            if (ordem) data.sort((a, b) => String(a[ordem.campo]).localeCompare(String(b[ordem.campo])) * (ordem.asc ? 1 : -1));
            if (intervalo) data = data.slice(intervalo[0], intervalo[1] + 1);
            return { data: retornar ? unico ? data[0] || null : data : null, error: null };
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  return db;
}
module.exports = { bancoSimulado };
