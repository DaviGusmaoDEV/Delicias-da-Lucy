import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';
import { obterCarrinho, limparCarrinho } from './carrinho.js';

const API_URL = 'https://delicias-da-lucy.onrender.com';

// Número de WhatsApp da loja (apenas números, com DDI 55 + DDD, sem espaços/símbolos)
// Exemplo: para (16) 99999-9999 → '5516999999999'
const WHATSAPP_LOJA = '16996200385';

document.addEventListener('DOMContentLoaded', () => {
    const botaoFinalizar = document.getElementById('btn-finalizar-pedido');
    if (botaoFinalizar) {
        botaoFinalizar.addEventListener('click', finalizarPedido);
    }
});

async function finalizarPedido() {
    const itensCarrinho = obterCarrinho();

    if (!itensCarrinho || itensCarrinho.length === 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Carrinho vazio',
            text: 'Adicione algum item antes de finalizar o pedido.'
        });
        return;
    }

    const campoObservacao = document.getElementById('observacao-geral');
    const observacaoGeral = campoObservacao ? campoObservacao.value.trim() : '';

    // Monta o array de itens no formato que a API espera
    const itensParaEnviar = itensCarrinho.map(item => ({
        produto_id: item.id,
        quantidade: item.quantidade || 1,
        preco_unitario: item.preco,
        observacao_item: item.observacao || ''
    }));

    const token = localStorage.getItem('token');
    if (!token) {
        Swal.fire({
            icon: 'error',
            title: 'Sessão expirada',
            text: 'Faça login novamente para finalizar o pedido.'
        });
        return;
    }

    try {
        const resposta = await fetch(`${API_URL}/api/pedidos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                observacao_geral: observacaoGeral,
                itens: itensParaEnviar
            })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível finalizar o pedido.');

        // Pedido criado com sucesso: limpa o carrinho e mostra a confirmação
        limparCarrinho();
        mostrarConfirmacaoWhatsapp(dados.pedido, itensCarrinho, observacaoGeral);

    } catch (erro) {
        Swal.fire({
            icon: 'error',
            title: 'Erro ao finalizar pedido',
            text: erro.message
        });
    }
}

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
        // Redireciona o cliente para a tela de pedidos/perfil dele
        window.location.href = '../tela cliente/principal.html';
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