import Swal from 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';

// Defina a URL base. Use o link do seu Render que você copiou do painel.
const API_URL = 'https://delicias-da-lucy.onrender.com'; 

document.addEventListener("DOMContentLoaded", () => {
    const formLogin = document.getElementById("form-login");
    if (formLogin) {
        formLogin.addEventListener("submit", async (e) => {
            e.preventDefault();
            const identificador = document.getElementById("nome-usuario").value; 
            const senha = document.getElementById("senha").value;
            await realizarLogin(identificador, senha);
        });
    }
});

export async function realizarLogin(identificador, senha) {
    try {
        // Agora apontando para o seu serviço no Render
        const resposta = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador, senha })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || "Falha na autenticação.");

        // Guardando dados com segurança
        localStorage.setItem('token', dados.token);
        localStorage.setItem('role', dados.role);
        localStorage.setItem('nomeUsuario', dados.nome);
        
        // Redirecionamento baseado na role
        const destino = dados.role.includes('admin') ? '../tela admin/Meu Perfil.html' : '../tela cliente/principal.html';
        window.location.href = destino;
        return true;
    } catch (erro) {
        Swal.fire({ 
            icon: 'error', 
            title: 'Erro de Login', 
            text: erro.message 
        });
        return false;
    }
}