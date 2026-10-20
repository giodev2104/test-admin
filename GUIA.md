# Guía de puesta en marcha · Webcare

Panel del equipo: **test-admin** · Portal del cliente: **test-cliente** · Base de datos: **Supabase** (proyecto `ufwuvbjrgvphbggkfkuh`).

Todo lo de esta guía es **gratis**. Sigue los pasos en orden; cada uno se hace una sola vez.

---

## 1. Base de datos

En Supabase > **SQL Editor**, ejecuta (pestaña nueva cada vez, botón **Run**):

| Situación | Qué ejecutar |
|---|---|
| Proyecto vacío | `supabase_completo.sql` → `supabase_mejoras.sql` → `supabase_mejoras_2.sql` |
| Ya tenías la versión anterior funcionando | Solo lo que te falte: `supabase_mejoras.sql` y/o `supabase_mejoras_2.sql` (no borran nada y se pueden repetir) |
| Quieres empezar de cero | `supabase_borrar_todo.sql` → `supabase_completo.sql` → `supabase_mejoras.sql` → `supabase_mejoras_2.sql` |

Abre cada archivo en GitHub, pulsa **Raw**, copia todo (Ctrl+A, Ctrl+C) y pégalo.

En **Realtime > Settings**, deja permitidos los canales públicos (no actives «Private channels only»): el portal los usa para enterarse al instante de las respuestas.

Después, en **Database > Extensions**, comprueba que están activadas **pg_cron** y **pg_net**. Si no lo estaban, actívalas y vuelve a ejecutar `supabase_mejoras.sql` (programa el cierre de mes y la medición automática).

---

## 2. Tu acceso al panel (correo real)

Cada persona del equipo entra con **su propio correo**. Nunca uses un correo inventado: quien tenga ese buzón podría pedir un enlace para cambiar la contraseña y entrar en tu panel.

1. Supabase > **Authentication > Users > Add user > Create new user**: tu correo real, una contraseña y marca **Auto Confirm User**.
2. SQL Editor (cambia `gio` y el correo):
   ```sql
   insert into public.staff (usuario, email, creado_por, es_dueno)
   values ('gio', 'tu-correo@real.com', 'sistema', true)
   on conflict (usuario) do update set email = excluded.email, es_dueno = true;
   ```
3. En el panel, entra con ese correo y tu contraseña.

> Si ya tenías `gio@gmail.com` y **no es tu buzón**, cámbialo: en Authentication > Users edita el correo del usuario y ejecuta el `insert … on conflict` de arriba con el correo nuevo.

Solo los **propietarios** (`es_dueno = true`) pueden borrar y restaurar casos, gestionar administradores y cerrar el mes a mano.

---

## 3. Funciones del servidor (Edge Functions)

En Supabase > **Edge Functions > Deploy a new function > Via Editor**, crea estas cuatro. En cada una: escribe el **nombre exacto**, pega el contenido del archivo y pulsa **Deploy**.

| Nombre | Archivo | «Verify JWT» |
|---|---|---|
| `gestionar-staff` | `supabase/functions/gestionar-staff/index.ts` | Activado (como estaba) |
| `correo` | `supabase/functions/correo/index.ts` | **Desactivado** |
| `adjuntos` | `supabase/functions/adjuntos/index.ts` | **Desactivado** |
| `medir` | `supabase/functions/medir/index.ts` | **Desactivado** |

«Verify JWT» se cambia en los ajustes (Settings/Details) de cada función. Las tres marcadas como *Desactivado* comprueban ellas mismas quién las llama; si lo dejas activado, el portal no podrá usarlas.

> Si `gestionar-staff` ya estaba desplegada, vuelve a desplegarla: ahora pide el correo real de cada administrador nuevo.

---

## 4. Correos (Brevo, gratis hasta 300 al día)

Sirven para: avisar al cliente cuando le respondéis o cambia el estado de su solicitud, avisar al responsable cuando le asignan un caso o el cliente le escribe, y enviar el enlace de **«¿Has olvidado tu contraseña?»**.

1. Crea una cuenta gratis en **brevo.com**.
2. **Senders, Domains & Dedicated IPs > Senders > Add a sender**: añade tu correo (puede ser tu Gmail) y confírmalo desde el correo que te envían.
3. **SMTP & API > API Keys > Generate a new API key** y cópiala.
4. En Supabase > **Edge Functions > Secrets**, añade:
   - `BREVO_API_KEY` = la clave del paso 3
   - `CORREO_REMITENTE` = el correo que verificaste en el paso 2
   - (opcional) `NOMBRE_REMITENTE` = `Webcare` o el nombre de tu negocio
   - (opcional) `URL_PORTAL` y `URL_PANEL` si publicas las webs en otra dirección

Sin estos secretos todo lo demás funciona; solo no se envían correos (el panel te lo indicará una vez).

> Consejo: los primeros correos pueden caer en spam. Pide a tus clientes que marquen el remitente como seguro.

---

## 5. Medición automática de las webs (gratis)

Ya queda programada con el paso 1 (pg_cron) y la función `medir` del paso 3:

- **Cada hora** visita la web de cada cliente → rellena **% online (30 días)**, **SSL** y **última revisión**.
- **Una vez al día** consulta **Google PageSpeed** → rellena **velocidad** y **puntuación**.
- Solo mide clientes con **dominio** y con **Medición automática** marcada en su ficha (viene marcada).
- En la ficha tienes el botón **«Medir ahora»** para probarlo al momento.

Opcional: si Google limita las consultas, crea una clave gratis de PageSpeed en console.cloud.google.com y añádela como secreto `PAGESPEED_API_KEY`.

---

## 6. Datos legales del portal (RGPD)

En `test-cliente/index.html`, al principio del código, rellena:

```js
const EMPRESA={nombre:"…",nif:"…",direccion:"…",correo:"…"};
const PROMESA={respuesta:"normalmente en el mismo día laborable",respuestaCorta:"Mismo día",disponibilidad:"Vigilancia 24 h"};
```

`EMPRESA` sale en el **aviso legal**, la **política de privacidad** y **Mi cuenta**. `PROMESA` son los compromisos que ven los clientes: pon solo lo que puedas cumplir siempre.

Los textos legales son una plantilla razonable, **no asesoramiento legal**: revísalos con tu gestor o asesor.

---

## 7. Copias de seguridad (GitHub Actions, gratis)

Cada lunes se guarda una copia **cifrada** de la base de datos durante 90 días.

1. Supabase > botón **Connect** (arriba) > **Session pooler** > copia la URI y sustituye `[YOUR-PASSWORD]` por la contraseña de tu base de datos (si no la recuerdas: Project Settings > Database > Reset database password).
2. GitHub > repositorio **test-admin** > **Settings > Secrets and variables > Actions > New repository secret**:
   - `SUPABASE_DB_URL` = la URI del paso 1
   - `CLAVE_COPIA` = una contraseña larga inventada. **Guárdala bien**: sin ella no se puede abrir ninguna copia.
3. Pruébalo: pestaña **Actions > Copia de seguridad > Run workflow**. Al terminar, la copia aparece abajo en «Artifacts».

> Las copias del workflow solo se ejecutan desde la rama principal: fusiona la rama antes (paso 8).
> No incluyen los **archivos adjuntos** (Storage); esos se pueden descargar desde Supabase > Storage > adjuntos.

**Restaurar una copia** (en un ordenador con `gpg` y `psql`):
```bash
gpg -d webcare-AAAA-MM-DD.sql.tar.gz.gpg | tar -xz          # pide CLAVE_COPIA
psql "URI_DE_LA_BASE" -f webcare-AAAA-MM-DD.sql             # tablas y datos (en un proyecto vacío)
psql "URI_DE_LA_BASE" -f auth-webcare-AAAA-MM-DD.sql        # cuentas del equipo
```

---

## 8. Ajustes del portal (lote 2)

Todo está al principio del `<script>` de `test-cliente/index.html`:

- **Tokens de cada plan**: `const TOKENS={"Básico":2,"Pro":5};`. Son los que se anuncian en la portada y en Facturación. Los que tiene cada cliente se rellenan en su ficha del panel («Tokens incluidos en su plan» / «Tokens usados este mes»), y el día 1 los usados vuelven a 0.
- **Reservar una llamada (Cal.com, gratis)**: crea una cuenta en cal.com, un evento de 15–30 min y pega su enlace en `const CITA={url:"https://cal.com/tu-usuario/llamada"};`. Si lo dejas vacío, el botón no aparece.
- **Preguntas frecuentes**: la lista `const FAQ=[…]`. Cada una tiene `p` (pregunta), `r` (respuesta) y `k` (palabras con las que se sugiere mientras el cliente escribe).
- **App instalable**: el portal ya se puede instalar en el móvil («Mi cuenta > App y avisos»). Funciona solo con https (GitHub Pages lo es).

En el panel, `URL_PORTAL` (función «Ver como cliente») apunta a `https://giodev2104.github.io/test-cliente/`; cámbialo si el portal se publica en otra dirección.

Si actualizaste la función **medir**, vuelve a desplegarla (Edge Functions > medir > Code > pega `supabase/functions/medir/index.ts` > Deploy): ahora abre una Incidencia sola cuando una web deja de responder.

---

## 9. Publicar

GitHub Pages publica la rama principal. Fusiona la rama `claude/dreamy-albattani-j8rm9a` en **los dos repositorios** (o elígela en Settings > Pages).

- Portal del cliente: https://giodev2104.github.io/test-cliente/
- Panel del equipo: https://giodev2104.github.io/test-admin/

---

## Qué hace cada mejora

| # | Mejora | Dónde se ve |
|---|---|---|
| 1 | Casilla de privacidad al registrarse, aviso legal, política de privacidad y aviso de cookies | Portal: registro y pie de la portada |
| 2 | Límite de registros por IP, bloqueo tras 8 contraseñas fallidas, trampa invisible para bots | Portal: registro y acceso |
| 3 | Cada administrador entra con su correo real | Panel: acceso y «Administradores» |
| 4 | Copia de seguridad semanal cifrada | GitHub > Actions |
| 6 | Avisos por correo al cliente y al responsable | Bandeja de entrada |
| 7 | «¿Has olvidado tu contraseña?» con enlace por correo | Portal: acceso |
| 8 | Adjuntar capturas y archivos (máx. 10 MB) en solicitudes y chat | Portal: Soporte y chat · Panel: chat del caso |
| 9 | «Mi cuenta»: nombre, teléfono, web y cambio de contraseña | Portal: menú |
| 12 | Promesas editables y más prudentes | Portal: portada y Soporte |
| 13 | Historial mensual y cierre automático el día 1 | Portal: «Mi web > Meses anteriores» · Panel: «Cerrar el mes ahora» |
| 14 | % online, SSL, velocidad y puntuación automáticos | Panel: ficha del cliente («Medir ahora») |
| 15 | Respuestas rápidas con `{nombre}` | Panel: chat del caso > «⚡ Respuesta rápida» |
| 16 | Aviso destacado al responsable (y correo) al asignarle un caso o cuando su cliente escribe | Panel |
| 17 | Historial de cambios de la ficha | Panel: ficha > «Historial de cambios» |
| 18 | Permisos de propietario solo por `es_dueno` | Panel |
| 21 | El portal se actualiza al instante cuando el equipo responde | Portal |

### Lote 2

| # | Mejora | Dónde se ve |
|---|---|---|
| 3 | Valoración opcional (1–5 estrellas y comentario) al cerrar una solicitud | Portal: solicitud cerrada · Panel: tarjeta, detalle, Negocio y ficha del cliente |
| 4 | Mensajes nuevos marcados y «✓✓ Visto» en los dos sentidos | Portal: menú, Soporte y chat · Panel: chat del caso |
| 5 | Preguntas frecuentes y sugerencias mientras el cliente escribe | Portal: Soporte |
| 6 | Reservar una llamada (Cal.com) | Portal: Soporte y Mi web (si configuras `CITA.url`) |
| 7 | App instalable y avisos en el móvil | Portal: Mi cuenta > App y avisos |
| 8 | Gráficos de evolución (% online, velocidad, visitas de Google) | Portal: Mi web > Tu evolución |
| 13 | Negocio: ingresos recurrentes, clientes, altas, primera respuesta, satisfacción y gráficos | Panel: icono de barras |
| 14 | Incidencia automática cuando la web de un cliente no responde (y aviso al recuperarse) | Panel: tarjeta «🤖 Automático» · Portal: Soporte |
| 16 | Ficha completa del cliente con casos, mensajes, renovaciones, valoraciones y notas que no se pierden entre casos | Panel: Clientes > «Ver cliente» |
| 17 | Calendario de renovaciones con aviso al entrar | Panel: icono de calendario · Portal: Mi web > Próximamente |
| 19 | Etiquetas en los casos, filtro por etiqueta y filtros guardados | Panel: detalle del caso y barra del Pipeline |
| 21 | «Ver como cliente»: abre su portal en solo lectura durante 1 hora | Panel: ficha del cliente, detalle del caso y Clientes (👁) |
| 23 | Ranking del equipo (resueltos, abiertos, tiempos, mensajes, valoración) | Panel: Negocio |
| — | Las horas de los planes ahora son **tokens** | Portal y ficha del cliente |
