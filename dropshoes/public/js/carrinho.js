import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

const API_URL = 'https://delicias-da-lucy.onrender.com';

// Número de WhatsApp da loja (apenas números, com DDI 55 + DDD)
// Exemplo: para (16) 99999-9999 → '5516999999999'
const WHATSAPP_LOJA = '5516996200385';

// Inicializa o carrinho buscando do LocalStorage ou array vazio
let carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];

// =========================================================
// FUNÇÕES ORIGINAIS (mantidas como já estavam)
// =========================================================
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
        renderizarCarrinho();
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

// =========================================================
// RENDERIZAÇÃO DO CARRINHO NA TELA (usa o <template> do HTML)
// =========================================================
function renderizarCarrinho() {
    const container = document.getElementById('itens-carrinho');
    const mensagemVazio = document.getElementById('carrinho-vazio-mensagem');
    const template = document.getElementById('template-item-carrinho');

    if (!container || !template) return; // só roda na tela de carrinho

    container.innerHTML = '';
    carrinho = obterCarrinho();

    if (carrinho.length === 0) {
        if (mensagemVazio) mensagemVazio.style.display = 'block';
        atualizarResumo();
        return;
    }

    if (mensagemVazio) mensagemVazio.style.display = 'none';

    carrinho.forEach(item => {
        const clone = template.content.cloneNode(true);
        const totalItem = item.preco * item.quantidade;

        clone.querySelector('.carrinho-item-nome').textContent = item.nome;
        clone.querySelector('.carrinho-item-detalhes').textContent =
            `R$ ${item.preco.toFixed(2)} cada${item.observacao ? ' — ' + item.observacao : ''}`;
        clone.querySelector('.carrinho-item-qtd').textContent = item.quantidade;
        clone.querySelector('.carrinho-item-total').textContent = `R$ ${totalItem.toFixed(2)}`;

        clone.querySelector('.btn-qtd-mais').addEventListener('click', () => alterarQuantidade(item.id, 1));
        clone.querySelector('.btn-qtd-menos').addEventListener('click', () => alterarQuantidade(item.id, -1));

        container.appendChild(clone);
    });

    atualizarResumo();
}

function alterarQuantidade(produtoId, delta) {
    const indice = carrinho.findIndex(item => item.id === produtoId);
    if (indice === -1) return;

    carrinho[indice].quantidade = (carrinho[indice].quantidade || 1) + delta;

    if (carrinho[indice].quantidade <= 0) {
        carrinho.splice(indice, 1);
    }

    localStorage.setItem('carrinho', JSON.stringify(carrinho));
    renderizarCarrinho();
}

// Guarda o valor do frete calculado (em memória, mais confiável que ler o texto da tela)
let valorFreteAtual = 0;

function atualizarResumo() {
    const subtotal = carrinho.reduce((soma, item) => soma + (item.preco * item.quantidade), 0);
    const total = subtotal + valorFreteAtual;

    const elSubtotal = document.getElementById('cart-subtotal');
    const elFrete = document.getElementById('cart-frete');
    const elTotal = document.getElementById('cart-total');

    if (elSubtotal) elSubtotal.textContent = `R$ ${subtotal.toFixed(2)}`;
    if (elFrete) elFrete.textContent = `R$ ${valorFreteAtual.toFixed(2)}`;
    if (elTotal) elTotal.textContent = `R$ ${total.toFixed(2)}`;
}

// =========================================================
// CÁLCULO DE FRETE (placeholder simples — ajuste a regra depois)
// =========================================================
window.calcularFrete = function () {
    const campoEndereco = document.getElementById('cep');
    const infoFrete = document.getElementById('info-frete');

    if (!campoEndereco || !campoEndereco.value.trim()) {
        Swal.fire({ icon: 'warning', title: 'Endereço vazio', text: 'Digite seu endereço para calcular a entrega.' });
        return;
    }

    // Taxa fixa de entrega: R$ 6,00
    valorFreteAtual = 6.00;
    document.getElementById('cart-frete').textContent = `R$ ${valorFreteAtual.toFixed(2)}`;
    if (infoFrete) infoFrete.textContent = `Entrega estimada: R$ ${valorFreteAtual.toFixed(2)}`;

    atualizarResumo();
};

// =========================================================
// FINALIZAR COMPRA → cria o pedido na API → mostra WhatsApp
// =========================================================
window.finalizarCompra = async function () {
    const itensCarrinho = obterCarrinho();

    if (!itensCarrinho || itensCarrinho.length === 0) {
        Swal.fire({ icon: 'warning', title: 'Carrinho vazio', text: 'Adicione algum item antes de finalizar o pedido.' });
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
        Swal.fire({ icon: 'error', title: 'Sessão expirada', text: 'Faça login novamente para finalizar o pedido.' });
        return;
    }

    // Lê a observação geral direto do campo de texto da tela
    const campoObservacao = document.getElementById('observacao-geral');
    const observacaoGeral = campoObservacao ? campoObservacao.value.trim() : '';

    const itensParaEnviar = itensCarrinho.map(item => ({
        produto_id: item.id,
        quantidade: item.quantidade || 1,
        preco_unitario: item.preco,
        observacao_item: item.observacao || ''
    }));

    try {
        const resposta = await fetch(`${API_URL}/api/pedidos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                observacao_geral: observacaoGeral || '',
                itens: itensParaEnviar
            })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível finalizar o pedido.');

        limparCarrinho();
        mostrarConfirmacaoWhatsapp(dados.pedido, itensCarrinho, observacaoGeral);

    } catch (erro) {
        Swal.fire({ icon: 'error', title: 'Erro ao finalizar pedido', text: erro.message });
    }
};

function mostrarConfirmacaoWhatsapp(pedido, itens, observacaoGeral) {
    const mensagem = montarMensagemWhatsapp(pedido, itens, observacaoGeral);
    const linkWhatsapp = `https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent(mensagem)}`;

    Swal.fire({
        icon: 'success',
        title: 'Pedido realizado!',
        html: `
            <p>Seu pedido <strong>#${pedido.id}</strong> foi recebido.</p>
            <p>Quer confirmar agora pelo WhatsApp da loja?</p>
        `,
        showCancelButton: true,
        confirmButtonText: 'Confirmar pelo WhatsApp',
        cancelButtonText: 'Agora não',
        confirmButtonColor: '#25D366'
    }).then((resultado) => {
        if (resultado.isConfirmed) {
            window.open(linkWhatsapp, '_blank');
        }
        window.location.href = './principal.html';
    });
}

function montarMensagemWhatsapp(pedido, itens, observacaoGeral) {
    let texto = `Olá! Gostaria de confirmar meu pedido #${pedido.id}:\n\n`;

    itens.forEach(item => {
        texto += `• ${item.quantidade}x ${item.nome}`;
        if (item.observacao) texto += ` (${item.observacao})`;
        texto += `\n`;
    });

    texto += `\nTotal: R$ ${Number(pedido.valor).toFixed(2)}`;

    if (observacaoGeral) {
        texto += `\nObservação: ${observacaoGeral}`;
    }

    return texto;
}

// =========================================================
// RENDERIZA O CARRINHO AUTOMATICAMENTE AO ABRIR A TELA
// =========================================================
document.addEventListener('DOMContentLoaded', renderizarCarrinho);