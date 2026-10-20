'use strict';

// GET /api/site-photos
// Devuelve las fotos publicadas de «Postales» y de las secciones destacadas.
// Usa la clave pública + RLS: aunque alguien llame directo a Supabase, solo ve lo publicado.
// La respuesta se cachea ~1 minuto solo en el CDN de Vercel (Vercel-CDN-Cache-Control)
// para no gastar cuota de Supabase; el navegador siempre pide la versión vigente.

const { readPublicConfig, sendJson } = require('./_supabase');

const SLOTS = ['parador', 'dia', 'atardecer', 'noche', 'cantina-principal', 'cantina-acento-1', 'cantina-acento-2'];
const STATIC_RE = /^assets\/media\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/;
const STORAGE_RE = /^uploads\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}(-sm)?\.(jpg|png|webp)$/;
const THUMB_WIDTH = 800;

async function getJson(url, key) {
  const response = await fetch(url, {
    headers: { apikey: key, Accept: 'application/json' },
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
  return response.json();
}

function toPublicPhoto(row, cfg) {
  const base = `${cfg.url}/storage/v1/object/public/${cfg.bucket}/`;
  let src = null;
  let srcSmall = null;

  if (row.static_path && STATIC_RE.test(row.static_path)) {
    src = `/${row.static_path}`;
  } else if (row.storage_path && STORAGE_RE.test(row.storage_path)) {
    src = base + row.storage_path;
    if (row.thumb_path && STORAGE_RE.test(row.thumb_path)) srcSmall = base + row.thumb_path;
  }
  if (!src) return null;

  const width = Number(row.width) || 1200;
  const height = Number(row.height) || 1600;
  const photo = {
    id: row.id,
    src,
    alt: String(row.alt_text || 'Foto de María Beach').slice(0, 200),
    description: row.description ? String(row.description).slice(0, 300) : null,
    width,
    height,
  };
  if (srcSmall && width > THUMB_WIDTH) {
    photo.srcSmall = srcSmall;
    photo.widthSmall = THUMB_WIDTH;
  }
  return photo;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendJson(res, 405, { ok: false }, 'no-store');
  }

  const cfg = readPublicConfig();
  if (!cfg) {
    // Sin configurar: la web sigue mostrando las fotos estáticas del HTML.
    // Responde 200 para no ensuciar la consola de los visitantes; el cliente ve ok:false.
    return sendJson(res, 200, { ok: false, reason: 'not-configured' }, 'public, max-age=0, must-revalidate', 'max-age=300');
  }

  try {
    const fields = 'id,storage_path,thumb_path,static_path,alt_text,description,width,height,show_in_gallery,sort_order';
    const [photos, slots] = await Promise.all([
      getJson(`${cfg.url}/rest/v1/photos?select=${fields}&is_published=eq.true&order=sort_order.asc,created_at.asc`, cfg.key),
      getJson(`${cfg.url}/rest/v1/photo_slots?select=slot,photo_id`, cfg.key),
    ]);

    if (!Array.isArray(photos) || !Array.isArray(slots)) throw new Error('Respuesta inesperada');

    const byId = new Map();
    photos.forEach((row) => {
      const photo = toPublicPhoto(row, cfg);
      if (photo) byId.set(row.id, { row, photo });
    });

    const gallery = [];
    byId.forEach(({ row, photo }) => {
      if (row.show_in_gallery) gallery.push(photo);
    });

    const slotPhotos = {};
    slots.forEach(({ slot, photo_id: photoId }) => {
      const hit = byId.get(photoId);
      if (SLOTS.includes(slot) && hit) slotPhotos[slot] = hit.photo;
    });

    return sendJson(
      res,
      200,
      { ok: true, gallery, slots: slotPhotos },
      'public, max-age=0, must-revalidate',
      'max-age=60, stale-while-revalidate=600'
    );
  } catch (error) {
    console.error('[site-photos]', error && error.message);
    return sendJson(res, 502, { ok: false, reason: 'backend-unavailable' }, 'no-store');
  }
};
