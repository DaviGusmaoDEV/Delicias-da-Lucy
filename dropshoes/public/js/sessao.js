import { api, encerrarSessao } from './api.js';
const administracao = document.body.dataset.acesso === 'admin';
const catalogo = '../tela cliente/Produtos.html';
const entradaAdmin = '../tela de login/login.html';
function visitante() {
  localStorage.setItem('role', 'visitante');
  localStorage.removeItem('nomeUsuario');
  document.querySelectorAll('[data-sair]').forEach(link => { link.hidden = true; });
  return { role: 'visitante', visitanteNovo: true };
}
async function limparCookies() {
  // Preserva os produtos do carrinho ao continuar como visitante.
  await api('/api/logout', { method: 'POST' });
}
document.querySelectorAll('[data-sair]').forEach(link => link.addEventListener('click', async event => {
  event.preventDefault();
  await encerrarSessao();
  window.location.assign(administracao ? entradaAdmin : catalogo);
}));
export const sessaoPronta = (async () => {
  localStorage.removeItem('token');
  try {
    const { perfil } = await api('/api/meu-perfil');
    const admin = ['admin1', 'admin2'].includes(perfil.role);
    if (administracao && !admin) { window.location.assign(entradaAdmin); return null; }
    if (!administracao && admin) {
      // Uma sessão administrativa anterior não pode impedir a compra sem conta.
      await limparCookies();
      return visitante();
    }
    localStorage.setItem('role', perfil.role);
    localStorage.setItem('nomeUsuario', perfil.nome);
    document.querySelectorAll('[data-caixa]').forEach(link => { link.hidden = perfil.role !== 'admin1'; });
    if (administracao && document.body.dataset.caixa !== undefined && perfil.role !== 'admin1') {
      window.location.assign('../tela admin/principal.html'); return null;
    }
    return perfil;
  } catch (erro) {
    if (!administracao && erro.status === 401) {
      try { await limparCookies(); } catch { /* O servidor continuará validando cada operação. */ }
      return visitante();
    }
    if (erro.status !== 401) {
      const aviso = document.createElement('p'); aviso.setAttribute('role', 'alert');
      aviso.textContent = erro.message; document.querySelector('main')?.prepend(aviso);
    }
    // Falha na consulta da sessão não fecha o catálogo público.
    return administracao ? null : visitante();
  }
})();
