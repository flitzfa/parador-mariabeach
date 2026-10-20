/*
  FOTOS ADMINISTRABLES
  Reemplaza la galería «Postales» y las fotos de las secciones destacadas con lo
  que Pao publica desde /admin/. Si el servicio no responde, la página conserva
  las fotos estáticas del HTML (no se duplican ni se mezclan).
*/
(() => {
  const root = document.documentElement;
  const gallerySection = document.querySelector('[data-gallery-section]');
  const journey = document.querySelector('[data-gallery]');
  const slotImages = document.querySelectorAll('img[data-photo-slot]');
  if (!('fetch' in window) || !journey) return;

  const isSafeSrc = (src) => typeof src === 'string' && (/^\/assets\/media\/[a-z0-9-]+\.(jpe?g|png|webp)$/.test(src) || /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/storage\/v1\/object\/public\/site-photos\/uploads\/[0-9a-z/-]+\.(jpg|png|webp)$/i.test(src));
  const isValidPhoto = (photo) => photo && isSafeSrc(photo.src) && (!photo.srcSmall || isSafeSrc(photo.srcSmall)) && photo.width > 0 && photo.height > 0;

  const applyImage = (img, photo, sizes) => {
    img.removeAttribute('srcset');
    if (photo.srcSmall) {
      img.srcset = `${photo.srcSmall} ${photo.widthSmall}w, ${photo.src} ${photo.width}w`;
      img.sizes = sizes;
    }
    img.src = photo.src;
    img.alt = photo.alt || 'Foto de María Beach';
    img.width = photo.width;
    img.height = photo.height;
  };

  const applySlots = (slots) => {
    slotImages.forEach((img) => {
      const photo = slots[img.dataset.photoSlot];
      if (!isValidPhoto(photo)) return; // sin dato válido: queda la foto original
      if (img.getAttribute('src') === photo.src) return;
      applyImage(img, photo, img.dataset.sizes || '(max-width: 780px) 100vw, 45vw');
    });
  };

  // Ritmo editorial: par · foto amplia · par · par · amplia…
  // Repite las mismas posiciones de la galería original (5 fotos = mismo diseño).
  const PAIRS = [
    ['gallery-photo--river', 'gallery-photo--parador'],
    ['gallery-photo--hammock', 'gallery-photo--night'],
  ];
  const buildRows = (photos) => {
    const rows = [];
    const pattern = ['pair', 'wide', 'pair'];
    let index = 0;
    let step = 0;
    let pairCount = 0;
    while (index < photos.length) {
      const remaining = photos.length - index;
      let type = pattern[step % pattern.length];
      if (type === 'pair' && remaining === 1) type = 'wide';
      if (type === 'wide' && remaining === 2) type = 'pair';
      if (type === 'pair') {
        const classes = PAIRS[pairCount % PAIRS.length];
        rows.push([
          { photo: photos[index], className: classes[0] },
          { photo: photos[index + 1], className: classes[1] },
        ]);
        index += 2;
        pairCount += 1;
      } else {
        rows.push([{ photo: photos[index], className: 'gallery-photo--people' }]);
        index += 1;
      }
      step += 1;
    }
    return rows;
  };

  const revealObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 })
    : null;

  // Con muchas fotos, la galería no se alarga: las primeras forman el recorrido
  // editorial y el resto va a un carrusel horizontal «Más postales».
  const FEATURED = 5;
  const RAIL_FROM = 8; // con 7 o menos, todas van al recorrido (sin carrusel casi vacío)

  const buildRail = (photos) => {
    const wrap = document.createElement('div');
    wrap.className = 'gallery-more reveal';
    wrap.setAttribute('data-gallery-more', '');

    const head = document.createElement('div');
    head.className = 'gallery-more__head';
    const title = document.createElement('p');
    title.className = 'gallery-more__title';
    title.id = 'gallery-more-title';
    title.textContent = 'Más postales';
    const count = document.createElement('span');
    count.className = 'gallery-more__count';
    count.textContent = `${photos.length} fotos`;
    title.append(' ', count);

    const controls = document.createElement('div');
    controls.className = 'gallery-more__controls';
    const makeButton = (dir, label, symbol) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gallery-more__btn';
      button.dataset.dir = dir;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', 'gallery-rail');
      button.innerHTML = `<span aria-hidden="true">${symbol}</span>`;
      return button;
    };
    const prev = makeButton('-1', 'Ver postales anteriores', '←');
    const next = makeButton('1', 'Ver más postales', '→');
    controls.append(prev, next);
    head.append(title, controls);

    const rail = document.createElement('ul');
    rail.className = 'gallery-rail';
    rail.id = 'gallery-rail';
    rail.tabIndex = 0;
    rail.setAttribute('aria-labelledby', 'gallery-more-title');
    photos.forEach((photo, index) => {
      const item = document.createElement('li');
      item.className = 'gallery-rail__item';
      item.style.setProperty('--ratio', `${photo.width} / ${photo.height}`);
      const figure = document.createElement('figure');
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      applyImage(img, photo, '(max-width: 780px) 70vw, 340px');
      img.alt = photo.alt || `Postal ${index + FEATURED + 1} de María Beach`;
      figure.append(img);
      item.append(figure);
      rail.append(item);
    });

    const update = () => {
      const max = rail.scrollWidth - rail.clientWidth - 2;
      prev.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft >= max;
      controls.hidden = max <= 0;
      rail.tabIndex = max > 0 ? 0 : -1; // solo enfocable si hay algo para desplazar
    };
    const step = () => Math.max(rail.clientWidth * 0.8, 240);
    [prev, next].forEach((button) => button.addEventListener('click', () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollBy({ left: Number(button.dataset.dir) * step(), behavior: reduce ? 'auto' : 'smooth' });
    }));
    rail.addEventListener('scroll', () => window.requestAnimationFrame(update), { passive: true });
    window.addEventListener('resize', update, { passive: true });
    rail.querySelectorAll('img').forEach((img) => img.addEventListener('load', update, { once: true }));
    setTimeout(update, 0);

    wrap.append(head, rail);
    if (revealObserver) revealObserver.observe(wrap);
    else wrap.classList.add('is-visible');
    return wrap;
  };

  const renderGallery = (photos) => {
    const valid = photos.filter(isValidPhoto);
    const oldRail = gallerySection.querySelector('[data-gallery-more]');
    if (oldRail) oldRail.remove();
    if (valid.length === 0) {
      gallerySection.hidden = true;
      journey.replaceChildren();
      return;
    }
    gallerySection.hidden = false;
    const useRail = valid.length >= RAIL_FROM;
    const featured = useRail ? valid.slice(0, FEATURED) : valid;
    const fragment = document.createDocumentFragment();
    buildRows(featured).forEach((row, rowIndex) => {
      row.forEach(({ photo, className }) => {
        const figure = document.createElement('figure');
        const landscape = photo.width > photo.height;
        figure.className = `gallery-photo ${className} ${landscape ? 'is-landscape' : 'is-portrait'} reveal`;
        figure.style.gridRow = String(rowIndex + 1);
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        const wide = className === 'gallery-photo--people';
        applyImage(img, photo, wide ? '(max-width: 780px) 100vw, 60vw' : '(max-width: 780px) 90vw, 36vw');
        figure.append(img);
        fragment.append(figure);
        if (revealObserver) revealObserver.observe(figure);
        else figure.classList.add('is-visible');
      });
    });
    journey.replaceChildren(fragment);
    journey.dataset.count = String(featured.length);
    if (useRail) journey.after(buildRail(valid.slice(FEATURED)));
  };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;

  fetch('/api/site-photos', { signal: controller ? controller.signal : undefined, headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((data) => {
      if (!data || data.ok !== true || !Array.isArray(data.gallery)) throw new Error('datos inválidos');
      applySlots(data.slots && typeof data.slots === 'object' ? data.slots : {});
      renderGallery(data.gallery);
      root.dataset.photos = 'live';
    })
    .catch(() => {
      root.dataset.photos = 'static';
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
})();
