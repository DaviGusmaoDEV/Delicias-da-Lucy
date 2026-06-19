import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

// --- CONFIGURAÇÃO DE ELEMENTOS (DOM) ---
const el = {
    listaProdutos: document.getElementById("lista-produtos"),
    templateCard: document.getElementById("template-card-produto"),
    modal: document.getElementById("modal-produto"),
    formProduto: document.getElementById("form-produto"),
    modalEspecial: document.getElementById("modal-produto-especial"),
    formProdutoEspecial: document.getElementById("form-produto-especial"),
    inputId: document.getElementById("prod-id"),
    inputNome: document.getElementById("prod-nome"),
    inputPreco: document.getElementById("prod-preco"),
    inputIdEspecial: document.getElementById("prod-id-especial"),
    inputNomeEspecial: document.getElementById("prod-nome-especial"),
    inputPrecoEspecial: document.getElementById("prod-preco-especial")
};

const API_URL = 'https://delicias-da-lucy.onrender.com';

// --- BUSCA DE DADOS ---
async function carregarProdutos() {
    const token = localStorage.getItem('token');
    try {
        const resposta = await fetch(`${API_URL}/api/produtos`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resposta.ok) throw new Error("Erro ao buscar.");
        const lista = await resposta.json();
        exibirProdutos(lista);
    } catch (erro) {
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível carregar os produtos.' });
    }
}

// --- RENDERIZAÇÃO ---
function exibirProdutos(lista) {
    if (!el.listaProdutos || !el.templateCard) return;
    el.listaProdutos.innerHTML = "";

    lista.forEach(produto => {
        const clone = el.templateCard.content.cloneNode(true);
        
        clone.querySelector(".titulo-vitrine").textContent = produto.nome;
        clone.querySelector(".preco-vitrine").textContent = `R$ ${parseFloat(produto.preco).toFixed(2).replace(".", ",")}`;
        
        clone.querySelector(".btn-editar")?.addEventListener("click", () => abrirEdicao(produto));
        clone.querySelector(".btn-excluir")?.addEventListener("click", () => confirmarExclusao(produto.id));

        el.listaProdutos.appendChild(clone);
    });
}

// --- SUPORTE À EDIÇÃO ---
function abrirEdicao(produto) {
    if (produto.isEspecial) {
        el.inputIdEspecial.value = produto.id;
        el.inputNomeEspecial.value = produto.nome;
        el.inputPrecoEspecial.value = produto.preco.toString().replace(".", ",");
        el.modalEspecial.showModal();
    } else {
        el.inputId.value = produto.id;
        el.inputNome.value = produto.nome;
        el.inputPreco.value = produto.preco.toString().replace(".", ",");
        el.modal.showModal();
    }
}

// --- ENVIO DE DADOS (POST/PUT) ---
async function processarFormulario(event, tipoModal) {
    event.preventDefault();
    const esEspecial = (tipoModal === 'especial');
    
    const id = esEspecial ? el.inputIdEspecial.value : el.inputId.value;
    const nome = esEspecial ? el.inputNomeEspecial.value : el.inputNome.value;
    const preco = parseFloat((esEspecial ? el.inputPrecoEspecial.value : el.inputPreco.value).replace(",", "."));

    const produto = { id: id || null, nome, preco, isEspecial: esEspecial };

    const token = localStorage.getItem('token');
    const metodo = produto.id ? 'PUT' : 'POST';

    const res = await fetch(`${API_URL}/api/produtos`, {
        method: metodo,
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(produto)
    });

    if (res.ok) {
        Swal.fire({ icon: 'success', title: 'Salvo!', timer: 1500 });
        carregarProdutos();
        esEspecial ? el.modalEspecial.close() : el.modal.close();
    }
}

// --- EXCLUSÃO ---
async function confirmarExclusao(id) {
    const res = await Swal.fire({ title: 'Excluir este item?', icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) {
        await fetch(`${API_URL}/api/produtos/${id}`, { 
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        carregarProdutos();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    carregarProdutos();
    el.formProduto?.addEventListener("submit", (e) => processarFormulario(e, 'tradicional'));
    el.formProdutoEspecial?.addEventListener("submit", (e) => processarFormulario(e, 'especial'));
});