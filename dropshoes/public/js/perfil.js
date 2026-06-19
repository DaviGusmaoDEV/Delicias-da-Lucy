import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

// URL do seu servidor
const API_URL = 'https://delicias-da-lucy.onrender.com';

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Verificação de autenticação
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '../login.html'; // Volta se não estiver logado
        return;
    }

    // 2. Busca dados do perfil no servidor (opcional: serve para validar se o token ainda é válido)
    try {
        const resposta = await fetch(`${API_URL}/api/meu-perfil`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!resposta.ok) {
            localStorage.clear();
            window.location.href = '../login.html';
            return;
        }
    } catch (e) {
        console.error("Erro ao validar perfil:", e);
    }

    // 3. Lógica de UI (Dados que já temos no localStorage)
    const nome = localStorage.getItem('nomeUsuario') || "Usuário";
    const role = localStorage.getItem('role');
    const tituloBoasVindas = document.getElementById('boas-vindas-usuario');

    if (tituloBoasVindas) tituloBoasVindas.textContent = `Olá, ${nome}`;

    // 4. Lógica de Acesso e Permissões
    if (role?.includes('admin')) {
        document.getElementById('painel-admin-donoloja').style.display = 'block';

        const ehGerente = role === 'admin2';
        
        // Bloqueio visual para Admin1
        if (!ehGerente) {
            const linkFluxo = document.querySelector('a[href="fluxo de caixa.html"]');
            if (linkFluxo) linkFluxo.style.display = 'none';
        }
    } else {
        document.getElementById('painel-cliente-pedidos').style.display = 'block';
    }

    // 5. Lógica do formulário de categoria
    const formCategoria = document.getElementById("form-nova-categoria");
    formCategoria?.addEventListener("submit", (e) => {
        e.preventDefault();
        const categoria = document.getElementById("nome-categoria").value;
        // Aqui você integraria com a API se tiver uma rota de categorias
        Swal.fire({ icon: 'success', title: 'Sucesso!', text: `Categoria "${categoria}" adicionada.` });
        formCategoria.reset();
    });
});