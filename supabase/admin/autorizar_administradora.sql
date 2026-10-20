-- =====================================================================
-- María Beach · Autorizar a una administradora
-- 1. Primero creá el usuario en Supabase → Authentication → Users → Add user.
-- 2. Reemplazá CORREO_DE_LA_ADMINISTRADORA por ese mismo correo (entre comillas simples).
-- 3. Ejecutá este archivo en Supabase → SQL Editor (botón Run).
-- Al final se muestra la lista de administradoras: el correo tiene que aparecer ahí.
-- Si no aparece, el correo no coincide con ningún usuario creado
-- (revisá espacios o errores de tipeo) y volvé a ejecutarlo.
-- =====================================================================

insert into public.site_admins (user_id, note)
select u.id, 'Administradora de fotos'
from auth.users u
where lower(u.email) = lower('CORREO_DE_LA_ADMINISTRADORA')
on conflict (user_id) do nothing;

-- Lista de administradoras autorizadas:
select u.email as administradora, a.created_at as autorizada_el
from public.site_admins a
join auth.users u on u.id = a.user_id
order by a.created_at;

-- Para quitar el permiso a alguien (no borra su usuario):
-- delete from public.site_admins
-- where user_id = (select id from auth.users where lower(email) = lower('CORREO_A_QUITAR'));
