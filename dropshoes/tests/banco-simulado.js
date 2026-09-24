function bancoSimulado() {
  const tabelas = {
    profiles: [
      { id: 'admin1', nome: 'Dona', email: 'dona@example.test', senha: 'senha-admin', role: 'admin1' },
      { id: 'admin2', nome: 'Equipe', email: 'equipe@example.test', senha: 'senha-admin', role: 'admin2' }
    ],
    products: [{ id: 'p1', nome: 'Produto teste', preco: 12.35, categoria: 'outros', imagem_url: 'https://example.test/foto.jpg', descricao: 'Descrição existente' }],
    clientes_visitantes: [], pedidos: [], itens_pedido: [], fluxo_caixa: []
  };
  let contador = 0;
  const db = {
    tabelas, falhar: null, concorrer: false,
    async rpc(nome, { p_pedido, p_itens }) {
      if (nome !== 'criar_pedido_com_itens') throw new Error('RPC desconhecida');
      if (db.falhar === 'pedidos' || db.falhar === 'itens_pedido') return { data: null, error: { code: 'simulado' } };
      const anterior = tabelas.pedidos.find(p => p.checkout_chave === p_pedido.checkout_chave);
      if (anterior) return { data: anterior, error: null };
      const pedido = { id: `novo-${++contador}`, data_criacao: new Date().toISOString(), ...p_pedido };
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
