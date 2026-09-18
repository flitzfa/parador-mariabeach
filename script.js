const content = window.MARIA_BEACH;

document.querySelectorAll('[data-instagram]').forEach((link) => {
  link.href = content.instagram;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});
document.querySelectorAll('[data-whatsapp]').forEach((link) => {
  link.href = content.whatsapp;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});
document.querySelectorAll('[data-maps]').forEach((link) => {
  link.href = content.maps;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});

const agendaIntro = document.querySelector('[data-agenda-intro]');
const agendaList = document.querySelector('[data-agenda-list]');
const events = Array.isArray(content.events) ? content.events : [];

if (events.length === 0) {
  agendaIntro.textContent = 'Todavía no hay eventos confirmados. Seguinos en Instagram para enterarte de próximas fechas.';
  agendaList.hidden = true;
} else {
  agendaIntro.textContent = 'Eventos confirmados en María Beach.';
  events.forEach((event) => {
    const item = document.createElement('article');
    item.className = 'agenda-event';

    const date = document.createElement('span');
    date.className = 'agenda-event__date';
    date.textContent = event.date;

    const details = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = event.title;
    details.append(title);
    if (event.time) {
      const time = document.createElement('span');
      time.textContent = event.time;
      details.append(time);
    }

    const link = document.createElement('a');
    link.href = event.url || content.instagram;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Ver más ↗';

    item.append(date, details, link);
    agendaList.append(item);
  });
}
document.querySelector('[data-year]').textContent = new Date().getFullYear();

const header = document.querySelector('[data-header]');
const button = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

const setMenuState = (isOpen) => {
  button.setAttribute('aria-expanded', String(isOpen));
  button.querySelector('.sr-only').textContent = isOpen ? 'Cerrar menú' : 'Abrir menú';
  mobileMenu.classList.toggle('is-open', isOpen);
  document.body.classList.toggle('menu-open', isOpen);
};

const closeMenu = () => {
  setMenuState(false);
};
button.addEventListener('click', () => {
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  setMenuState(!isOpen);
});
mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    button.focus();
  }
});

const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 28);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
