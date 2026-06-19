// fluxo-caixa.js

const el = {
    modalTransacao: document.getElementById("modalTransacao"),
    formTransacao: document.getElementById("form-transacao"),
    btnAbrirTransacao: document.getElementById("btnAbrirModalTransacao"),
    btnFecharTransacao: document.getElementById("btnFecharModalTransacao-add"),
    btnFecharModalEdicao: document.getElementById("btn-edicao-fechar"),
    btnSalvarEdicao: document.getElementById("btnSalvarTransacao"),
    btnAbrirEdicao: document.getElementById("btn-edicao"),
    dialogEdicao: document.getElementById("modalEditar"),
    btnExcluirTransacao: document.getElementById("btnExcluirTransacao"),
    inputDescricao: document.getElementById("descricao"),
    selectTipo: document.getElementById("tipo"),
    inputValor: document.getElementById("valor"),
    inputData: document.getElementById("data"),
};

let transacoes = [];

if (localStorage.getItem("transacoes")) {
    transacoes = JSON.parse(localStorage.getItem("transacoes"));
}

if (el.btnAbrirTransacao) {
    el.btnAbrirTransacao.addEventListener("click", () => {
        if (el.modalTransacao) el.modalTransacao.showModal();
    });
}

if (el.btnFecharTransacao) {
    el.btnFecharTransacao.addEventListener("click", () => {
        if (el.modalTransacao) el.modalTransacao.close();
    });
}

if (el.modalTransacao) {
    el.modalTransacao.addEventListener("click", (e) => {
        if (e.target === el.modalTransacao) el.modalTransacao.close();
    });
}

// CORREÇÃO: Vinculado corretamente para abrir e fechar a janela de Edição dedicada (dialogEdicao)
if (el.btnAbrirEdicao) {
    el.btnAbrirEdicao.addEventListener("click", () => {
        if (el.dialogEdicao) el.dialogEdicao.showModal();
    });
}
if (el.btnFecharModalEdicao) {
    el.btnFecharModalEdicao.addEventListener("click", () => {
        if (el.dialogEdicao) el.dialogEdicao.close();
    });
}

if (el.btnExcluirTransacao) {
    el.btnExcluirTransacao.addEventListener("click", () => {
        Swal.fire({
            title: 'Excluir transação?',
            text: 'Essa ação não pode ser desfeita.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, excluir',
            cancelButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                const id = parseInt(el.btnExcluirTransacao.dataset.id);
                transacoes = transacoes.filter(t => t.id !== id);
                localStorage.setItem("transacoes", JSON.stringify(transacoes));
                exibirTransacoes();
                if (el.modalTransacao) el.modalTransacao.close();
                
                Swal.fire({
                    icon: 'success',
                    title: 'Excluída',
                    text: 'Transação excluída com sucesso.',
                    timer: 1500,
                    showConfirmButton: false
                });
            }
        });
    });
}

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
            localStorage.setItem("transacoes", JSON.stringify(transacoes));
            
            Swal.fire({
                icon: 'success',
                title: 'Transação salva',
                text: 'Sua transação foi registrada com sucesso.',
                timer: 1800,
                showConfirmButton: false,
            });
            
            el.formTransacao.reset();
            if (el.modalTransacao) el.modalTransacao.close();
            exibirTransacoes();
        } catch (erro) {
            Swal.fire({ icon: 'error', title: 'Erro', text: erro.message });
            console.error(erro.message);
        }
    });
}

function exibirTransacoes() {
    const corpoTabela = document.getElementById("corpo-tabela-fluxo-caixa");
    const template = document.getElementById("template-linha-transacao");
    
    if (!corpoTabela || !template) return;
    corpoTabela.innerHTML = "";
    
    if (transacoes.length === 0) {
        corpoTabela.innerHTML = '<tr><td colspan="5" style="text-align:center; color: #999;">Nenhuma transação registrada</td></tr>';
        return;
    }
    
    transacoes.forEach((transacao) => {
        const clone = template.content.cloneNode(true);
        const data = new Date(transacao.data + "T00:00:00");
        const dataFormatada = data.toLocaleDateString("pt-BR");
        
        clone.querySelector(".col-data").textContent = dataFormatada;
        clone.querySelector(".txt-descricao").textContent = transacao.descricao;
        clone.querySelector(".badge-tipo").textContent = transacao.tipo.charAt(0).toUpperCase() + transacao.tipo.slice(1);
        clone.querySelector(".col-valor").textContent = `R$ ${transacao.valor.toFixed(2).replace(".", ",")}`;
        
        if (transacao.tipo === "receita") {
            clone.querySelector(".col-valor").classList.add("status-receita");
            clone.querySelector(".badge-tipo").classList.add("status-receita");
        } else if (transacao.tipo === "despesa") {
            clone.querySelector(".col-valor").classList.add("status-despesa");
            clone.querySelector(".badge-tipo").classList.add("status-despesa");
        } else if (transacao.tipo === "total-despesa-funcionario") {
            clone.querySelector(".col-valor").classList.add("status-despesa-funcionario");
            clone.querySelector(".badge-tipo").classList.add("status-despesa-funcionario");
        }
        
        clone.querySelector(".btn-edicao").addEventListener("click", () => {
            if (el.dialogEdicao) el.dialogEdicao.showModal();
        });
        
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
                    localStorage.setItem("transacoes", JSON.stringify(transacoes));
                    exibirTransacoes();
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
    
    transacoes.forEach((transacao) => {
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