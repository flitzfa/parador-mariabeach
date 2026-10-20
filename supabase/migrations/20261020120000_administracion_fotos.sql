-- =====================================================================
-- María Beach · Administración de fotografías
-- Ejecutar UNA vez en Supabase → SQL Editor (como rol postgres).
-- Es idempotente: se puede volver a correr sin duplicar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Administradoras autorizadas
--    Solo se escribe desde el SQL Editor / panel de Supabase.
--    El frontend NO tiene permiso para insertar, modificar ni borrar filas.
-- ---------------------------------------------------------------------
create table if not exists public.site_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.site_admins enable row level security;

revoke all on table public.site_admins from anon, authenticated;
grant select on table public.site_admins to authenticated;

drop policy if exists "site_admins: cada admin ve su propia fila" on public.site_admins;
create policy "site_admins: cada admin ve su propia fila"
  on public.site_admins for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ¿El usuario de la sesión actual es administradora de María Beach?
-- security definer: consulta site_admins sin depender de las políticas de la tabla.
create or replace function public.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_admins a where a.user_id = (select auth.uid())
  );
$$;

-- Solo usuarios con sesión la necesitan (el panel y las políticas de admin).
revoke all on function public.is_site_admin() from public, anon;
grant execute on function public.is_site_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Biblioteca de fotos
--    Cada foto vive en Storage (subidas nuevas) o en el repositorio
--    (fotos originales de la web, static_path). Nunca en ambos.
-- ---------------------------------------------------------------------
create table if not exists public.photos (
  id              uuid primary key default gen_random_uuid(),
  storage_path    text,            -- p. ej. uploads/2026/10/<uuid>.jpg (bucket site-photos)
  thumb_path      text,            -- versión chica para celulares (mismo bucket)
  static_path     text,            -- p. ej. assets/media/gallery-hammock.jpg (archivo del repo)
  alt_text        text not null default 'Foto de María Beach',
  description     text,
  width           integer not null check (width between 1 and 10000),
  height          integer not null check (height between 1 and 10000),
  is_published    boolean not null default true,
  show_in_gallery boolean not null default true,
  sort_order      bigint not null default (floor(extract(epoch from clock_timestamp()) * 1000))::bigint,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint photos_una_sola_fuente check (
    (storage_path is null) <> (static_path is null)
  ),
  constraint photos_thumb_solo_storage check (
    thumb_path is null or storage_path is not null
  ),
  -- Rutas acotadas: nada de URLs externas ni rutas raras.
  constraint photos_storage_path_valido check (
    storage_path is null
    or storage_path ~ '^uploads/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  ),
  constraint photos_thumb_path_valido check (
    thumb_path is null
    or thumb_path ~ '^uploads/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}-sm\.(jpg|png|webp)$'
  ),
  constraint photos_static_path_valido check (
    static_path is null
    or static_path ~ '^assets/media/[a-z0-9-]+\.(jpg|jpeg|png|webp)$'
  ),
  constraint photos_alt_largo check (char_length(btrim(alt_text)) between 3 and 200),
  constraint photos_description_largo check (description is null or char_length(description) <= 300)
);

create unique index if not exists photos_storage_path_key on public.photos (storage_path) where storage_path is not null;
create unique index if not exists photos_static_path_key on public.photos (static_path) where static_path is not null;
create index if not exists photos_gallery_idx on public.photos (show_in_gallery, is_published, sort_order);
create index if not exists photos_created_by_idx on public.photos (created_by);

-- ---------------------------------------------------------------------
-- 3. Ubicaciones destacadas (fotos editoriales fuera de «Postales»)
--    Lista cerrada para preservar la dirección de arte del sitio.
-- ---------------------------------------------------------------------
create table if not exists public.photo_slots (
  slot       text primary key check (slot in (
               'parador', 'dia', 'atardecer', 'noche',
               'cantina-principal', 'cantina-acento-1', 'cantina-acento-2'
             )),
  photo_id   uuid not null references public.photos (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists photo_slots_photo_idx on public.photo_slots (photo_id);

-- ---------------------------------------------------------------------
-- 4. Reglas de consistencia
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists photos_touch_updated_at on public.photos;
create trigger photos_touch_updated_at
  before update on public.photos
  for each row execute function public.touch_updated_at();

drop trigger if exists photo_slots_touch_updated_at on public.photo_slots;
create trigger photo_slots_touch_updated_at
  before update on public.photo_slots
  for each row execute function public.touch_updated_at();

-- Una foto que ocupa una sección destacada no se puede ocultar
-- (la sección quedaría sin foto). Primero hay que elegir otra para esa sección.
create or replace function public.photos_guard_slot_hide()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_published and not new.is_published
     and exists (select 1 from public.photo_slots s where s.photo_id = new.id) then
    raise exception 'FOTO_EN_SECCION'
      using errcode = 'P0001',
            hint = 'La foto está en una sección destacada. Elegí otra foto para esa sección antes de ocultarla.';
  end if;
  return new;
end;
$$;

drop trigger if exists photos_guard_slot_hide on public.photos;
create trigger photos_guard_slot_hide
  before update of is_published on public.photos
  for each row execute function public.photos_guard_slot_hide();

-- Una sección solo puede apuntar a una foto publicada.
create or replace function public.photo_slots_require_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.photos p where p.id = new.photo_id and p.is_published) then
    raise exception 'FOTO_OCULTA'
      using errcode = 'P0001',
            hint = 'Solo se pueden usar fotos publicadas en las secciones.';
  end if;
  return new;
end;
$$;

drop trigger if exists photo_slots_require_published on public.photo_slots;
create trigger photo_slots_require_published
  before insert or update of photo_id on public.photo_slots
  for each row execute function public.photo_slots_require_published();

-- ---------------------------------------------------------------------
-- 5. Permisos (RLS)
-- ---------------------------------------------------------------------
alter table public.photos enable row level security;
alter table public.photo_slots enable row level security;

revoke all on table public.photos, public.photo_slots from anon, authenticated;
grant select on table public.photos, public.photo_slots to anon, authenticated;
grant insert, update, delete on table public.photos, public.photo_slots to authenticated;

-- Visitantes: solo fotos publicadas.
drop policy if exists "photos: lectura publica de publicadas" on public.photos;
create policy "photos: lectura publica de publicadas"
  on public.photos for select
  to anon, authenticated
  using (is_published);

-- Administradora: ve también las ocultas.
drop policy if exists "photos: admin lee todo" on public.photos;
create policy "photos: admin lee todo"
  on public.photos for select
  to authenticated
  using ((select public.is_site_admin()));

drop policy if exists "photos: admin inserta" on public.photos;
create policy "photos: admin inserta"
  on public.photos for insert
  to authenticated
  with check ((select public.is_site_admin()));

drop policy if exists "photos: admin actualiza" on public.photos;
create policy "photos: admin actualiza"
  on public.photos for update
  to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

drop policy if exists "photos: admin elimina" on public.photos;
create policy "photos: admin elimina"
  on public.photos for delete
  to authenticated
  using ((select public.is_site_admin()));

-- Secciones: la asignación es pública (no contiene nada sensible).
drop policy if exists "photo_slots: lectura publica" on public.photo_slots;
create policy "photo_slots: lectura publica"
  on public.photo_slots for select
  to anon, authenticated
  using (true);

drop policy if exists "photo_slots: admin inserta" on public.photo_slots;
create policy "photo_slots: admin inserta"
  on public.photo_slots for insert
  to authenticated
  with check ((select public.is_site_admin()));

drop policy if exists "photo_slots: admin actualiza" on public.photo_slots;
create policy "photo_slots: admin actualiza"
  on public.photo_slots for update
  to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));

drop policy if exists "photo_slots: admin elimina" on public.photo_slots;
create policy "photo_slots: admin elimina"
  on public.photo_slots for delete
  to authenticated
  using ((select public.is_site_admin()));

-- ---------------------------------------------------------------------
-- 6. Orden de «Postales» en una sola operación
--    security invoker: además del chequeo explícito, rige RLS.
-- ---------------------------------------------------------------------
create or replace function public.set_gallery_order(photo_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_site_admin() then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;

  update public.photos p
     set sort_order = o.ord
    from unnest(photo_ids) with ordinality as o(id, ord)
   where p.id = o.id;
end;
$$;

revoke all on function public.set_gallery_order(uuid[]) from public, anon;
grant execute on function public.set_gallery_order(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Storage: bucket público de lectura, escritura solo para admins
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Las URLs públicas del bucket no necesitan política de lectura.
-- Listar / leer metadatos queda solo para administradoras.
drop policy if exists "site-photos: admin lista" on storage.objects;
create policy "site-photos: admin lista"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-photos' and (select public.is_site_admin()));

drop policy if exists "site-photos: admin sube" on storage.objects;
create policy "site-photos: admin sube"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-photos'
    and (storage.foldername(name))[1] = 'uploads'
    and (select public.is_site_admin())
  );

drop policy if exists "site-photos: admin actualiza" on storage.objects;
create policy "site-photos: admin actualiza"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'site-photos' and (select public.is_site_admin()))
  with check (bucket_id = 'site-photos' and (select public.is_site_admin()));

drop policy if exists "site-photos: admin elimina" on storage.objects;
create policy "site-photos: admin elimina"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-photos' and (select public.is_site_admin()));
