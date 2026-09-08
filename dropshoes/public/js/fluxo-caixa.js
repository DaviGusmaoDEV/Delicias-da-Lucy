// fluxo-caixa.js

const el = {
    modalTransacao: document.getElementById("modalTransacao"),
    formTransacao: document.getElementById("form-transacao"),
    btnAbrirTransacao: document.getElementById("btnAbrirModalTransacao"),
    btnFecharTransacao: document.getElementById("btnFecharModalTransacao-add"),
    
    // Elementos do Modal de Edição
    dialogEdicao: document.getElementById("modalEditar"),
    formEdicao: document.getElementById("form-editar-transacao"),
    btnFecharModalEdicao: document.getElementById("btn-edicao-fechar"),
    
    // Elementos do Modal de Filtro por Ícone
    modalFiltro: document.getElementById("modalFiltro"),
    btnAbrirFiltro: document.getElementById("btnAbrirModalFiltro"),
    btnFecharFiltro: document.getElementById("btnFecharModalFiltro"),
    btnAplicarFiltro: document.getElementById("btnAplicarFiltro"),
    btnLimparFiltro: document.getElementById("btnLimparFiltro"),
    inputDataInicial: document.getElementById("data-inicial"),
    inputDataFinal: document.getElementById("data-final"),
    inputFuncionarioFiltro: document.getElementById("funcionario-filtro"),

    // Campos do formulário de cadastro
    inputDescricao: document.getElementById("descricao"),
    selectTipo: document.getElementById("tipo"),
    inputValor: document.getElementById("valor"),
    inputData: document.getElementById("data"),

    // Campos do formulário de edição
    inputDescricaoEdicao: document.getElementById("descricao-edicao"),
    selectTipoEdicao: document.getElementById("tipo-edicao"),
    inputValorEdicao: document.getElementById("valor-edicao"),
    inputDataEdicao: document.getElementById("data-edicao"),
};

let transacoes = [];
let transacoesFiltradas = [];
let idTransacaoEmEdicao = null;

if (localStorage.getItem("transacoes")) {
    transacoes = JSON.parse(localStorage.getItem("transacoes"));
    transacoesFiltradas = [...transacoes];
}

// Eventos de Abertura/Fechamento de Modais
if (el.btnAbrirTransacao) {
    el.btnAbrirTransacao.addEventListener("click", () => el.modalTransacao?.showModal());
}
if (el.btnFecharTransacao) {
    el.btnFecharTransacao.addEventListener("click", () => el.modalTransacao?.close());
}
if (el.modalTransacao) {
    el.modalTransacao.addEventListener("click", (e) => {
        if (e.target === el.modalTransacao) el.modalTransacao.close();
    });
}

// Modal de Filtro por Ícone
if (el.btnAbrirFiltro) {
    el.btnAbrirFiltro.addEventListener("click", () => el.modalFiltro?.showModal());
}
if (el.btnFecharFiltro) {
    el.btnFecharFiltro.addEventListener("click", () => el.modalFiltro?.close());
}
if (el.modalFiltro) {
    el.modalFiltro.addEventListener("click", (e) => {
        if (e.target === el.modalFiltro) el.modalFiltro.close();
    });
}

// Fechar Edição
if (el.btnFecharModalEdicao) {
    el.btnFecharModalEdicao.addEventListener("click", () => el.dialogEdicao?.close());
}
if (el.dialogEdicao) {
    el.dialogEdicao.addEventListener("click", (e) => {
        if (e.target === el.dialogEdicao) el.dialogEdicao.close();
    });
}

// Submissão: Nova Transação
if (el.formTransacao) {
    el.formTransacao.addEventListener("submit", (e) => {
        e.preventDefault();
        try {
            const descricao = el.inputDescricao?.value.trim();
            const tipo = el.selectTipo?.value;
            const valor = parseFloat(el.inputValor?.value);
            const data = el.inputData?.value;
            
            if (!descricao) throw new Error("Descrição é obrigatória.");
            if (!tipo) throw new Error("Tipo é obrigatório.");
            if (isNaN(valor) || valor <= 0) throw new Error("Valor deve ser um número positivo.");
            if (!data) throw new Error("Data é obrigatória.");
            
            const novaTransacao = {
                id: Date.now(),
                descricao,
                tipo,
                valor,
                data,
                dataCriacao: new Date().toISOString()
            };
            
            transacoes.push(novaTransacao);
            sincronizarDados();
            
            Swal.fire({
                icon: 'success',
                title: 'Transação salva',
                text: 'Sua transação foi registrada com sucesso.',
                timer: 1800,
                showConfirmButton: false,
            });
            
            el.formTransacao.reset();
            el.modalTransacao?.close();
        } catch (erro) {
            Swal.fire({ icon: 'error', title: 'Erro', text: erro.message });
        }
    });
}

// Submissão: Editar Transação
if (el.formEdicao) {
    el.formEdicao.addEventListener("submit", (e) => {
        e.preventDefault();
        try {
            const descricao = el.inputDescricaoEdicao?.value.trim();
            const tipo = el.selectTipoEdicao?.value;
            const valor = parseFloat(el.inputValorEdicao?.value);
            const data = el.inputDataEdicao?.value;
            
            if (!descricao || !tipo || isNaN(valor) || !data) throw new Error("Preencha todos os campos corretamente.");

            transacoes = transacoes.map(t => {
                if (t.id === idTransacaoEmEdicao) {
                    return { ...t, descricao, tipo, valor, data };
                }
                return t;
            });

            sincronizarDados();
            el.dialogEdicao?.close();

            Swal.fire({
                icon: 'success',
                title: 'Atualizado!',
                text: 'Transação alterada com sucesso.',
                timer: 1500,
                showConfirmButton: false
            });
        } catch (erro) {
            Swal.fire({ icon: 'error', title: 'Erro', text: erro.message });
        }
    });
}

// Lógica de Filtragem Avançada via Mini-Modal
if (el.btnAplicarFiltro) {
    el.btnAplicarFiltro.addEventListener("click", () => {
        const dataIni = el.inputDataInicial.value;
        const dataFim = el.inputDataFinal.value;
        const termoBusca = el.inputFuncionarioFiltro.value.toLowerCase().trim();

        transacoesFiltradas = transacoes.filter(t => {
            let matchData = true;
            let matchBusca = true;

            if (dataIni && t.data < dataIni) matchData = false;
            if (dataFim && t.data > dataFim) matchData = false;
            if (termoBusca && !t.descricao.toLowerCase().includes(termoBusca)) matchBusca = false;

            return matchData && matchBusca;
        });

        el.modalFiltro?.close();
        exibirTransacoes();
    });
}

if (el.btnLimparFiltro) {
    el.btnLimparFiltro.addEventListener("click", () => {
        el.inputDataInicial.value = "";
        el.inputDataFinal.value = "";
        el.inputFuncionarioFiltro.value = "";
        transacoesFiltradas = [...transacoes];
        el.modalFiltro?.close();
        exibirTransacoes();
    });
}

function sincronizarDados() {
    localStorage.setItem("transacoes", JSON.stringify(transacoes));
    transacoesFiltradas = [...transacoes];
    exibirTransacoes();
}

function exibirTransacoes() {
    const corpoTabela = document.getElementById("corpo-tabela-fluxo-caixa");
    const template = document.getElementById("template-linha-transacao");
    
    if (!corpoTabela || !template) return;
    corpoTabela.innerHTML = "";
    
    if (transacoesFiltradas.length === 0) {
        corpoTabela.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #999; padding: 20px;">Nenhuma transação encontrada</td></tr>';
        calcularTotais();
        return;
    }
    
    transacoesFiltradas.forEach((transacao) => {
        const clone = template.content.cloneNode(true);
        const data = new Date(transacao.data + "T00:00:00");
        const dataFormatada = data.toLocaleDateString("pt-BR");
        
        clone.querySelector(".col-data").textContent = dataFormatada;
        clone.querySelector(".txt-descricao").textContent = transacao.descricao;
        
        const badgeTipo = clone.querySelector(".badge-tipo");
        let tipoTexto = transacao.tipo;
        if (tipoTexto === "receita") tipoTexto = "Entrada";
        else if (tipoTexto === "despesa") tipoTexto = "Saída";
        else if (tipoTexto === "total-despesa-funcionario") tipoTexto = "Despesa Funcionário";
        
        badgeTipo.textContent = tipoTexto;
        const colValor = clone.querySelector(".col-valor");
        colValor.textContent = `R$ ${transacao.valor.toFixed(2).replace(".", ",")}`;
        
        if (transacao.tipo === "receita") {
            colValor.classList.add("status-receita");
            badgeTipo.classList.add("status-receita");
        } else if (transacao.tipo === "despesa") {
            colValor.classList.add("status-despesa");
            badgeTipo.classList.add("status-despesa");
        } else if (transacao.tipo === "total-despesa-funcionario") {
            colValor.classList.add("status-despesa-funcionario");
            badgeTipo.classList.add("status-despesa-funcionario");
        }
        
        // Botão de Editar na linha
        clone.querySelector(".btn-edicao").addEventListener("click", () => {
            idTransacaoEmEdicao = transacao.id;
            if (el.inputDescricaoEdicao) el.inputDescricaoEdicao.value = transacao.descricao;
            if (el.selectTipoEdicao) el.selectTipoEdicao.value = transacao.tipo;
            if (el.inputValorEdicao) el.inputValorEdicao.value = transacao.valor;
            if (el.inputDataEdicao) el.inputDataEdicao.value = transacao.data;
            
            el.dialogEdicao?.showModal();
        });
        
        // Botão de Excluir na linha
        clone.querySelector(".btn-exclusao").addEventListener("click", () => {
            Swal.fire({
                title: 'Excluir transação?',
                text: 'Essa ação não pode ser desfeita.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sim, excluir',
                cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) {
                    transacoes = transacoes.filter(t => t.id !== transacao.id);
                    sincronizarDados();
                    Swal.fire({ icon: 'success', title: 'Excluída!', timer: 1500, showConfirmButton: false });
                }
            });
        });
        
        corpoTabela.appendChild(clone);
    });
    
    calcularTotais();
}

function calcularTotais() {
    let totalFaturamento = 0;
    let totalDespesa = 0;
    let totalDespesaFuncionario = 0;
    
    transacoesFiltradas.forEach((transacao) => {
        if (transacao.tipo === "receita") totalFaturamento += transacao.valor;
        else if (transacao.tipo === "despesa") totalDespesa += transacao.valor;
        else if (transacao.tipo === "total-despesa-funcionario") totalDespesaFuncionario += transacao.valor;
    });
    
    const saldoLiquido = totalFaturamento - totalDespesa - totalDespesaFuncionario;
    
    const elFaturamento = document.getElementById("total-faturamento");
    const elDespesa = document.getElementById("total-despesa");
    const elDespesaFuncionario = document.getElementById("total-despesa-funcionario");
    const elSaldo = document.getElementById("saldo-liquido");

    if (elFaturamento) elFaturamento.textContent = `R$ ${totalFaturamento.toFixed(2).replace(".", ",")}`;
    if (elDespesa) elDespesa.textContent = `R$ ${totalDespesa.toFixed(2).replace(".", ",")}`;
    if (elDespesaFuncionario) elDespesaFuncionario.textContent = `R$ ${totalDespesaFuncionario.toFixed(2).replace(".", ",")}`;

    if (elSaldo) {
        elSaldo.textContent = `R$ ${saldoLiquido.toFixed(2).replace(".", ",")}`;
        elSaldo.style.color = saldoLiquido >= 0 ? "var(--success)" : "var(--danger)";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    exibirTransacoes();
});