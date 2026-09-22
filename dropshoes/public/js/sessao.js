import { api, encerrarSessao } from './api.js';
const tipo = document.body.dataset.acesso || 'cliente';
const entrada = tipo === 'admin' ? '/login' : '/login-cliente';
document.querySelectorAll('[data-sair]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); encerrarSessao(); window.location.assign(entrada);
}));
export const sessaoPronta = (async () => {
  if (!localStorage.getItem('token')) { window.location.assign(entrada); return null; }
  try {
    const { perfil } = await api('/api/meu-perfil');
    const admin = ['admin1', 'admin2'].includes(perfil.role);
    if ((tipo === 'admin') !== admin) { window.location.assign(entrada); return null; }
    localStorage.setItem('role', perfil.role);
    localStorage.setItem('nomeUsuario', perfil.nome);
    document.querySelectorAll('[data-caixa]').forEach(link => { link.hidden = perfil.role !== 'admin1'; });
    if (document.body.dataset.caixa !== undefined && perfil.role !== 'admin1') {
      window.location.assign('/admin/principal'); return null;
    }
    return perfil;
  } catch (erro) {
    if (erro.status !== 401) {
      const aviso = document.createElement('p'); aviso.setAttribute('role', 'alert');
      aviso.textContent = erro.message; document.querySelector('main')?.prepend(aviso);
    }
    return null;
  }
})();
