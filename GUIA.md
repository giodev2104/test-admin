# Guía de puesta en marcha · Webcare

Panel del equipo: **test-admin** · Portal del cliente: **test-cliente** · Base de datos: **Supabase** (proyecto `ufwuvbjrgvphbggkfkuh`).

Todo lo de esta guía es **gratis**. Sigue los pasos en orden; cada uno se hace una sola vez.

---

## 1. Base de datos

En Supabase > **SQL Editor**, ejecuta (pestaña nueva cada vez, botón **Run**):

| Situación | Qué ejecutar |
|---|---|
| Proyecto vacío | `supabase_completo.sql` → `supabase_mejoras.sql` → `supabase_mejoras_2.sql` → `supabase_mejoras_3.sql` |
| Ya tenías la versión anterior funcionando | Solo lo que te falte, en orden: `supabase_mejoras.sql`, `supabase_mejoras_2.sql`, `supabase_mejoras_3.sql` (no borran nada y se pueden repetir) |
| Quieres empezar de cero | `supabase_borrar_todo.sql` → `supabase_completo.sql` → `supabase_mejoras.sql` → `supabase_mejoras_2.sql` → `supabase_mejoras_3.sql` |

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

En Supabase > **Edge Functions > Deploy a new function > Via Editor**, crea estas ocho. En cada una: escribe el **nombre exacto**, pega el contenido del archivo y pulsa **Deploy**.

| Nombre | Archivo | «Verify JWT» |
|---|---|---|
| `gestionar-staff` | `supabase/functions/gestionar-staff/index.ts` | Activado (como estaba) |
| `correo` | `supabase/functions/correo/index.ts` | **Desactivado** |
| `adjuntos` | `supabase/functions/adjuntos/index.ts` | **Desactivado** |
| `medir` | `supabase/functions/medir/index.ts` | **Desactivado** |
| `informe` | `supabase/functions/informe/index.ts` | **Desactivado** |
| `google` | `supabase/functions/google/index.ts` | **Desactivado** |
| `boveda` | `supabase/functions/boveda/index.ts` | **Desactivado** |
| `enlaces` | `supabase/functions/enlaces/index.ts` | **Desactivado** |

«Verify JWT» se cambia en los ajustes (Settings/Details) de cada función. Las marcadas como *Desactivado* comprueban ellas mismas quién las llama; si lo dejas activado, el portal no podrá usarlas.

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

- **Tokens**: el Mantenimiento Pro incluye 1-2 tokens/mes de cambios de contenido (texto en el bloque `CATÁLOGO`). Los que tiene cada cliente se rellenan en su ficha del panel («Tokens incluidos en su plan» / «Tokens usados este mes»), y el día 1 los usados vuelven a 0.
- **Reservar una llamada (Cal.com, gratis)**: crea una cuenta en cal.com, un evento de 15–30 min y pega su enlace en `const CITA={url:"https://cal.com/tu-usuario/llamada"};`. Si lo dejas vacío, el botón no aparece.
- **Preguntas frecuentes**: la lista `const FAQ=[…]`. Cada una tiene `p` (pregunta), `r` (respuesta) y `k` (palabras con las que se sugiere mientras el cliente escribe).
- **App instalable**: el portal ya se puede instalar en el móvil («Mi cuenta > App y avisos»). Funciona solo con https (GitHub Pages lo es).

En el panel, `URL_PORTAL` (función «Ver como cliente») apunta a `https://giodev2104.github.io/test-cliente/`; cámbialo si el portal se publica en otra dirección.

Si actualizaste la función **medir**, vuelve a desplegarla (Edge Functions > medir > Code > pega `supabase/functions/medir/index.ts` > Deploy): ahora abre una Incidencia sola cuando una web deja de responder.

---

## 9. Lote 3: Google, bóveda, urgencias y bajas

**Bóveda de accesos (obligatorio para que funcione).** En Supabase > **Edge Functions > Secrets** añade `BOVEDA_CLAVE` con una frase larga y aleatoria (mínimo 16 caracteres). Guárdala también en tu gestor de contraseñas: si se pierde o se cambia, las contraseñas guardadas ya no se pueden leer.

**Google (Search Console y Analytics, gratis).**
1. Entra en [console.cloud.google.com](https://console.cloud.google.com), crea un proyecto y activa **Google Search Console API** y **Google Analytics Data API**.
2. **IAM y administración > Cuentas de servicio > Crear**. Dentro de la cuenta: **Claves > Añadir clave > JSON** (se descarga un archivo).
3. En Supabase > **Edge Functions > Secrets** crea `GOOGLE_SERVICE_ACCOUNT` y pega el contenido entero del archivo.
4. Por cada web: en **Search Console > Configuración > Usuarios y permisos** añade el correo de la cuenta de servicio (`…@….iam.gserviceaccount.com`) con permiso «Restringido». Si tiene **Analytics 4**: Administrar > Acceso a la propiedad > el mismo correo como «Lector», y pon el ID de la propiedad en la ficha del cliente.
5. En la ficha del cliente pulsa **Actualizar desde Google**. Después se actualiza solo cada lunes. Ojo: los datos de Google sustituyen los que hubieras escrito a mano en la parte SEO.

**Informe mensual.** Usa Brevo (paso 4). Se envía solo el día 1 a las 8:00 a cada cliente con plan (se puede desactivar por cliente en su ficha). El cliente también lo descarga en PDF desde «Mi web > Meses anteriores».

**Enlaces rotos.** No hay que configurar nada: cada hora se revisa una web (cada web, una vez al mes). En la ficha: «Revisar enlaces ahora».

**Urgencias, WhatsApp y bajas** (al principio del `<script>` de `test-cliente/index.html`):
- `SOPORTE`: canal de atención de cada plan (Esencial: email; Pro: WhatsApp prioritario). `PLAZO_URGENTE_H` en el panel y en `supabase/functions/correo/index.ts` es solo el objetivo interno del equipo.
- `WHATSAPP={numero:"34600000000"}`: el botón de WhatsApp para urgencias (Mantenimiento Pro y Renting Plan Ecommerce). Vacío = no sale.
- `STRIPE_PORTAL`: enlace del portal de clientes de Stripe (Stripe > Configuración > Facturación > Portal de clientes). Así el cliente cancela la suscripción, cambia la tarjeta y ve sus facturas.
- Las bajas llegan al panel como un caso «Baja del plan…». Al pasarlo a «Aceptado» se le quita el plan del portal; **cancela tú su suscripción en Stripe** (o deja que lo haga él con `STRIPE_PORTAL`).

Vuelve a desplegar `correo`: ahora avisa a todo el equipo cuando entra una urgencia.

---

## 10. Tarifas 2026

Todos los productos, servicios y precios salen de la «Propuesta Comercial & Tarifas Web» (versión 2026) y están en un solo sitio: el bloque `CATÁLOGO` del `<script>` de `test-cliente/index.html` (`WP` creación web, `PD` mantenimiento, `SECT` plantillas por sector, `RENT` renting, `EX` extras EXT-01…21, `PK` packs). Las cuotas mensuales están también en `PLANES` y `PRECIO_PLAN` del panel.

Ejecuta `supabase_tarifas_2026.sql` en el SQL Editor: acepta los planes nuevos y pasa los clientes de Básico a Mantenimiento Esencial y de Pro + SEO a Mantenimiento Pro.

---

## 11. Servicios de cada cliente

Ejecuta `supabase_servicios.sql` en el SQL Editor (después de `supabase_tarifas_2026.sql`). Crea la lista de servicios de cada cliente y rellena la de los clientes que ya tienes con su plan, su alta y lo que hayan contratado antes.

- **Portal → «Servicios»**: el cliente ve su plan de web, su plan de mantenimiento o renting y sus extras y packs. Puede cambiar de plan, añadir extras o packs y pedir la baja de un extra. Cada petición crea un caso en el panel y queda «Pendiente de aprobar».
- **Panel según lo contratado**: si el cliente tiene (o pide) un plan mensual de mantenimiento o de renting ve el panel completo (Mi web, Servicios, Soporte, SEO…). Si solo ha pedido cosas de pago único (un plan de web, extras o packs) ve un panel reducido: «Mis pedidos» (cada pedido con su estado Recibido → En preparación → Entregado, su chat y el pago), «Facturación» y «Mi cuenta». En cuanto contrate un plan mensual pasa solo al panel completo.
- **Panel**: al pasar ese caso a «Aceptado» el servicio queda activo (si es un plan, sustituye al anterior); al denegarlo queda rechazado. En la ficha completa del cliente, «Servicios contratados» permite corregir el estado, añadir un servicio a mano o quitarlo.

---

## 12. Entregas de archivos (web en .html, .zip, PDF…)

1. Ejecuta `supabase_entregas.sql` en el SQL Editor (después de `supabase_servicios.sql`). Crea el almacén privado «entregas» (hasta 50 MB por archivo, cualquier tipo) y la lista de entregas.
2. Vuelve a desplegar la función `adjuntos` (`supabase/functions/adjuntos/index.ts`): ahora también sirve las descargas de las entregas y comprueba que el pedido está pagado.

Cómo se usa: en el panel, ficha completa del cliente → «Servicios contratados». En cada pedido:
- **📦 Subir entrega**: eliges uno o varios archivos. Al cliente le llega un mensaje en el chat del pedido (y un correo si Brevo está configurado).
- **Marcar como pagado**: cuando veas el cobro en Stripe. Hasta entonces el cliente ve «Tu entrega está lista» con el botón de pago, pero no puede descargarla.
- Ves si el cliente ya la ha descargado, puedes abrir cada archivo («Ver») o borrarlo.

---

## 13. Financiación de pedidos

En «Mis pedidos», los pedidos de pago único desde 150 € tienen el botón **💳 Financiar**. El cliente elige 3 plazos sin intereses, 6 plazos (+3 %, TAE 15,4 %) o 12 plazos (+6 %, TAE 13,7 %), con la primera cuota hoy, y la solicitud llega como mensaje al chat de ese pedido. Tú le mandas el enlace o la suscripción de Stripe con esas cuotas y, cuando corresponda, marcas el pedido como pagado para liberar la entrega.

Los plazos, recargos y el mínimo están en `FINANCIACION` al principio del portal. Cobrar intereses a particulares puede entrar en la Ley 16/2011 de contratos de crédito al consumo: confírmalo con tu gestoría antes de activar los plazos con recargo (los 3 plazos sin intereses no tienen ese problema).

---

## 14. Opiniones de clientes en la portada

Ejecuta `supabase_opiniones.sql` en el SQL Editor (después de `supabase_entregas.sql`).

- Cuando un cliente descarga su entrega, se le pide su opinión: estrellas, un comentario y una casilla para mostrarla en la web (desmarcada por defecto; solo se publica si la marca). También puede valorar desde la entrega más tarde o al cerrarse una solicitud.
- Las opiniones públicas salen en la página principal del portal, en «Lo que dicen nuestros clientes», con la media de estrellas y el nombre con la inicial del apellido (p. ej. «Pedro R.»). La media se calcula con todas las opiniones públicas, buenas y malas.
- En el panel, «Negocio» → «Últimas valoraciones» indica cuáles están en la web y permite ocultarlas o volver a mostrarlas.
- Las entregas sirven para cualquier cliente: los de plan mensual las ven en «Servicios» y con un aviso en «Mi web».

---

## 15. Cobros con Stripe: el pedido se crea solo después de pagar

Antes, al pulsar «Pagar» se creaba el pedido aunque el cliente cerrara la página sin pagar. Ahora:

- El portal abre la página de pago de Stripe con el precio del catálogo (lo pone el servidor, no el navegador).
- **No se crea ningún caso ni servicio hasta que Stripe confirma el cobro.** Se confirma de dos maneras: cuando el cliente vuelve al portal, y por el aviso automático de Stripe (webhook). Así, aunque el cliente cierre la página justo después de pagar, el pedido se registra igual, y nunca dos veces.
- Si cancela en Stripe, el portal le dice que no se ha creado nada.
- Los planes de web (precio por presupuesto) no pasan por Stripe: se crea un caso «Presupuesto: …» y le mandas el precio por el chat.
- El botón «Pagar» de un pedido que ya existía (por ejemplo, la entrega pendiente de pago) lo marca como pagado solo cuando Stripe confirma el cobro.

Pasos:
1. Ejecuta `supabase_pagos.sql` en el SQL Editor (después de `supabase_opiniones.sql`).
2. Despliega la función `pago` (Edge Functions > Deploy a new function > Via Editor, pega `supabase/functions/pago/index.ts`) y **desactiva «Verify JWT»**.
3. En Edge Functions > Secrets añade `STRIPE_SECRET_KEY` (`sk_test_…` para pruebas, `sk_live_…` para cobrar de verdad).
4. En Stripe > Desarrolladores > Webhooks > Añadir endpoint: URL `https://ufwuvbjrgvphbggkfkuh.supabase.co/functions/v1/pago`, evento `checkout.session.completed`. Copia el «Signing secret» (`whsec_…`) y guárdalo en Secrets como `STRIPE_WEBHOOK_SECRET`.
5. (Opcional) `URL_PORTAL` en Secrets si el portal no está en `https://giodev2104.github.io/test-cliente/`.

Mientras falte `STRIPE_SECRET_KEY`, el portal avisa de que el pago online no está configurado y no crea nada.

## 16. Pipeline de leads simplificado

El pipeline tiene 5 columnas: **Nuevos** (SLA 2 h) · **En contacto** (SLA 1 día) · **Propuesta** (SLA 2 días) · **Aceptado** · **Denegado**.
Los casos antiguos en «Formulario enviado/recibido» aparecen en «En contacto» y los de «Seguimiento» en «Propuesta»; no hace falta moverlos.
En cada tarjeta: botón **→** para pasarla a la siguiente etapa, accesos directos a WhatsApp (🟢) y correo (✉️), mensajes (💬) y notas (📝).

## 17. Publicar

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

### Lote 3

| # | Mejora | Dónde se ve |
|---|---|---|
| 1 | Informe mensual por correo (día 1) y en PDF desde el portal | Correo del cliente · Portal: Mi web > Meses anteriores · Panel: ficha > «Enviar el informe» |
| 2 | Datos reales de Google: clics, impresiones, visitas, palabras en primera página y posiciones | Portal: Mi web y SEO · Panel: ficha > «Actualizar desde Google» |
| 6 | Sin permanencia: el cliente pide la baja desde el portal (con alternativa de bajar a Mantenimiento Esencial) | Portal: Facturación · Panel: caso «Baja del plan», dato «bajas» en Negocio |
| 8 | Urgencias con plazo por plan, aviso a todo el equipo, cuenta atrás y WhatsApp | Portal: Soporte · Panel: Inicio («Urgencias sin responder») y tarjetas |
| 10 | Bóveda cifrada de accesos con registro de quién los ve | Portal: Mi cuenta · Panel: ficha completa del cliente |
| 14 | Revisión mensual de enlaces rotos y errores 404 | Portal: Mi web · Panel: ficha y ficha completa del cliente |
