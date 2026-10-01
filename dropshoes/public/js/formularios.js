export function mensagem(form, texto, sucesso = false) {
    if (!form) return;
    let aviso = form.querySelector('[data-mensagem]');
    if (!aviso) {
        aviso = document.createElement('p');
        aviso.dataset.mensagem = '';
        form.querySelector('button[type="submit"]').before(aviso);
    }
    aviso.id = aviso.id || `${form.id || 'form'}-mensagem`;
    aviso.setAttribute('role', sucesso ? 'status' : 'alert');
    aviso.setAttribute('aria-live', sucesso ? 'polite' : 'assertive');
    aviso.setAttribute('aria-atomic', 'true');
    aviso.textContent = texto;
    aviso.style.color = sucesso ? '#166534' : '#b91c1c';
}

export async function enviarFormulario(form, url, valores) {
    const botao = form?.querySelector('button[type="submit"]');
    const texto = botao?.textContent;
    if (form) { form.dataset.enviando = 'true'; form.setAttribute('aria-busy', 'true'); }
    if (botao) { botao.disabled = true; botao.textContent = botao.dataset.loadingLabel || 'Aguarde…'; }
    mensagem(form, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const resposta = await fetch(url, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie' },
            body: JSON.stringify(valores), signal: controller.signal
        });
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível concluir. Tente novamente.');
        return dados;
    } catch (erro) {
        if (erro.name === 'AbortError' || erro instanceof TypeError) {
            throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
        }
        throw erro;
    } finally {
        clearTimeout(timeout);
        if (form) { delete form.dataset.enviando; form.removeAttribute('aria-busy'); }
        if (botao) { botao.disabled = false; botao.textContent = texto; }
    }
}
