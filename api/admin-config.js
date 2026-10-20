'use strict';

// GET /api/admin-config
// Entrega al panel /admin/ la URL del proyecto y la clave PÚBLICA de Supabase.
// Esa clave es pública por diseño: la seguridad la dan Supabase Auth y las políticas RLS.

const { readPublicConfig, sendJson } = require('./_supabase');

module.exports = function handler(req, res) {
  const cfg = readPublicConfig();
  if (!cfg) {
    return sendJson(res, 200, { ok: false, reason: 'not-configured' }, 'no-store');
  }
  return sendJson(res, 200, { ok: true, url: cfg.url, key: cfg.key, bucket: cfg.bucket }, 'no-store');
};
