const role = localStorage.getItem('role');
const tipo = document.body.dataset.acesso || 'cliente';
if (!localStorage.getItem('token')) window.location.assign(tipo === 'admin' ? '../tela de login/login.html' : '../tela de login/login cliente.html');
if (tipo === 'admin' && !['admin1', 'admin2'].includes(role)) window.location.assign('../tela de login/login.html');
if (tipo === 'cliente' && role !== 'cliente') window.location.assign('../tela de login/login cliente.html');
document.querySelectorAll('[data-sair]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); localStorage.clear(); window.location.assign('../tela de login/login cliente.html'); }));
if (role === 'admin2') document.querySelectorAll('[data-caixa]').forEach(link => link.hidden = true);
