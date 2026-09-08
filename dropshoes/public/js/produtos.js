// produtos.js

const el = {
    listaProdutos: document.getElementById("lista-produtos"),
    templateCard: document.getElementById("template-card-produto"),
    modal: document.getElementById("modal-produto"),
    formProduto: document.getElementById("form-produto"),
    modalEspecial: document.getElementById("modal-produto-especial"),
    formProdutoEspecial: document.getElementById("form-produto-especial"),
    
    // Inputs Produto Comum
    inputId: document.getElementById("prod-id"),
    inputNome: document.getElementById("prod-nome"),
    inputPreco: document.getElementById("prod-preco"),
    selectCategoria: document.getElementById("prod-categoria"),
    
    // Inputs Produto Especial
    inputIdEspecial: document.getElementById("prod-id-especial"),
    inputNomeEspecial: document.getElementById("prod-nome-especial"),
    inputPrecoEspecial: document.getElementById("prod-preco-especial"),
    selectCategoriaEspecial: document.getElementById("prod-categoria-especial"),
    
    // Botões de Abertura de Modal
    btnAbrirModal: document.getElementById("abrirModalProduto"),
    btnAbrirModalEspecial: document.getElementById("abrirModalProdutoEspecial"),
    
    // Filtro de Categoria
    filtroCategoria: document.getElementById("filtro-categoria")
};

const API_URL = 'https://delicias-da-lucy.onrender.com';
let listaProdutosGlobal = [];

// --- BUSCA DE DADOS ---
async function carregarProdutos() {
    const token = localStorage.getItem('token');
    try {
        const resposta = await fetch(`${API_URL}/api/produtos`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (resposta.status === 401 || resposta.status === 403) {
            alert('Sua sessão expirou ou você não tem permissão. Faça login novamente.');
            localStorage.removeItem('token');
            window.location.href = 'login.html';
            return;
        }

        if (!resposta.ok) throw new Error("Erro ao buscar.");

        listaProdutosGlobal = await resposta.json();
        aplicarFiltroECategoria();
    } catch (erro) {
        console.error(erro);
        if (el.listaProdutos) {
            el.listaProdutos.innerHTML = '<p style="text-align:center; color: var(--danger, #e74c3c); grid-column: 1/-1;">Não foi possível carregar os produtos do servidor.</p>';
        }
    }
}

// --- ABRIR / FECHAR MODAIS ---
if (el.btnAbrirModal && el.modal) {
    el.btnAbrirModal.addEventListener("click", () => {
        el.formProduto?.reset();
        if (el.inputId) el.inputId.value = "";
        el.modal.showModal();
    });
}

if (el.btnAbrirModalEspecial && el.modalEspecial) {
    el.btnAbrirModalEspecial.addEventListener("click", () => {
        el.formProdutoEspecial?.reset();
        if (el.inputIdEspecial) el.inputIdEspecial.value = "";
        el.modalEspecial.showModal();
    });
}

if (el.modal) {
    el.modal.addEventListener("click", (e) => {
        if (e.target === el.modal) el.modal.close();
    });
    document.getElementById("btn-fechar-modal")?.addEventListener("click", () => el.modal.close());
}

if (el.modalEspecial) {
    el.modalEspecial.addEventListener("click", (e) => {
        if (e.target === el.modalEspecial) el.modalEspecial.close();
    });
    document.getElementById("btn-fechar-modal-especial")?.addEventListener("click", () => el.modalEspecial.close());
}

// --- FILTRAGEM ---
if (el.filtroCategoria) {
    el.filtroCategoria.addEventListener("change", aplicarFiltroECategoria);
}

function aplicarFiltroECategoria() {
    const categoriaSelecionada = el.filtroCategoria ? el.filtroCategoria.value : "todos";
    
    const produtosFiltrados = listaProdutosGlobal.filter(produto => {
        if (categoriaSelecionada === "todos") return true;
        return produto.categoria === categoriaSelecionada;
    });

    exibirProdutos(produtosFiltrados);
}

// --- RENDERIZAÇÃO ---
function exibirProdutos(lista) {
    if (!el.listaProdutos || !el.templateCard) return;
    el.listaProdutos.innerHTML = "";

    if (lista.length === 0) {
        el.listaProdutos.innerHTML = '<p style="text-align:center; color: #888; grid-column: 1/-1; padding: 20px;">Nenhum produto encontrado nesta categoria.</p>';
        return;
    }

    lista.forEach(produto => {
        const clone = el.templateCard.content.cloneNode(true);

        const imgVitrine = clone.querySelector(".img-vitrine");
        if (imgVitrine) {
            imgVitrine.src = produto.imagem || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=400";
            imgVitrine.alt = produto.nome;
        }

        clone.querySelector(".titulo-vitrine").textContent = produto.nome;
        clone.querySelector(".preco-vitrine").textContent = `R$ ${parseFloat(produto.preco || 0).toFixed(2).replace(".", ",")}`;

        const badgeEspecial = clone.querySelector(".badge-especial");
        if (badgeEspecial && produto.isEspecial) {
            badgeEspecial.style.display = "inline-block";
        }

        clone.querySelector(".btn-editar")?.addEventListener("click", () => abrirEdicao(produto));
        clone.querySelector(".btn-excluir")?.addEventListener("click", () => confirmarExclusao(produto.id));

        el.listaProdutos.appendChild(clone);
    });
}

// --- SUPORTE À EDIÇÃO ---
function abrirEdicao(produto) {
    if (produto.isEspecial) {
        if (el.inputIdEspecial) el.inputIdEspecial.value = produto.id;
        if (el.inputNomeEspecial) el.inputNomeEspecial.value = produto.nome;
        if (el.inputPrecoEspecial) el.inputPrecoEspecial.value = produto.preco.toString().replace(".", ",");
        if (el.selectCategoriaEspecial) el.selectCategoriaEspecial.value = produto.categoria || "pasteis-salgados";
        el.modalEspecial?.showModal();
    } else {
        if (el.inputId) el.inputId.value = produto.id;
        if (el.inputNome) el.inputNome.value = produto.nome;
        if (el.inputPreco) el.inputPreco.value = produto.preco.toString().replace(".", ",");
        if (el.selectCategoria) el.selectCategoria.value = produto.categoria || "pasteis-salgados";
        el.modal?.showModal();
    }
}

// --- ENVIO DE DADOS (POST / PUT) ---
async function processarFormulario(event, tipoModal) {
    event.preventDefault();
    const esEspecial = (tipoModal === 'especial');

    const id = esEspecial ? el.inputIdEspecial?.value : el.inputId?.value;
    const nome = esEspecial ? el.inputNomeEspecial?.value : el.inputNome?.value;
    const precoTexto = esEspecial ? el.inputPrecoEspecial?.value : el.inputPreco?.value;
    const categoria = esEspecial ? el.selectCategoriaEspecial?.value : el.selectCategoria?.value;
    const preco = parseFloat(precoTexto?.replace(",", ".") || "0");

    if (!nome || nome.trim() === "") {
        alert('Informe o nome do produto.');
        return;
    }
    if (isNaN(preco) || preco <= 0) {
        alert('Informe um preço válido.');
        return;
    }

    const produto = {
        id: id ? (isNaN(id) ? id : Number(id)) : null,
        nome: nome.trim(),
        preco,
        categoria,
        isEspecial: esEspecial
    };

    const token = localStorage.getItem('token');
    const metodo = produto.id ? 'PUT' : 'POST';
    const urlEndpoint = produto.id ? `${API_URL}/api/produtos/${produto.id}` : `${API_URL}/api/produtos`;

    try {
        const res = await fetch(urlEndpoint, {
            method: metodo,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(produto)
        });

        if (res.ok) {
            carregarProdutos();
            if (esEspecial) {
                el.modalEspecial?.close();
                el.formProdutoEspecial?.reset();
            } else {
                el.modal?.close();
                el.formProduto?.reset();
            }
        } else {
            const erroData = await res.json().catch(() => null);
            alert(erroData?.mensagem || 'Não foi possível salvar o produto.');
        }
    } catch (erro) {
        console.error(erro);
        alert('Falha de conexão com o servidor.');
    }
}

// --- EXCLUSÃO ---
async function confirmarExclusao(id) {
    if (!confirm('Deseja realmente excluir este produto?')) return;

    try {
        const resposta = await fetch(`${API_URL}/api/produtos/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });

        if (resposta.ok) {
            carregarProdutos();
        } else {
            alert('Não foi possível excluir o produto.');
        }
    } catch (erro) {
        console.error(erro);
        alert('Falha de conexão com o servidor.');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    carregarProdutos();
    el.formProduto?.addEventListener("submit", (e) => processarFormulario(e, 'tradicional'));
    el.formProdutoEspecial?.addEventListener("submit", (e) => processarFormulario(e, 'especial'));
});