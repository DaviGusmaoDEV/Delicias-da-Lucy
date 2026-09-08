const API_URL = 'https://delicias-da-lucy.onrender.com';

document.addEventListener("DOMContentLoaded", () => {
    const formLogin = document.getElementById("form-login");
    if (formLogin) {
        formLogin.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            // Compatibilidade com inputs que usem 'email' ou 'nome' (identificador)
            const inputIdentificador = document.getElementById("email") || document.getElementById("nome");
            const identificador = inputIdentificador ? inputIdentificador.value.trim() : "";
            const senha = document.getElementById("senha").value.trim();

            await realizarLogin(identificador, senha);
        });
    }
});

export async function realizarLogin(identificador, senha) {
    try {
        const resposta = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identificador, senha })
        });

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || dados.mensagem || "Falha na autenticação.");

        // Compatibilidade com estruturas de retorno do Supabase (JWT / metadados)
        const token = dados.token || dados.session?.access_token;
        const role = dados.role || dados.user?.app_metadata?.role || dados.user?.user_metadata?.role || 'cliente';
        const nome = dados.nome || dados.user?.user_metadata?.nome || identificador;

        if (!token) throw new Error("Token de acesso não retornado pelo servidor.");

        // Salvando credenciais de sessão
        localStorage.setItem('token', token);
        localStorage.setItem('role', role);
        localStorage.setItem('nomeUsuario', nome);

        // Diferenciação e Redirecionamento por cargo (Admin vs Cliente)
        const cargoFormatado = role.toLowerCase();
        const destino = cargoFormatado.includes('admin') || cargoFormatado.includes('gerente')
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