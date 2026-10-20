# Administración de fotos de María Beach

Esta guía explica cómo activar el panel privado `https://www.paradormariabeach.com.ar/admin/`, que le permite a Pao cambiar fotos de la web desde el celular sin tocar código, GitHub ni Vercel.

> **Mientras no completes estos pasos, la web sigue funcionando igual que hoy** con las fotos que ya están en el proyecto. El panel muestra «El panel todavía no está activado».

---

## 0. Cómo funciona (en criollo)

- **Supabase** guarda tres cosas: la cuenta de Pao (correo y contraseña), las fotos que sube (en un «bucket» de Storage) y una tabla con el orden, qué se publica y en qué parte de la web va cada foto.
- **Vercel** sigue sirviendo la web como siempre. Se agregan dos funciones chiquitas:
  - `/api/site-photos`: arma la lista de fotos publicadas para la web pública (queda guardada en caché 1 minuto).
  - `/api/admin-config`: le pasa al panel la dirección del proyecto de Supabase y la **clave pública**.
- **La seguridad está en Supabase, no en los botones.** Las reglas de la base de datos (RLS) solo dejan escribir a las cuentas que figuran en la tabla `site_admins`. Esa tabla no se puede modificar desde la web: solo desde el panel de Supabase.
- **Si Supabase falla o está pausado**, la web muestra las fotos originales que están en el HTML. No queda nada en blanco.

### Qué puede hacer Pao

| Pestaña | Para qué sirve |
|---|---|
| **Postales** | La galería «Postales del parador». Agregar fotos, cambiar el orden con flechas, ocultar/publicar, editar el texto y eliminar. |
| **Secciones** | Elegir qué foto va en: El parador, Día, Atardecer, Noche y las tres fotos de la Cantina. |
| **Biblioteca** | Fotos guardadas que no están en Postales (por ejemplo, las de las secciones). Se pueden sumar a Postales. |

Fuera del panel (no se administran desde acá): logo, favicon, imagen para compartir en redes (Open Graph), foto principal de la portada y la miniatura del video. Son recursos de marca.

---

## 1. Qué hay que configurar

1. Un proyecto de **Supabase** (plan gratuito alcanza para empezar).
2. Ejecutar **dos archivos SQL** (estructura y carga de las fotos actuales) y **uno más** para autorizar a Pao.
3. Crear la **cuenta de Pao** en Supabase.
4. Ajustar **dos opciones de autenticación** (sin registro público y la dirección de recuperación).
5. Cargar **dos variables de entorno** en Vercel.
6. Publicar (commit + push) y probar desde un celular.

Tiempo estimado: 20–30 minutos.

---

## 2. Crear el proyecto de Supabase

1. Entrá a <https://supabase.com> e iniciá sesión (podés usar tu cuenta de GitHub).
2. **New project**.
   - **Name:** `maria-beach`
   - **Database password:** generá una con el botón y **guardala en tu gestor de contraseñas**. No va en el código.
   - **Region:** la más cercana a Argentina que ofrezca (por ejemplo, *South America (São Paulo)*).
3. Esperá a que termine de crearse (1–2 minutos).

---

## 3. Ejecutar las migraciones SQL

En el menú izquierdo de Supabase: **SQL Editor → New query**.

1. Abrí `supabase/migrations/20261020120000_administracion_fotos.sql`, copiá **todo** el contenido, pegalo y tocá **Run**.
   Debe terminar con «Success. No rows returned». Crea las tablas, las reglas de seguridad y el bucket `site-photos`.
2. **New query** otra vez. Pegá `supabase/seed/fotos_iniciales.sql` y **Run**.
   Registra las 12 fotos que hoy usa la web (5 de Postales + 7 de secciones) **sin copiarlas**: siguen sirviéndose desde el proyecto.

Los dos archivos se pueden volver a ejecutar sin duplicar nada.

**Comprobación rápida:** en **Table Editor** tienen que aparecer `photos` (12 filas), `photo_slots` (7 filas) y `site_admins` (vacía por ahora). En **Storage** tiene que aparecer el bucket `site-photos` marcado como *Public*.

---

## 4. Crear la cuenta de Pao y autorizarla

### 4.1 Crear el usuario

1. **Authentication → Users → Add user → Create new user**.
2. **Email:** el correo que Pao use habitualmente (pedíselo a ella).
3. **Password:** dejá que lo genere Supabase o poné una temporal larga. **No la mandes por WhatsApp junto con el correo**; mejor que Pao elija la suya con «Olvidé mi contraseña» (ver 4.3).
4. Tildá **Auto Confirm User** y tocá **Create user**.

### 4.2 Autorizarla como administradora

1. **SQL Editor → New query**.
2. Pegá el contenido de `supabase/admin/autorizar_administradora.sql`.
3. Reemplazá `CORREO_DE_LA_ADMINISTRADORA` por el correo de Pao (entre las comillas simples).
4. **Run**. Abajo aparece la lista de administradoras: el correo de Pao tiene que estar ahí. Si no aparece, el correo no coincide con el usuario creado (revisá espacios o errores de tipeo).

Solo las cuentas que estén en `site_admins` pueden cambiar fotos. Cualquier otra cuenta que inicie sesión ve «Esta cuenta no tiene permiso».

Si más adelante querés autorizar a sus hijas, repetí 4.1 y 4.2 con el correo de cada una. Para quitar el permiso, el mismo archivo tiene la consulta comentada al final.

### 4.3 Que Pao elija su propia contraseña

Una vez publicado todo (paso 7), Pao entra a `/admin/`, toca **Olvidé mi contraseña**, escribe su correo y sigue el enlace que le llega. Así nadie más conoce su contraseña.

---

## 5. Opciones de autenticación

En **Authentication**:

1. **Sign In / Providers** (o **Settings**, según la versión del panel): **desactivá «Allow new users to sign up»**. Así nadie puede crearse una cuenta desde afuera. Igual, aunque alguien lo lograra, no tendría permisos: no estaría en `site_admins`.
2. **URL Configuration**:
   - **Site URL:** `https://www.paradormariabeach.com.ar`
   - **Redirect URLs:** agregá `https://www.paradormariabeach.com.ar/admin/`
     (si vas a probar en tu compu con `vercel dev`, agregá también `http://localhost:3000/admin/`).
3. Opcional: en **Emails / Templates** podés traducir al español el mail de «Reset password».

> El servicio de correo que trae Supabase de fábrica tiene un límite bajo de envíos por hora. Para recuperar contraseñas de vez en cuando alcanza. Si algún día hace falta más, se configura un SMTP propio en **Authentication → Emails → SMTP Settings**.

---

## 6. Variables de entorno en Vercel

1. En Supabase: **Project Settings → API Keys**. Copiá:
   - **Project URL** (algo como `https://abcd1234.supabase.co`; también está en **Project Settings → Data API**).
   - **Publishable key** (empieza con `sb_publishable_…`). En proyectos más viejos se llama **anon public**; también sirve.
   - **No copies la secret key ni la service_role.** El panel no las usa y el código las rechaza si se cargan por error.
2. En Vercel: proyecto **parador-mariabeach → Settings → Environment Variables**. Agregá, para *Production* y *Preview*:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | la Project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | la publishable key |

3. Guardá. Las variables se aplican en el **próximo deploy**.

El archivo `.env.example` del repo muestra los nombres con valores ficticios. Para probar en tu compu con `vercel dev`, copialo como `.env.local` (no se sube a git) y poné los valores reales.

---

## 7. Desplegar

1. Revisá los cambios con `git status` / `git diff`.
2. Hacé commit y push a `main` como siempre. Vercel despliega solo.
   - El proyecto sigue siendo estático. Vercel detecta la carpeta `api/` y crea las dos funciones automáticamente. No hace falta comando de build.
3. Cuando termine, abrí `https://www.paradormariabeach.com.ar/api/site-photos`. Tiene que mostrar un texto que empieza con `{"ok":true,"gallery":[…`.
   - Si dice `"not-configured"`: faltan o están mal las variables del paso 6 (y hay que volver a desplegar).
   - Si dice `"backend-unavailable"`: el proyecto de Supabase está pausado o no se corrieron las migraciones.

---

## 8. Probar la subida desde un teléfono

1. En el celular, abrí `https://www.paradormariabeach.com.ar/admin/` e iniciá sesión con la cuenta de Pao (o con una cuenta de prueba que hayas autorizado).
2. **Postales → Agregar fotos**. Elegí 2 o 3 fotos de la galería del teléfono.
3. Escribí qué se ve en cada una y tocá **Subir**. Cada foto muestra su progreso; si una falla, aparece **Reintentar** solo en esa.
4. Abrí la web en otra pestaña: en hasta **1 minuto** las fotos aparecen al final de «Postales del parador».
5. Probá **↑ / ↓**, recargá el panel y fijate que el orden se mantenga. En la web se actualiza en hasta 1 minuto.
6. **Ocultar** una foto: desaparece de la web. **Publicar**: vuelve.
7. **Secciones → Día → Cambiar foto**: elegí otra y verificá la web.
8. **Eliminar** la foto de prueba (pide confirmación).

### Qué hace el panel con las fotos del celular

- Acepta JPG, PNG y WebP. También HEIC del iPhone **si el navegador puede abrirlo** (Safari lo convierte solo; si no se puede, lo avisa con un mensaje claro).
- Máximo 30 MB por foto de entrada. La achica a 1600 px del lado más largo, más una versión de 800 px para celulares, y la guarda como JPG de buena calidad (300–600 KB típico).
- Corrige la orientación y **borra los metadatos**, incluida la ubicación GPS.
- Rechaza fotos de menos de 500 px (se verían borrosas).
- Nombres de archivo únicos (`uploads/AAAA/MM/<id>.jpg`): nunca se pisan.

---

## 9. Si algo falla

| Síntoma | Qué pasa | Qué hacer |
|---|---|---|
| La web muestra las fotos «de siempre» y no las que subió Pao | `/api/site-photos` no responde bien; la web usa el respaldo estático | Abrí `/api/site-photos` (ver paso 7.3). Revisá en Supabase si el proyecto está **Paused** → **Restore project**. |
| El panel dice «El panel todavía no está activado» | Faltan las variables en Vercel | Paso 6 y volver a desplegar. |
| «Esta cuenta no tiene permiso» | El usuario existe pero no está en `site_admins` | Paso 4.2. |
| «El correo o la contraseña no coinciden» | Datos mal escritos | «Olvidé mi contraseña». |
| No llega el mail de recuperación | Spam o límite de envíos del correo de Supabase | Revisar spam, esperar una hora, o cambiar la contraseña vos desde **Authentication → Users**. |
| Una sección no se puede ocultar ni eliminar | Es a propósito: ninguna sección queda sin foto | Elegir otra foto para esa sección y después ocultar/eliminar. |
| Necesito volver a la versión sin panel | — | La web pública funciona sin Supabase. Quitando las variables de Vercel, todo vuelve a las fotos del HTML. |

**Respaldo:** las fotos originales siguen en `assets/media/`. Las fotos nuevas están en Supabase → **Storage → site-photos → uploads/**. Desde ahí se pueden descargar.

---

## 10. Límites del proveedor que hay que vigilar

Valores publicados en octubre de 2026. Pueden cambiar: revisalos en las páginas de precios.

**Supabase, plan Free**
- **Pausa por inactividad:** los proyectos gratuitos **se pausan después de una semana sin actividad** y hay que reactivarlos a mano (**Restore project**). Mientras esté pausado, la web muestra las fotos estáticas y el panel no anda. Es el riesgo más concreto. Las visitas a la web consultan Supabase como mucho una vez por minuto, pero no está garantizado que eso cuente como actividad suficiente para evitar la pausa: conviene entrar al panel de Supabase cada tanto y, si el negocio lo justifica, pasar al plan Pro, que no se pausa.
- **Storage:** 1 GB de archivos. Con fotos de unos 500 KB (más su versión chica) entran alrededor de 1.500 fotos.
- **Transferencia (egress):** 5 GB por mes sin caché y 5 GB con caché. Es el límite que más rápido se puede tocar si la web tiene muchas visitas, porque cada visitante descarga las fotos desde Supabase. Se mira en **Organization → Usage**.
- **Base de datos:** 500 MB (esta tabla ocupa muy poco).
- Hasta 2 proyectos activos por cuenta.

**Vercel, plan Hobby**
- 1.000.000 de invocaciones de funciones por mes y 100 GB de transferencia. Con la caché de 1 minuto, el consumo de las funciones es mínimo.
- **Importante:** Vercel indica que el plan Hobby es **solo para uso personal no comercial**. Una web de un comercio, o un sitio que cobrás por hacer o mantener, entra en «uso comercial», que requiere el plan Pro. Esto ya aplicaba antes del panel; conviene revisar en qué plan está el proyecto.

Fuentes: [Vercel – Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines), [Vercel – Limits](https://vercel.com/docs/limits), [Supabase – Pricing](https://supabase.com/pricing).

---

## Archivos de esta funcionalidad

| Archivo | Para qué |
|---|---|
| `admin/index.html`, `admin/admin.css`, `admin/admin.js` | El panel privado (no está enlazado desde la web y tiene `noindex`). |
| `admin/vendor/supabase-js-2.117.2.min.js` | Librería oficial de Supabase (MIT), servida desde el propio sitio. |
| `api/site-photos.js`, `api/admin-config.js`, `api/_supabase.js` | Funciones de Vercel. |
| `photos-live.js` | Aplica las fotos administradas en la web pública, con respaldo estático. |
| `supabase/migrations/…sql` | Estructura, seguridad (RLS) y bucket. |
| `supabase/seed/fotos_iniciales.sql` | Registra las fotos actuales de la web. |
| `supabase/admin/autorizar_administradora.sql` | Autoriza a una administradora por correo. |
| `vercel.json` | Cabeceras de seguridad del panel (no se puede embeber en otra web, `noindex`, sin caché). |
| `.vercelignore` | Evita publicar documentación y SQL como archivos de la web. |
| `.env.example` | Nombres de las variables, con valores ficticios. |

### Para Pao (texto para mandarle)

> ¡Hola Pao! Ya podés cambiar las fotos de la web desde el celu 📸
> 1. Entrá a **paradormariabeach.com.ar/admin** (guardalo en favoritos o «Agregar a inicio»).
> 2. La primera vez tocá **«Olvidé mi contraseña»**, poné tu correo y elegí tu contraseña con el enlace que te llega.
> 3. En **Postales** tocás **«Agregar fotos»**, elegís las fotos, escribís qué se ve y **Subir**.
> 4. Con las flechitas cambiás el orden. **Ocultar** la saca de la web sin borrarla.
> 5. En **Secciones** elegís la foto de Día, Atardecer, Noche y Cantina.
> Los cambios tardan hasta un minuto en verse en la web. ¡Cualquier cosa me avisás!
