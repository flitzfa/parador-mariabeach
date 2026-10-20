/*
  Panel de fotos · María Beach
  - Autenticación: Supabase Auth (correo + contraseña). Sin registro público.
  - Autorización: la base de datos (RLS + public.site_admins) decide qué se puede hacer.
    Este archivo solo muestra u oculta botones para que sea cómodo; no es la seguridad.
*/
(() => {
  'use strict';

  const BUCKET = 'site-photos';
  const MAX_INPUT_BYTES = 30 * 1024 * 1024; // lo que se acepta del teléfono
  const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // límite del bucket
  const MIN_EDGE = 500; // más chica se vería borrosa en la web
  const MAIN_EDGE = 1600; // lado mayor de la foto publicada
  const THUMB_EDGE = 800; // versión liviana para celulares
  const CONCURRENCY = 2;
  const FEATURED = 5; // fotos del recorrido grande de «Postales»
  const RAIL_FROM = 8; // desde esta cantidad, el resto pasa al carrusel

  const SLOTS = [
    { id: 'parador', label: 'El parador', where: 'Junto a «Un rincón para volver a respirar».', ratio: '3 / 4' },
    { id: 'dia', label: 'Día', where: '«Todo empieza junto al agua».', ratio: '3 / 4' },
    { id: 'atardecer', label: 'Atardecer', where: '«Cuando el cielo marca el ritmo».', ratio: '3 / 4' },
    { id: 'noche', label: 'Noche', where: '«La música sigue cerca».', ratio: '3 / 4' },
    { id: 'cantina-principal', label: 'Cantina · foto grande', where: 'La foto alta de «Para acompañar la orilla».', ratio: '3 / 4' },
    { id: 'cantina-acento-1', label: 'Cantina · foto chica de arriba', where: 'Se recorta apaisada.', ratio: '4 / 3' },
    { id: 'cantina-acento-2', label: 'Cantina · foto chica de abajo', where: 'Se recorta casi cuadrada.', ratio: '4 / 5' },
  ];
  const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.id, s.label]));

  /** @type {any} */ let sb = null;
  let cfg = null;
  let photos = [];
  let slots = {};
  let uploadItems = [];
  let uploadDestination = 'gallery';
  let uploading = false;
  let pickerSlot = null;
  let editId = null;
  let toastTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- utilidades de interfaz ----------
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'style') el.setAttribute('style', value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    });
    children.flat().forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return el;
  };

  const showView = (name) => {
    $$('[data-view]').forEach((view) => { view.hidden = view.dataset.view !== name; });
    $$('[data-when="app"]').forEach((el) => { el.hidden = name !== 'app'; });
    const heading = $(`[data-view="${name}"] h1`);
    if (heading && name !== 'loading') {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };

  const toast = (message, isError = false) => {
    const box = $('[data-toast]');
    box.textContent = message;
    box.classList.toggle('is-error', isError);
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, isError ? 8000 : 5000);
  };

  const openDialog = (name) => {
    const dialog = $(`[data-dialog="${name}"]`);
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return dialog;
  };
  const closeDialog = (name) => {
    const dialog = $(`[data-dialog="${name}"]`);
    if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  };

  const confirmAction = ({ title, text, ok = 'Eliminar' }) => new Promise((resolve) => {
    const dialog = $('[data-dialog="confirm"]');
    $('[data-confirm-title]').textContent = title;
    $('[data-confirm-text]').textContent = text;
    $('[data-confirm-ok]').textContent = ok;
    dialog.returnValue = 'cancel';
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', onClose);
    openDialog('confirm');
  });

  const friendlyError = (error) => {
    const raw = `${(error && (error.message || error.error_description || error.msg)) || ''} ${(error && error.hint) || ''}`;
    const status = error && (error.status || error.statusCode);
    const code = error && error.code;
    if (/FOTO_EN_SECCION/.test(raw)) return 'Esta foto está en una sección de la web. Primero elegí otra foto para esa sección.';
    if (/FOTO_OCULTA/.test(raw)) return 'Esa foto está oculta. Publicala primero para usarla en una sección.';
    if (code === '23503' || /foreign key/i.test(raw)) return 'Esta foto está en una sección de la web. Primero elegí otra foto para esa sección.';
    if (code === '23514' || /check constraint/i.test(raw)) {
      if (/alt/i.test(raw)) return 'El texto de la foto tiene que tener entre 3 y 200 letras.';
      return 'Algún dato de la foto no es válido.';
    }
    if (status === 401 || status === 403 || code === '42501' || /row-level security|NO_AUTORIZADO|JWT|not authorized|Unauthorized/i.test(raw)) {
      return 'Tu sesión venció o no tiene permiso. Salí y volvé a entrar.';
    }
    if (status === 413 || /too large|exceeded the maximum/i.test(raw)) return 'La foto es demasiado pesada para subirla.';
    if (status === 429) return 'Hubo demasiados intentos seguidos. Esperá un minuto y probá otra vez.';
    if (status === 0 || /network|Failed to fetch|Load failed|NetworkError|timeout|aborted/i.test(raw)) {
      return 'Se cortó la conexión. Revisá el wifi o los datos y probá de nuevo.';
    }
    return 'Algo salió mal. Probá de nuevo en un rato.';
  };

  // ---------- datos ----------
  const publicUrl = (path) => `${cfg.url}/storage/v1/object/public/${BUCKET}/${path}`;
  const photoSrc = (photo, small = true) => {
    if (photo.static_path) return `/${photo.static_path}`;
    return publicUrl(small && photo.thumb_path ? photo.thumb_path : photo.storage_path);
  };
  const slotsOf = (photoId) => Object.entries(slots).filter(([, id]) => id === photoId).map(([slot]) => slot);
  const galleryPhotos = () => photos.filter((p) => p.show_in_gallery).sort((a, b) => a.sort_order - b.sort_order);
  const libraryPhotos = () => photos.filter((p) => !p.show_in_gallery);
  const nextSortOrder = () => photos.reduce((max, p) => Math.max(max, Number(p.sort_order) || 0), 0) + 1;

  const loadData = async () => {
    const [photosRes, slotsRes] = await Promise.all([
      sb.from('photos').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('photo_slots').select('slot,photo_id'),
    ]);
    if (photosRes.error) throw photosRes.error;
    if (slotsRes.error) throw slotsRes.error;
    photos = photosRes.data || [];
    slots = Object.fromEntries((slotsRes.data || []).map((row) => [row.slot, row.photo_id]));
    render();
  };

  const reloadQuietly = async () => {
    try { await loadData(); } catch (error) { toast(friendlyError(error), true); }
  };

  // ---------- render ----------
  const thumb = (photo, extra) => h('div', { class: 'thumb' },
    h('img', { src: photoSrc(photo), alt: '', loading: 'lazy', decoding: 'async' }),
    extra || null);

  const badgesFor = (photo, { showSlots = true } = {}) => {
    const list = h('ul', { class: 'badges', 'aria-label': 'Estado' });
    list.append(h('li', { class: `badge ${photo.is_published ? 'badge--live' : 'badge--hidden'}`, text: photo.is_published ? 'Publicada' : 'Oculta' }));
    if (photo.show_in_gallery) list.append(h('li', { class: 'badge', text: 'En Postales' }));
    if (showSlots) slotsOf(photo.id).forEach((slot) => list.append(h('li', { class: 'badge badge--slot', text: `Sección: ${SLOT_LABEL[slot]}` })));
    if (photo.static_path) list.append(h('li', { class: 'badge', text: 'Foto original de la web' }));
    return list;
  };

  const visibilityButton = (photo) => {
    const inSlot = slotsOf(photo.id).length > 0;
    if (photo.is_published) {
      return h('button', {
        class: 'btn btn--ghost', type: 'button',
        disabled: inSlot,
        title: inSlot ? 'Está en una sección: primero elegí otra foto para esa sección' : null,
        onclick: () => setPublished(photo, false),
      }, 'Ocultar');
    }
    return h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => setPublished(photo, true) }, 'Publicar');
  };

  const deleteButton = (photo) => {
    const inSlot = slotsOf(photo.id).length > 0;
    return h('button', {
      class: 'btn btn--ghost', type: 'button', disabled: inSlot,
      title: inSlot ? 'Está en una sección: primero elegí otra foto para esa sección' : null,
      onclick: () => deletePhoto(photo),
    }, 'Eliminar');
  };

  const slotNote = (photo) => (slotsOf(photo.id).length
    ? h('p', { class: 'note', text: 'Está en una sección: para ocultarla o eliminarla, primero elegí otra foto en «Secciones».' })
    : null);

  const renderPostales = () => {
    const list = $('[data-list="postales"]');
    const items = galleryPhotos();
    const published = items.filter((p) => p.is_published).length;
    const hidden = items.length - published;
    $('[data-summary="postales"]').textContent = items.length
      ? `${published} ${published === 1 ? 'publicada' : 'publicadas'}${hidden ? ` · ${hidden} ${hidden === 1 ? 'oculta' : 'ocultas'}` : ''}`
      : '';
    $('[data-empty="postales"]').hidden = items.length > 0;
    // Igual que photos-live.js: con 8 o más publicadas, desde la 6.ª van al carrusel.
    const publishedIds = items.filter((p) => p.is_published).map((p) => p.id);
    const railIds = new Set(publishedIds.length >= RAIL_FROM ? publishedIds.slice(FEATURED) : []);
    const where = $('[data-summary="postales-where"]');
    where.textContent = railIds.size
      ? `Las primeras ${FEATURED} forman el recorrido grande; las otras ${railIds.size} se ven en el carrusel «Más postales», que se desliza de costado.`
      : '';
    list.replaceChildren(...items.map((photo, index) => {
      const position = index + 1;
      const inRail = railIds.has(photo.id);
      return h('li', { class: `photo-card${photo.is_published ? '' : ' is-hidden'}${inRail ? ' is-rail' : ''}`, 'data-id': photo.id },
        thumb(photo, h('span', { class: 'order', 'aria-hidden': 'true', text: position })),
        h('div', { class: 'photo-info' },
          h('p', { class: 'photo-alt' }, h('span', { class: 'sr-only', text: `Foto ${position}: ` }), photo.alt_text),
          badgesFor(photo),
          inRail ? h('p', { class: 'note note--rail', text: 'Se ve en el carrusel «Más postales».' }) : null,
          slotNote(photo),
          h('div', { class: 'actions' },
            h('button', {
              class: 'icon-btn', type: 'button', 'aria-label': `Subir la foto ${position} un lugar`,
              disabled: index === 0, 'data-move': 'up', onclick: () => move(photo.id, -1),
            }, '↑'),
            h('button', {
              class: 'icon-btn', type: 'button', 'aria-label': `Bajar la foto ${position} un lugar`,
              disabled: index === items.length - 1, 'data-move': 'down', onclick: () => move(photo.id, 1),
            }, '↓'),
            visibilityButton(photo),
            h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => openEdit(photo.id) }, 'Editar'),
            deleteButton(photo))));
    }));
  };

  const renderBiblioteca = () => {
    const list = $('[data-list="biblioteca"]');
    const items = libraryPhotos();
    $('[data-empty="biblioteca"]').hidden = items.length > 0;
    list.replaceChildren(...items.map((photo) => h('li', { class: `photo-card${photo.is_published ? '' : ' is-hidden'}`, 'data-id': photo.id },
      thumb(photo),
      h('div', { class: 'photo-info' },
        h('p', { class: 'photo-alt', text: photo.alt_text }),
        badgesFor(photo),
        photo.description ? h('p', { class: 'note', text: photo.description }) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => addToGallery(photo) }, 'Sumar a Postales'),
          visibilityButton(photo),
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => openEdit(photo.id) }, 'Editar'),
          deleteButton(photo))))));
  };

  const renderSecciones = () => {
    const list = $('[data-list="secciones"]');
    list.replaceChildren(...SLOTS.map((slot) => {
      const photo = photos.find((p) => p.id === slots[slot.id]);
      return h('li', { class: 'slot-card', style: `--slot-ratio: ${slot.ratio}` },
        photo ? thumb(photo) : h('div', { class: 'thumb' }),
        h('div', { class: 'photo-info' },
          h('h2', { text: slot.label }),
          h('p', { class: 'note', text: slot.where }),
          h('p', { class: 'photo-alt', text: photo ? photo.alt_text : 'Usa la foto original de la web.' }),
          h('div', { class: 'actions' },
            h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openPicker(slot.id) }, 'Cambiar foto'))));
    }));
  };

  const renderPicker = () => {
    if (!pickerSlot) return;
    const slot = SLOTS.find((s) => s.id === pickerSlot);
    $('#picker-title').textContent = `Foto para «${slot.label}»`;
    $('[data-picker-hint]').textContent = `${slot.where} Tocá la foto que quieras usar. Solo aparecen fotos publicadas.`;
    const current = slots[pickerSlot];
    const options = photos.filter((p) => p.is_published);
    $('[data-picker-list]').replaceChildren(...options.map((photo) => h('li', {},
      h('button', {
        type: 'button',
        'aria-current': photo.id === current ? 'true' : null,
        'aria-label': `${photo.id === current ? 'Foto actual: ' : 'Usar: '}${photo.alt_text}`,
        onclick: () => chooseForSlot(photo),
      }, h('img', { src: photoSrc(photo), alt: '', loading: 'lazy' })))));
  };

  const render = () => {
    renderPostales();
    renderBiblioteca();
    renderSecciones();
    renderPicker();
  };

  // ---------- acciones ----------
  const move = async (id, delta) => {
    const items = galleryPhotos();
    const index = items.findIndex((p) => p.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    items.forEach((p, i) => { p.sort_order = i + 1; });
    render();
    const moved = $(`[data-list="postales"] [data-id="${id}"] [data-move="${delta < 0 ? 'up' : 'down'}"]`);
    const fallback = $(`[data-list="postales"] [data-id="${id}"] [data-move="${delta < 0 ? 'down' : 'up'}"]`);
    (moved && !moved.disabled ? moved : fallback)?.focus();
    const { error } = await sb.rpc('set_gallery_order', { photo_ids: items.map((p) => p.id) });
    if (error) {
      toast(`No se pudo guardar el orden. ${friendlyError(error)}`, true);
      await reloadQuietly();
    } else {
      toast(`Orden guardado: ahora es la foto ${target + 1}.`);
    }
  };

  const setPublished = async (photo, value) => {
    const { data, error } = await sb.from('photos').update({ is_published: value }).eq('id', photo.id).select('id');
    if (error || !data || data.length === 0) {
      toast(error ? friendlyError(error) : 'No se pudo guardar el cambio. Salí y volvé a entrar.', true);
    } else {
      toast(value ? 'Foto publicada. Puede tardar hasta un minuto en verse en la web.' : 'Foto oculta. Deja de verse en la web en hasta un minuto.');
    }
    await reloadQuietly();
  };

  const addToGallery = async (photo) => {
    const { data, error } = await sb.from('photos')
      .update({ show_in_gallery: true, sort_order: nextSortOrder() })
      .eq('id', photo.id).select('id');
    if (error || !data || data.length === 0) toast(error ? friendlyError(error) : 'No se pudo guardar el cambio.', true);
    else toast('Sumada al final de «Postales».');
    await reloadQuietly();
  };

  const deletePhoto = async (photo) => {
    const isStatic = Boolean(photo.static_path);
    const ok = await confirmAction({
      title: '¿Eliminar esta foto?',
      text: isStatic
        ? 'Es una de las fotos originales de la web: se quita del panel y de la web. Si más adelante la querés de vuelta, pedíselo a Fabri.'
        : 'Se borra de la web y del almacenamiento. No se puede deshacer.',
    });
    if (!ok) return;
    const { data, error } = await sb.from('photos').delete().eq('id', photo.id).select('id');
    if (error || !data || data.length === 0) {
      toast(error ? friendlyError(error) : 'No se pudo eliminar. Salí y volvé a entrar.', true);
      await reloadQuietly();
      return;
    }
    if (!isStatic) {
      const paths = [photo.storage_path, photo.thumb_path].filter(Boolean);
      const { error: storageError } = await sb.storage.from(BUCKET).remove(paths);
      if (storageError) console.warn('No se pudo borrar el archivo del almacenamiento', storageError);
    }
    toast('Foto eliminada.');
    await reloadQuietly();
  };

  const openEdit = (id) => {
    const photo = photos.find((p) => p.id === id);
    if (!photo) return;
    editId = id;
    const form = $('[data-form="edit"]');
    form.alt.value = photo.alt_text || '';
    form.description.value = photo.description || '';
    form.inGallery.checked = Boolean(photo.show_in_gallery);
    $('[data-error]', form).textContent = '';
    $('[data-edit-preview]').src = photoSrc(photo, false);
    openDialog('edit');
    form.alt.focus();
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const photo = photos.find((p) => p.id === editId);
    const errorBox = $('[data-error]', form);
    const alt = form.alt.value.trim().replace(/\s+/g, ' ');
    const description = form.description.value.trim();
    if (alt.length < 3) {
      errorBox.textContent = 'Contá en pocas palabras qué se ve en la foto (mínimo 3 letras).';
      form.alt.focus();
      return;
    }
    const changes = { alt_text: alt, description: description || null, show_in_gallery: form.inGallery.checked };
    if (changes.show_in_gallery && !photo.show_in_gallery) changes.sort_order = nextSortOrder();
    const submit = $('button[type=submit]', form);
    submit.disabled = true;
    const { data, error } = await sb.from('photos').update(changes).eq('id', editId).select('id');
    submit.disabled = false;
    if (error || !data || data.length === 0) {
      errorBox.textContent = error ? friendlyError(error) : 'No se pudo guardar. Salí y volvé a entrar.';
      return;
    }
    closeDialog('edit');
    toast('Cambios guardados.');
    await reloadQuietly();
  };

  const openPicker = (slotId) => {
    pickerSlot = slotId;
    renderPicker();
    openDialog('picker');
  };

  const chooseForSlot = async (photo) => {
    if (slots[pickerSlot] === photo.id) { closeDialog('picker'); return; }
    const slot = pickerSlot;
    const { error } = await sb.from('photo_slots').upsert({ slot, photo_id: photo.id }, { onConflict: 'slot' });
    if (error) {
      toast(friendlyError(error), true);
      return;
    }
    closeDialog('picker');
    toast(`Listo: «${SLOT_LABEL[slot]}» ya tiene la foto nueva. Puede tardar hasta un minuto en verse en la web.`);
    await reloadQuietly();
  };

  // ---------- subida de fotos ----------
  const randomId = () => {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const decodeImage = async (file) => {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) { /* probamos con <img> */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  };

  const encodeScaled = (source, width, height, edge, quality) => {
    const scale = Math.min(1, edge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const hgt = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffaf0'; // fondo crema si la imagen tiene transparencia
    ctx.fillRect(0, 0, w, hgt);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, hgt);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        canvas.width = 0; canvas.height = 0; // libera memoria en iPhone
        if (blob) resolve({ blob, width: w, height: hgt });
        else reject(new Error('encode'));
      }, 'image/jpeg', quality);
    });
  };

  // Redimensiona, corrige la orientación y quita metadatos (incluida la ubicación GPS).
  const processImage = async (file) => {
    let source;
    try {
      source = await decodeImage(file);
    } catch (_) {
      const err = new Error('No pudimos abrir esta foto. Si es del iPhone (formato HEIC), probá elegirla desde «Fotos» o exportarla como JPG.');
      err.userFacing = true;
      throw err;
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (Math.max(width, height) < MIN_EDGE) {
      const err = new Error(`Esta foto es muy chica (${width}×${height} px) y se vería borrosa. Elegí una de mejor calidad.`);
      err.userFacing = true;
      throw err;
    }
    let main = await encodeScaled(source, width, height, MAIN_EDGE, 0.84);
    if (main.blob.size > MAX_OUTPUT_BYTES) main = await encodeScaled(source, width, height, MAIN_EDGE, 0.7);
    const thumbImg = Math.max(width, height) > THUMB_EDGE ? await encodeScaled(source, width, height, THUMB_EDGE, 0.8) : null;
    if (typeof source.close === 'function') source.close();
    if (main.blob.size > MAX_OUTPUT_BYTES) {
      const err = new Error('Esta foto sigue siendo demasiado pesada después de achicarla.');
      err.userFacing = true;
      throw err;
    }
    return { main, thumb: thumbImg };
  };

  const putObject = (path, blob, token, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cfg.url}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', cfg.key);
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    xhr.timeout = 180000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = `upload ${xhr.status}`;
        let status = xhr.status;
        try {
          const body = JSON.parse(xhr.responseText);
          message = body.message || body.error || message;
          if (Number(body.statusCode)) status = Number(body.statusCode);
        } catch (_) { /* sin cuerpo JSON */ }
        reject(Object.assign(new Error(message), { status }));
      }
    };
    xhr.onerror = () => reject(Object.assign(new Error('network'), { status: 0 }));
    xhr.ontimeout = () => reject(Object.assign(new Error('timeout'), { status: 0 }));
    xhr.send(blob);
  });

  const setItemState = (item, status, message, progress) => {
    item.status = status;
    if (message !== undefined) item.message = message;
    if (progress !== undefined) item.progress = progress;
    const row = $(`[data-upload-id="${item.id}"]`);
    if (!row) return;
    const statusEl = $('.upload-status', row);
    statusEl.textContent = item.message || '';
    statusEl.className = `upload-status${status === 'error' || status === 'invalid' ? ' is-error' : ''}${status === 'done' ? ' is-done' : ''}`;
    const bar = $('.progress > span', row);
    if (bar) bar.style.width = `${Math.round((item.progress || 0) * 100)}%`;
    $('.progress', row).hidden = !['processing', 'uploading', 'saving', 'done'].includes(status);
    const retry = $('[data-retry]', row);
    retry.hidden = status !== 'error';
    retry.disabled = uploading;
    const remove = $('[data-remove]', row);
    remove.hidden = !['pending', 'invalid', 'error'].includes(status) || uploading;
    $('input[type=text]', row).disabled = !['pending', 'error'].includes(status) || uploading;
  };

  const uploadOne = async (item) => {
    const uploaded = [];
    try {
      setItemState(item, 'processing', 'Preparando la foto…', 0.03);
      const { main, thumb: small } = await processImage(item.file);
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw Object.assign(new Error('JWT'), { status: 401 });

      const now = new Date();
      const folder = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const id = randomId();
      const mainPath = `${folder}/${id}.jpg`;
      const thumbPath = small ? `${folder}/${id}-sm.jpg` : null;

      setItemState(item, 'uploading', 'Subiendo…', 0.08);
      await putObject(mainPath, main.blob, session.access_token, (p) => setItemState(item, 'uploading', `Subiendo… ${Math.round(8 + p * 77)}%`, 0.08 + p * 0.77));
      uploaded.push(mainPath);
      if (small) {
        await putObject(thumbPath, small.blob, session.access_token, (p) => setItemState(item, 'uploading', 'Subiendo versión liviana…', 0.85 + p * 0.1));
        uploaded.push(thumbPath);
      }

      setItemState(item, 'saving', 'Guardando…', 0.97);
      const alt = (item.alt || '').trim().replace(/\s+/g, ' ');
      const { error } = await sb.from('photos').insert({
        storage_path: mainPath,
        thumb_path: thumbPath,
        width: main.width,
        height: main.height,
        alt_text: alt.length >= 3 ? alt.slice(0, 200) : 'Foto de María Beach',
        is_published: true,
        show_in_gallery: uploadDestination === 'gallery',
        sort_order: Date.now(),
      });
      if (error) throw error;
      setItemState(item, 'done', uploadDestination === 'gallery' ? '✓ Publicada en «Postales»' : '✓ Guardada en la biblioteca', 1);
    } catch (error) {
      if (uploaded.length) {
        // Si no se pudo registrar, no dejamos archivos sueltos en el almacenamiento.
        await sb.storage.from(BUCKET).remove(uploaded).catch(() => {});
      }
      console.warn('No se pudo subir', item.file.name, error && error.message);
      setItemState(item, 'error', error && error.userFacing ? error.message : friendlyError(error), 0);
      if (error && error.userFacing) item.status = 'invalid';
      setItemState(item, item.status);
    }
  };

  const validateFile = (file) => {
    const okType = /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || (!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
    if (!okType) return 'Este archivo no es una foto compatible. Usá JPG, PNG o WebP.';
    if (file.size > MAX_INPUT_BYTES) return `Pesa ${(file.size / 1048576).toFixed(0)} MB. El máximo es 30 MB por foto.`;
    if (file.size === 0) return 'El archivo está vacío.';
    return null;
  };

  const renderUploadList = () => {
    const list = $('[data-upload-list]');
    list.replaceChildren(...uploadItems.map((item, index) => {
      const preview = h('img', { src: item.previewUrl, alt: '', loading: 'lazy' });
      preview.addEventListener('error', () => { preview.replaceWith(h('span', { class: 'note', style: 'padding:.4rem', text: 'Sin vista previa' })); });
      const input = h('input', {
        type: 'text', maxlength: '200', id: `alt-${item.id}`,
        placeholder: 'Ej.: Atardecer desde el deck',
        value: item.alt || '',
      });
      input.addEventListener('input', () => { item.alt = input.value; });
      return h('li', { class: 'upload-item', 'data-upload-id': item.id },
        h('div', { class: 'thumb' }, preview),
        h('div', { class: 'photo-info' },
          h('div', { class: 'row' },
            h('p', { class: 'upload-name', text: `Foto ${index + 1} · ${item.file.name}` }),
            h('button', { class: 'icon-btn', type: 'button', 'data-remove': '', 'aria-label': `Quitar la foto ${index + 1}`, onclick: () => removeUploadItem(item.id) }, '✕')),
          h('label', { class: 'sr-only', for: `alt-${item.id}`, text: `¿Qué se ve en la foto ${index + 1}?` }),
          input,
          h('div', { class: 'progress', hidden: true }, h('span')),
          h('p', { class: 'upload-status', role: 'status' }),
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'data-retry': '', hidden: true, onclick: () => retryItem(item.id) }, 'Reintentar')));
    }));
    uploadItems.forEach((item) => setItemState(item, item.status));
    updateUploadButton();
  };

  const updateUploadButton = () => {
    const button = $('[data-action="start-upload"]');
    const pending = uploadItems.filter((i) => i.status === 'pending' || i.status === 'error').length;
    const done = uploadItems.filter((i) => i.status === 'done').length;
    if (uploading) {
      button.disabled = true;
      button.textContent = 'Subiendo…';
    } else if (pending > 0) {
      button.disabled = false;
      button.textContent = `Subir ${pending} ${pending === 1 ? 'foto' : 'fotos'}`;
    } else {
      button.disabled = done === 0;
      button.textContent = 'Listo';
    }
    $('[data-action="pick-more"]').disabled = uploading;
    $$('[data-dialog="upload"] [data-close]').forEach((b) => { b.disabled = uploading; });
    $('[data-upload-intro]').textContent = uploadDestination === 'gallery'
      ? 'Se publican al final de «Postales del parador». Después podés cambiar el orden.'
      : 'Se guardan en la biblioteca para usarlas en las secciones. No aparecen en «Postales».';
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    files.forEach((file) => {
      const problem = validateFile(file);
      uploadItems.push({
        id: randomId(), file, alt: '',
        previewUrl: URL.createObjectURL(file),
        status: problem ? 'invalid' : 'pending',
        message: problem || 'Lista para subir',
        progress: 0,
      });
    });
    $('[data-upload-error]').textContent = '';
    renderUploadList();
    openDialog('upload');
  };

  const removeUploadItem = (id) => {
    const item = uploadItems.find((i) => i.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    uploadItems = uploadItems.filter((i) => i.id !== id);
    renderUploadList();
    if (!uploadItems.length) closeDialog('upload');
  };

  const runUploads = async (items) => {
    uploading = true;
    uploadItems.forEach((item) => setItemState(item, item.status));
    updateUploadButton();
    const queue = items.slice();
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        await uploadOne(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    uploading = false;
    uploadItems.forEach((item) => setItemState(item, item.status));
    updateUploadButton();
    const failed = items.filter((i) => i.status === 'error' || i.status === 'invalid').length;
    const ok = items.filter((i) => i.status === 'done').length;
    if (failed) {
      $('[data-upload-error]').textContent = `${failed === 1 ? 'Una foto no se pudo subir' : `${failed} fotos no se pudieron subir`}. Las demás quedaron guardadas. Revisá el mensaje de cada una (si aparece «Reintentar», tocalo).`;
    } else if (ok) {
      toast(`${ok === 1 ? 'Se subió 1 foto' : `Se subieron ${ok} fotos`}. Puede tardar hasta un minuto en verse en la web.`);
    }
    await reloadQuietly();
  };

  const startUpload = async () => {
    if (uploading) return;
    const pending = uploadItems.filter((i) => i.status === 'pending' || i.status === 'error');
    if (!pending.length) {
      if (uploadItems.some((i) => i.status === 'done')) closeDialog('upload');
      return;
    }
    await runUploads(pending);
  };

  const retryItem = async (id) => {
    const item = uploadItems.find((i) => i.id === id);
    if (!item || uploading) return;
    $('[data-upload-error]').textContent = '';
    await runUploads([item]);
  };

  const resetUploads = () => {
    uploadItems.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    uploadItems = [];
    $('[data-upload-list]').replaceChildren();
    $('[data-upload-error]').textContent = '';
  };

  // ---------- autenticación ----------
  const authErrorMessage = (error) => {
    const raw = `${(error && error.message) || ''}`;
    if (/Invalid login credentials/i.test(raw)) return 'El correo o la contraseña no coinciden.';
    if (/Email not confirmed/i.test(raw)) return 'Falta confirmar el correo. Avisale a Fabri.';
    if (/should be at least|weak|Password should/i.test(raw)) return 'La contraseña es muy corta o muy fácil. Usá al menos 10 caracteres.';
    if (/same.*password|different from the old/i.test(raw)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
    if (error && error.status === 429) return 'Demasiados intentos. Esperá unos minutos y probá otra vez.';
    return friendlyError(error);
  };

  const enterApp = async () => {
    showView('loading');
    const { data: isAdmin, error } = await sb.rpc('is_site_admin');
    if (error) {
      toast(friendlyError(error), true);
      showView('login');
      return;
    }
    if (!isAdmin) {
      showView('denied');
      return;
    }
    try {
      await loadData();
      showView('app');
    } catch (loadError) {
      toast(friendlyError(loadError), true);
      showView('login');
    }
  };

  const bindAuthForms = () => {
    $('[data-form="login"]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorBox = $('[data-error]', form);
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) { errorBox.textContent = 'Completá el correo y la contraseña.'; return; }
      const submit = $('button[type=submit]', form);
      submit.disabled = true;
      submit.textContent = 'Entrando…';
      errorBox.textContent = '';
      const { error } = await sb.auth.signInWithPassword({ email, password });
      submit.disabled = false;
      submit.textContent = 'Entrar';
      if (error) { errorBox.textContent = authErrorMessage(error); return; }
      form.password.value = '';
      await enterApp();
    });

    $('[data-form="forgot"]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const email = form.email.value.trim();
      const errorBox = $('[data-error]', form);
      const okBox = $('[data-ok]', form);
      errorBox.textContent = '';
      okBox.textContent = '';
      if (!email) { errorBox.textContent = 'Escribí tu correo.'; return; }
      const submit = $('button[type=submit]', form);
      submit.disabled = true;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/admin/` });
      submit.disabled = false;
      if (error && error.status === 429) { errorBox.textContent = authErrorMessage(error); return; }
      if (error && error.status === 0) { errorBox.textContent = friendlyError(error); return; }
      okBox.textContent = 'Si el correo está autorizado, en unos minutos te llega un enlace. Revisá también la carpeta de spam.';
    });

    $('[data-form="new-password"]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorBox = $('[data-error]', form);
      const password = form.password.value;
      if (password.length < 10) { errorBox.textContent = 'Usá al menos 10 caracteres.'; return; }
      if (password !== form.password2.value) { errorBox.textContent = 'Las dos contraseñas no coinciden.'; return; }
      const submit = $('button[type=submit]', form);
      submit.disabled = true;
      const { error } = await sb.auth.updateUser({ password });
      submit.disabled = false;
      if (error) { errorBox.textContent = authErrorMessage(error); return; }
      form.reset();
      window.history.replaceState(null, '', '/admin/');
      toast('Contraseña nueva guardada.');
      await enterApp();
    });

    $$('[data-go]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.go)));
    $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-pressed', String(show));
    }));
    $$('[data-action="logout"]').forEach((button) => button.addEventListener('click', async () => {
      await sb.auth.signOut();
      photos = [];
      slots = {};
      showView('login');
    }));
  };

  // ---------- eventos del panel ----------
  const bindPanel = () => {
    const tabs = $$('[data-tab]');
    const selectTab = (tab) => {
      tabs.forEach((t) => {
        const selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
        $(`[data-panel="${t.dataset.tab}"]`).hidden = !selected;
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', (event) => {
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') next = tabs[0];
        if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) { event.preventDefault(); selectTab(next); next.focus(); }
      });
    });

    const fileInput = $('[data-file-input]');
    const pickFiles = () => { fileInput.value = ''; fileInput.click(); };
    $$('[data-action="add"]').forEach((button) => button.addEventListener('click', () => {
      if (uploading) return;
      const destination = button.dataset.destination || 'gallery';
      if (uploadItems.length && uploadItems.every((i) => i.status === 'done')) resetUploads();
      uploadDestination = destination;
      pickFiles();
    }));
    $('[data-action="pick-more"]').addEventListener('click', pickFiles);
    fileInput.addEventListener('change', () => addFiles(fileInput.files));
    $('[data-action="start-upload"]').addEventListener('click', startUpload);

    $$('dialog [data-close]').forEach((button) => button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (dialog.dataset.dialog === 'upload' && uploading) return;
      closeDialog(dialog.dataset.dialog);
    }));
    const uploadDialog = $('[data-dialog="upload"]');
    uploadDialog.addEventListener('cancel', (event) => { if (uploading) event.preventDefault(); });
    uploadDialog.addEventListener('close', () => { if (!uploading) resetUploads(); });
    $('[data-dialog="picker"]').addEventListener('close', () => { pickerSlot = null; });
    $('[data-form="edit"]').addEventListener('submit', saveEdit);

    window.addEventListener('beforeunload', (event) => {
      if (uploading) { event.preventDefault(); event.returnValue = ''; }
    });
  };

  // ---------- arranque ----------
  const init = async () => {
    showView('loading');
    try {
      const response = await fetch('/api/admin-config', { cache: 'no-store', headers: { Accept: 'application/json' } });
      cfg = response.ok ? await response.json() : null;
    } catch (_) {
      cfg = null;
    }
    if (!cfg || !cfg.ok || !window.supabase) {
      showView('not-configured');
      return;
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const linkError = hashParams.get('error_description');
    let recovering = hashParams.get('type') === 'recovery';

    sb = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        setTimeout(() => showView('new-password'), 0);
      }
      if (event === 'SIGNED_OUT') {
        setTimeout(() => showView('login'), 0);
      }
    });

    bindAuthForms();
    bindPanel();

    const { data: { session } } = await sb.auth.getSession();
    if (linkError) {
      window.history.replaceState(null, '', '/admin/');
      showView(session ? 'app' : 'login');
      toast('El enlace venció o ya se usó. Pedí uno nuevo desde «Olvidé mi contraseña».', true);
      if (session) await enterApp();
      return;
    }
    if (recovering && session) {
      showView('new-password');
      return;
    }
    if (session) await enterApp();
    else showView('login');
  };

  init();
})();
