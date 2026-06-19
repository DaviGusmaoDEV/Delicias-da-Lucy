import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

// Inicializa o carrinho buscando do LocalStorage ou array vazio
let carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];

export function adicionarAoCarrinho(produto) {
    try {
        // Validação básica
        if (!produto || !produto.nome || produto.preco <= 0) {
            throw new Error("Dados do produto inválidos.");
        }

        // Verifica se o produto já existe no carrinho pelo ID
        const indice = carrinho.findIndex(item => item.id === produto.id);

        if (indice > -1) {
            // Se já existe, apenas incrementa a quantidade
            carrinho[indice].quantidade = (carrinho[indice].quantidade || 1) + 1;
        } else {
            // Se é novo, adiciona com quantidade 1
            carrinho.push({ ...produto, quantidade: 1 });
        }

        // Salva no LocalStorage
        localStorage.setItem('carrinho', JSON.stringify(carrinho));
        
        Swal.fire({
            icon: 'success',
            title: 'Adicionado!',
            text: `${produto.nome} adicionado ao seu carrinho.`,
            timer: 1500,
            showConfirmButton: false
        });

    } catch (erro) {
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: erro.message,
        });
    }
}

// Função para recuperar itens (útil para a tela de Checkout/Carrinho)
export function obterCarrinho() {
    return JSON.parse(localStorage.getItem('carrinho')) || [];
}

// Função para limpar após finalizar compra
export function limparCarrinho() {
    carrinho = [];
    localStorage.removeItem('carrinho');
}