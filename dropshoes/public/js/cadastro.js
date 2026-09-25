import { mensagem, enviarFormulario } from './formularios.js';
const form = document.getElementById('form-cadastro-cliente');
form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity() || form.dataset.enviando) return;
    await realizarCadastro({ nome: form.elements.nome.value.trim(), identificador: form.elements.identificador.value.trim(), senha: form.elements.senha.value, cep: form.elements.cep.value.trim() });
});
export async function realizarCadastro(cliente) {
    try {
        const dados = await enviarFormulario(form, '/api/cadastro', cliente);
        if (dados.usuario?.role !== 'cliente') throw new Error('Não foi possível criar sua conta.');
        sessionStorage.setItem('cadastroRealizado', cliente.identificador);
        window.location.assign('../tela cliente/Produtos.html');
        return true;
    } catch (erro) { mensagem(form, erro.message); return false; }
}
