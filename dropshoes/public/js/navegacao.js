document.documentElement.classList.add('nav-enhanced');

const LARGURA_MENU = '(max-width: 1023px)';

function iniciarNavegacao(sidebar) {
  const botao = sidebar.querySelector('[data-menu-toggle]');
  const consulta = window.matchMedia(LARGURA_MENU);
  if (!botao) return;

  const rotulo = botao.querySelector('[data-menu-label]');
  const itensFocaveis = () => [...sidebar.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(item => !item.hidden && item.getClientRects().length > 0);

  function fechar({ devolverFoco = false } = {}) {
    delete sidebar.dataset.navOpen;
    botao.setAttribute('aria-expanded', 'false');
    botao.setAttribute('aria-label', 'Abrir menu principal');
    if (rotulo) rotulo.textContent = 'Menu';
    document.body.classList.remove('nav-open');
    if (devolverFoco) botao.focus();
  }

  function abrir() {
    if (!consulta.matches) return;
    sidebar.dataset.navOpen = 'true';
    botao.setAttribute('aria-expanded', 'true');
    botao.setAttribute('aria-label', 'Fechar menu principal');
    if (rotulo) rotulo.textContent = 'Fechar';
    document.body.classList.add('nav-open');
    requestAnimationFrame(() => sidebar.querySelector('.sidebar-nav a')?.focus());
  }

  botao.hidden = false;
  botao.addEventListener('click', () => sidebar.dataset.navOpen === 'true' ? fechar() : abrir());
  sidebar.querySelectorAll('.sidebar-nav a, .sidebar-footer a').forEach(link => {
    link.addEventListener('click', () => { if (consulta.matches) fechar(); });
  });
  sidebar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.dataset.navOpen === 'true') {
      event.preventDefault();
      fechar({ devolverFoco: true });
      return;
    }
    if (event.key !== 'Tab' || sidebar.dataset.navOpen !== 'true' || !consulta.matches) return;
    const focaveis = itensFocaveis();
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (event.shiftKey && document.activeElement === primeiro) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && document.activeElement === ultimo) {
      event.preventDefault();
      primeiro.focus();
    }
  });
  consulta.addEventListener('change', () => fechar());
  sidebar.querySelectorAll('.material-symbols-outlined').forEach(icone => icone.setAttribute('aria-hidden', 'true'));
}

document.querySelectorAll('.sidebar').forEach(iniciarNavegacao);
