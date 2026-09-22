function bancoSimulado() {
  const tabelas = {
    profiles: [
      { id: 'admin1', nome: 'Dona', email: 'dona@example.test', senha: 'senha-admin', role: 'admin1' },
      { id: 'admin2', nome: 'Equipe', email: 'equipe@example.test', senha: 'senha-admin', role: 'admin2' }
    ],
    products: [{ id: 'p1', nome: 'Produto teste', preco: 12.35, categoria: 'outros', imagem_url: 'https://example.test/foto.jpg', descricao: 'Descrição existente' }],
    pedidos: [], itens_pedido: [], fluxo_caixa: []
  };
  let contador = 0;
  const db = {
    tabelas, falhar: null, concorrer: false,
    from(tabela) {
      let filtros = [], valores, operacao = 'select', campos = '*', unico = false, retornar = false, ordem;
      const query = {
        select(valor = '*') { campos = valor; retornar = true; return this; },
        eq(campo, valor) { filtros.push(row => String(row[campo]) === String(valor)); return this; },
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
