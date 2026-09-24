import { mensagem, enviarFormulario } from './formularios.js';
const form = document.getElementById('form-cadastro-cliente');
form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.enviando) return;
    await realizarCadastro({ nome: form.elements.nome.value.trim(), telefone: form.elements.telefone.value.trim(), cep: form.elements.cep.value.trim() });
});
export async function realizarCadastro(cliente) {
    try {
        const dados = await enviarFormulario(form, '/api/cadastro-cliente', cliente);
        if (dados.perfil?.role !== 'visitante') throw new Error('Não foi possível confirmar seus dados.');
        localStorage.removeItem('token');
        window.location.assign('../tela cliente/carrino cliente.html');
        return true;
    } catch (erro) { mensagem(form, erro.message); return false; }
}
