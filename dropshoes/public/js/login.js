import { mensagem, enviarFormulario } from './formularios.js';

const form = document.getElementById('form-login');
const emailCadastrado = sessionStorage.getItem('cadastroRealizado');
if (form && emailCadastrado && form.dataset.acesso !== 'admin') {
    form.querySelector('#email').value = emailCadastrado;
    mensagem(form, 'Cadastro realizado! Entre com seu e-mail e senha.', true);
    sessionStorage.removeItem('cadastroRealizado');
}
form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.enviando) return;
    await realizarLogin(form.querySelector('#email').value.trim(), form.querySelector('#senha').value);
});

export async function realizarLogin(identificador, senha) {
    try {
        const dados = await enviarFormulario(form, '/api/login', {
            identificador, senha, acesso: form?.dataset.acesso || 'cliente'
        });
        if (!dados.token || !['cliente', 'admin1', 'admin2'].includes(dados.role)) {
            throw new Error('Resposta de autenticação inválida. Tente novamente.');
        }
        localStorage.setItem('token', dados.token);
        localStorage.setItem('role', dados.role);
        localStorage.setItem('nomeUsuario', dados.nome);
        window.location.assign(dados.role === 'cliente' ? '/tela%20cliente/principal.html' : '/tela%20admin/principal.html');
        return true;
    } catch (erro) {
        mensagem(form, erro.message);
        return false;
    }
}
