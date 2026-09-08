// Defina a URL base. Use o link do seu Render que você copiou do painel.
const API_URL = 'https://delicias-da-lucy.onrender.com';

document.addEventListener("DOMContentLoaded", () => {
    const formLogin = document.getElementById("form-login");
    if (formLogin) {
        formLogin.addEventListener("submit", async (e) => {
            e.preventDefault();
            const identificador = document.getElementById("nome-usuario").value.trim();
            const senha = document.getElementById("senha").value.trim();
            await realizarLogin(identificador, senha);
        });
    }
});

async function realizarLogin(identificador, senha) {
    try {
        const resposta = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador, senha })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || dados.mensagem || "Falha na autenticação.");

        const token = dados.token || dados.session?.access_token;
        const role = dados.role || dados.user?.app_metadata?.role || dados.user?.user_metadata?.role || 'cliente';
        const nome = dados.nome || dados.user?.user_metadata?.nome || identificador;

        if (!token) throw new Error("Token de acesso não retornado pelo servidor.");

        localStorage.setItem('token', token);
        localStorage.setItem('role', role);
        localStorage.setItem('nomeUsuario', nome);

        const destino = role.toLowerCase().includes('admin')
            ? '../tela admin/Meu Perfil.html'
            : '../tela cliente/principal.html';
            
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