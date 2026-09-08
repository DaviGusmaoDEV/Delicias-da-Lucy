import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

// Defina a URL base. Use o link do seu Render que você copiou do painel.
const API_URL = 'https://delicias-da-lucy.onrender.com';

document.addEventListener("DOMContentLoaded", () => {
    const formCadastro = document.getElementById("form-cadastro-cliente");
    if (formCadastro) {
        formCadastro.addEventListener("submit", async (e) => {
            e.preventDefault();

            const nome = document.getElementById("nome").value.trim();
            const email = document.getElementById("email").value.trim();
            const telefone = document.getElementById("telefoneCliente").value.trim();
            const senha = document.getElementById("senha").value;

            // Validação simples antes de enviar
            if (!nome || !senha) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Campos obrigatórios',
                    text: 'Preencha ao menos Nome e Senha para continuar.'
                });
                return;
            }

            await realizarCadastro({ nome, email, telefone, senha });
        });
    }
});

export async function realizarCadastro({ nome, email, telefone, senha }) {
    try {
        // Ajuste a rota '/api/cadastro' abaixo caso seu server.js use outro nome
        // (ex: '/api/register', '/api/clientes')
        const resposta = await fetch(`${API_URL}/api/cadastro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome, email, telefone, senha })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || "Falha ao realizar cadastro.");

        await Swal.fire({
            icon: 'success',
            title: 'Cadastro realizado!',
            text: 'Sua conta foi criada com sucesso. Faça login para continuar.',
            confirmButtonText: 'Ir para o login'
        });

        // Redireciona para a tela de login do cliente após confirmar
        window.location.href = './login cliente.html';
        return true;
    } catch (erro) {
        Swal.fire({
            icon: 'error',
            title: 'Erro no Cadastro',
            text: erro.message
        });
        return false;
    }
}