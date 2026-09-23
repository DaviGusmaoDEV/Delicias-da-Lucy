export function encerrarSessao() {
  for (const chave of ['token', 'role', 'nomeUsuario', 'carrinho']) localStorage.removeItem(chave);
}

export async function api(url, opcoes = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const resposta = await fetch(url, {
      ...opcoes, signal: controller.signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, ...(opcoes.headers || {}) }
    });
    const dados = resposta.status === 204 ? null : await resposta.json().catch(() => null);
    if (!resposta.ok) {
      if (resposta.status === 401) {
        const destino = ['admin1', 'admin2'].includes(localStorage.getItem('role')) ? '../tela de login/login.html' : '../tela de login/login cliente.html';
        encerrarSessao(); window.location.assign(destino);
      }
      const erro = new Error(dados?.erro || 'Não foi possível concluir a operação. Tente novamente.');
      erro.status = resposta.status;
      throw erro;
    }
    return dados;
  } catch (erro) {
    if (erro.name === 'AbortError' || erro instanceof TypeError) throw new Error('Falha de conexão. Tente novamente em instantes.');
    throw erro;
  } finally { clearTimeout(timer); }
}

export const enviar = (url, method, body) => api(url, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
