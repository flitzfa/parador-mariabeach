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
document.querySelector('[data-year]').textContent = new Date().getFullYear();

const header = document.querySelector('[data-header]');
const button = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

const closeMenu = () => {
  button.setAttribute('aria-expanded', 'false');
  mobileMenu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
};
button.addEventListener('click', () => {
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  mobileMenu.classList.toggle('is-open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
});
mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

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
