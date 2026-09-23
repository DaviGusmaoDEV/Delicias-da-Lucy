import { mensagem, enviarFormulario } from './formularios.js';

const form = document.getElementById('form-cadastro-cliente');
form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.enviando) return;
    if (form.elements.senha.value !== form.elements.confirmarSenha.value) {
        mensagem(form, 'As senhas não coincidem.');
        form.elements.confirmarSenha.focus();
        return;
    }
    await realizarCadastro({
        nome: form.elements.nome.value.trim(),
        email: form.elements.email.value.trim().toLowerCase(),
        telefone: form.elements.telefone.value.trim(),
        senha: form.elements.senha.value
    });
});

export async function realizarCadastro(cliente) {
    try {
        await enviarFormulario(form, '/api/cadastro', cliente);
        sessionStorage.setItem('cadastroRealizado', cliente.email);
        window.location.assign('../tela de login/login cliente.html');
        return true;
    } catch (erro) {
        mensagem(form, erro.message);
        return false;
    }
}
