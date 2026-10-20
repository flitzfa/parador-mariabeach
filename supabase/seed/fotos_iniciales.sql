-- =====================================================================
-- María Beach · Carga inicial de las fotos que ya están en la web
-- Ejecutar DESPUÉS de la migración, en Supabase → SQL Editor.
-- Registra los archivos actuales del repositorio (no los copia a Storage)
-- para que la galería y las secciones sigan iguales al activar el sistema.
-- Es idempotente: no duplica filas ni pisa cambios hechos luego por Pao.
-- =====================================================================

insert into public.photos
  (id, static_path, alt_text, description, width, height, is_published, show_in_gallery, sort_order)
values
  -- «Postales del parador», en el orden actual de la web
  ('6b1d6a40-0001-4c00-9000-000000000001', 'assets/media/gallery-river-sunset.jpg',  'Sol bajando sobre el río Paraná',               null, 960, 1280, true, true, 1),
  ('6b1d6a40-0001-4c00-9000-000000000002', 'assets/media/gallery-parador.jpg',       'Entrada y fachada de madera de María Beach',    null, 960, 1280, true, true, 2),
  ('6b1d6a40-0001-4c00-9000-000000000003', 'assets/media/gallery-people-river.jpg',  'Grupo de personas en la orilla del río',        null, 1280, 960, true, true, 3),
  ('6b1d6a40-0001-4c00-9000-000000000004', 'assets/media/gallery-hammock.jpg',       'Hamaca entre árboles en María Beach',           null, 960, 1280, true, true, 4),
  ('6b1d6a40-0001-4c00-9000-000000000005', 'assets/media/gallery-night-fire.jpg',    'Fuego y encuentro nocturno junto al río',       null, 960, 1280, true, true, 5),

  -- Fotos de las secciones destacadas (no aparecen en «Postales»)
  ('6b1d6a40-0002-4c00-9000-000000000001', 'assets/media/parador-community.jpg',     'Terraza de madera, mesas y visitantes en María Beach', null, 960, 1280, true, false, 101),
  ('6b1d6a40-0002-4c00-9000-000000000002', 'assets/media/day-shade-parador.jpg',     'Pérgola con el cartel de María Beach y bancos de madera entre los árboles', null, 960, 1280, true, false, 102),
  ('6b1d6a40-0002-4c00-9000-000000000003', 'assets/media/sunset-deck-crecida.jpg',   'Atardecer desde el deck de María Beach, con el río crecido y árboles dentro del agua', null, 720, 1280, true, false, 103),
  ('6b1d6a40-0002-4c00-9000-000000000004', 'assets/media/night-deck.jpg',            'Terraza de María Beach iluminada durante la noche', null, 960, 1280, true, false, 104),
  ('6b1d6a40-0002-4c00-9000-000000000005', 'assets/media/cantina-pexels-drinks.jpg', 'Dos bebidas frías con hielo sobre una mesa de madera', 'Foto de stock (Pexels): conviene reemplazarla por una propia', 720, 960, true, false, 105),
  ('6b1d6a40-0002-4c00-9000-000000000006', 'assets/media/cantina-pizza-deck.jpg',    'Porción de pizza sobre una mesa del deck de María Beach', null, 720, 540, true, false, 106),
  ('6b1d6a40-0002-4c00-9000-000000000007', 'assets/media/cantina-pexels-empanadas.jpg', 'Empanadas argentinas en una mesa rústica', 'Foto de stock (Pexels): conviene reemplazarla por una propia', 432, 540, true, false, 107)
on conflict (id) do nothing;

insert into public.photo_slots (slot, photo_id)
values
  ('parador',           '6b1d6a40-0002-4c00-9000-000000000001'),
  ('dia',               '6b1d6a40-0002-4c00-9000-000000000002'),
  ('atardecer',         '6b1d6a40-0002-4c00-9000-000000000003'),
  ('noche',             '6b1d6a40-0002-4c00-9000-000000000004'),
  ('cantina-principal', '6b1d6a40-0002-4c00-9000-000000000005'),
  ('cantina-acento-1',  '6b1d6a40-0002-4c00-9000-000000000006'),
  ('cantina-acento-2',  '6b1d6a40-0002-4c00-9000-000000000007')
on conflict (slot) do nothing;
