'use strict';

// Configuración pública de Supabase leída desde las variables de entorno de Vercel.
// Solo se usa la clave pública (publishable / anon). Nunca la service_role.
function readPublicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) {
    return null;
  }
  if (!key || /service_role|sb_secret_/i.test(key)) {
    // Si por error se cargó una clave secreta, no se usa ni se expone.
    return null;
  }
  return { url, key, bucket: 'site-photos' };
}

function sendJson(res, status, body, cacheControl, cdnCacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  // Caché solo en el CDN de Vercel (no llega al navegador): así Pao ve sus cambios
  // en hasta 1 minuto sin que el navegador muestre una versión vieja.
  if (cdnCacheControl) res.setHeader('Vercel-CDN-Cache-Control', cdnCacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

module.exports = { readPublicConfig, sendJson };
