# Guía de puesta en marcha · Velority

Panel del equipo: **test-admin** · Portal del cliente: **test-cliente** · Base de datos: **Supabase** (proyecto `ufwuvbjrgvphbggkfkuh`).

Todo lo de esta guía es **gratis**. Sigue los pasos en orden; cada uno se hace una sola vez.

---

## 1. Base de datos

En Supabase > **SQL Editor**, ejecuta (pestaña nueva cada vez, botón **Run**):

| Situación | Qué ejecutar |
|---|---|
| **Tu proyecto actual** | Solo `supabase_crecimiento.sql` (lo demás ya está aplicado). |
| Proyecto vacío | `supabase_completo.sql` → `supabase_mejoras.sql` → `supabase_mejoras_2.sql` → `supabase_mejoras_3.sql` → `supabase_tarifas_2026.sql` → `supabase_servicios.sql` → `supabase_entregas.sql` → `supabase_opiniones.sql` → `supabase_pagos.sql` → `supabase_borrar_cliente.sql` → `supabase_catalogo.sql` → `supabase_ficha_auto.sql` → `supabase_crecimiento.sql` |
| Quieres empezar de cero | `supabase_borrar_todo.sql` y después todo lo de «Proyecto vacío», en ese orden |

> ⚠ **No vuelvas a ejecutar un script antiguo suelto.** Cada script nuevo sustituye funciones de los anteriores (por ejemplo, `cliente_datos`, que carga el portal). Si ejecutas uno viejo, esas funciones vuelven a su versión antigua y el portal falla («Tu sesión ha caducado» al usar «Ver como cliente», no aparecen servicios ni entregas…). Si alguna vez hay que repetir uno, ejecuta después **todos los posteriores en el orden de arriba**.

Abre cada archivo en GitHub, pulsa **Raw**, copia todo (Ctrl+A, Ctrl+C) y pégalo.

En **Realtime > Settings**, deja permitidos los canales públicos (no actives «Private channels only»): el portal los usa para enterarse al instante de las respuestas.

Después, en **Database > Extensions**, comprueba que están activadas **pg_cron** y **pg_net** (en tu proyecto ya lo están: las tareas automáticas funcionan). En un proyecto nuevo, actívalas **antes** de ejecutar los scripts.

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
   - (opcional) `NOMBRE_REMITENTE` = `Velority` o el nombre de tu negocio
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
gpg -d velority-AAAA-MM-DD.sql.tar.gz.gpg | tar -xz          # pide CLAVE_COPIA
psql "URI_DE_LA_BASE" -f velority-AAAA-MM-DD.sql             # tablas y datos (en un proyecto vacío)
psql "URI_DE_LA_BASE" -f auth-velority-AAAA-MM-DD.sql        # cuentas del equipo
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

## 17. Borrar clientes

Ejecuta `supabase_borrar_cliente.sql` en el SQL Editor. Después, en Clientes > ficha del cliente, los **propietarios** ven abajo «🗑 Borrar cliente».
Hay que escribir el correo del cliente para confirmar. Se borra todo: cuenta del portal, casos y mensajes, servicios, entregas, pagos registrados, valoraciones, renovaciones, bóveda y sus archivos. No se puede deshacer (los cobros siguen en Stripe).

## 18. Precios en un solo sitio

Todos los precios están en la tabla `catalogo` de Supabase (`supabase_catalogo.sql`, ya aplicado). Se cambian en el panel: **Negocio > 💶 Precios** (solo propietarios).
- El portal muestra esos precios, la función `pago` cobra exactamente esos importes y «Negocio» calcula los ingresos con ellos.
- Desmarcar «A la venta» oculta el servicio en el portal; quien ya lo tiene no se ve afectado.
- Cambiar un precio no cambia lo que pagan los clientes que ya tienen una suscripción en Stripe.
- Los textos de qué incluye cada servicio siguen en el portal (`index.html`, bloque CATÁLOGO).
- **🏷 Ofertas** (`supabase_ofertas_tokens.sql`, ya aplicado): el botón «Crear oferta» de cada fila pone un descuento (5, 10, 25, 30 % u otro) y, si quieres, una fecha final. El portal le cuelga la etiqueta «X% OFF», tacha el precio anterior y Stripe cobra el rebajado. En los planes de web la oferta se ve en el portal y la aplicas tú al enviar el presupuesto. En suscripciones (mantenimiento, renting y extras mensuales o trimestrales) el descuento es **solo para el primer cobro**: Stripe aplica un cupón de un solo uso y desde el segundo mes cobra el precio normal. El portal lo avisa en la tarjeta y en la ficha.
- **🪙 Pagar extras con tokens**: en los extras de pago único, «o N tokens» permite pagarlos con tokens (vacío = solo tarjeta). Se gastan primero los tokens del mes y después los de regalo; el caso entra en «Nuevos» como «Contratar: …» y el pedido ya figura como pagado con tokens. Los renting ya no incluyen tokens: solo los planes de mantenimiento.

### Marcar pagos desde el caso
Cada caso con un pedido del cliente muestra el bloque **💶 Pago** al abrirlo, y su tarjeta lleva el aviso «💶 Pendiente de pago» mientras no esté pagado. Si el cliente paga por transferencia, Bizum o en mano, pulsa **✓ Marcar como pagado**: el cliente recibe «Hemos recibido tu pago» en el chat, deja de ver el botón «Pagar» y se desbloquean sus entregas. Si el caso es su alta (Lead), el panel pregunta si pasarlo a «Aceptado» para desbloquear su portal. Los pagos con tarjeta o con tokens se marcan solos.

En ese mismo bloque, cada pedido (salvo los de mantenimiento) tiene **📦 Proyecto finalizado › Subir entrega**: sube ahí la web en .zip, el logo, el PDF… El cliente recibe el aviso y lo descarga en su portal en cuanto el pedido está pagado (hasta entonces ve «Pagar y desbloquear»).

## Marca: Velority
- **Logo**: `test-cliente/logo.svg` (en degradado, fondo transparente). El portal, el panel y el informe en PDF lo llevan incrustado; el icono de la pestaña es `favicon.svg` y los de la app instalada son `icon-192.png`, `icon-512.png` y `apple-touch-icon.png`.
- **Correos**: la cabecera usa `logo-correo.png`, que se carga desde el portal (`URL_PORTAL`). Si en Supabase > Edge Functions > Secrets tienes `NOMBRE_REMITENTE` = `Webcare`, cámbialo a `Velority`: si no existe, ya se usa «Velority».
- **Plugin de WordPress**: ahora se llama «Velority Conector» (versión 1.0.1) y sale en Ajustes › Velority. Por dentro conserva los nombres antiguos (`webcare_…`, archivo `webcare-conector.zip`) para que las webs que ya lo tengan no pierdan la clave.
- Las claves internas del navegador (`webcare-portal-token`, cookies, vista previa…) y las tareas programadas (`webcare-medir`, `webcare-informe`…) mantienen el nombre antiguo a propósito: así nadie pierde la sesión ni se duplican las tareas. No se ven en ningún sitio.

## Apartado «Demo» (demo gratuita)
Cuando un cliente pide su demo gratuita, su portal muestra el apartado **🎨 Demo** («Estamos preparando tu demo»), que no se bloquea.
1. En el panel, abre su caso «Demo gratuita»: bloque **🎨 Demo gratuita**. Pon el enlace de la demo (opcional), el **precio cerrado** (con IVA) y, si quieres, un mensaje. Las imágenes o el PDF de la demo se adjuntan en el chat del caso: el cliente las ve también en «Demo».
2. Pulsa **Enviar demo al cliente**: le llega un aviso al chat (y por correo, si está configurado) y en su menú sale «Demo · Lista». Puedes actualizarla y volver a avisar las veces que haga falta.
3. El cliente ve la demo dentro del portal y elige:
   - **✏️ Quiero cambios** → os llega un mensaje en el chat del caso.
   - **✅ Me gusta, quiero mi web** → se crea su pedido «Creación de tu web» con ese precio, acepta las condiciones y paga el **50 % de anticipo**. A partir de ahí sigue el proyecto por fases (bloque 💶 Pago del mismo caso).
Base de datos: `supabase_demo_entrega.sql` (ya aplicado).

## Planes de web ocultos en la portada
El bloque «Creación de tu web · pago único» (planes con precios) está oculto, no borrado: `MOSTRAR_PLANES_WEB=false` al principio del `<script>` de `test-cliente/index.html`. Con `true` vuelve a verse, junto con el enlace «Precios» del menú. Mientras está oculto, «Empezar» abre la demo gratuita.

## «Quiero mi demo gratuita»
El botón principal de la portada crea un caso **«Demo gratuita»** (tipo Lead) en «Nuevos». Si el visitante no tiene cuenta, primero se registra. En el chat le llega el mensaje de bienvenida con las preguntas (secciones, materiales y webs de referencia). Si ya tiene una demo abierta, no se duplica (`supabase_demo.sql`, aplicado).

## Asistente automático del portal (gratis)
El botón **«🤖 ¿Dudas? Pregúntame»** (abajo a la derecha del portal) abre un chat que responde al momento las dudas más habituales: precios (sacados del catálogo real, con las ofertas en vigor), cómo se paga, garantía, revisiones, tiendas online, reservas, extras, dominio, IVA, vista previa, cuenta… Cada respuesta trae botones (pedir presupuesto, ver planes, probar la vista previa, hablar con una persona).
- **No usa IA ni ningún servicio externo: coste 0 €.** Funciona por palabras clave dentro del propio portal.
- Si no entiende la pregunta, ofrece las opciones habituales y «Hablar con una persona».
- Las respuestas están en `IA_BASE` (en `test-cliente/index.html`): cada una tiene sus palabras clave (`k`), el texto (`r`) y los botones (`a`). Para añadir una pregunta nueva, copia un bloque y cambia esas tres cosas.
- La función `asistente` (con IA de pago) quedó desplegada pero **sin uso**: no gasta nada mientras no se configure `ANTHROPIC_API_KEY`.

## Proyectos web por fases (50 % + 50 %)
Los **planes de web** siguen estas fases (`supabase_fases_pago.sql`). Se gestionan desde el caso › 💶 Pago › 🪜 Fases del proyecto:
1. **Precio cerrado**: escribe el importe final (con IVA) y pulsa «Fijar y enviar al cliente». Le llega el desglose 50 % / 50 % por el chat.
2. **Anticipo del 50 %**: el cliente lo paga con tarjeta desde «Mis pedidos» (se marca solo). Si paga por transferencia o Bizum, pulsa «Marcar anticipo pagado». No se empieza a diseñar hasta tenerlo.
3. **Demo**: sube la web a tu servidor de pruebas, pega la dirección y pulsa «Enviar demo al cliente».
4. **Revisiones**: el cliente pide cambios desde su portal (máximo **2 rondas**; llegan al chat como «✏️ Ronda de revisión 1 de 2») o aprueba el diseño final. Más cambios se presupuestan aparte.
5. **Pago final del 50 %**: tras la aprobación, el cliente lo paga desde el portal (o pulsa «Marcar pago final»). Con el pago se desbloquean los archivos de la entrega.
6. **Publicación**: sube los archivos en «📦 Proyecto finalizado», publica la web y pulsa «🚀 Marcar como publicada».
7. **Garantía de 30 días**: empieza ese día, con el 100 % cobrado, y solo cubre errores o fallos técnicos. El cliente ve hasta qué fecha está cubierto.

Los packs y extras siguen cobrándose al 100 % al contratarlos.

## Solo pago único (suscripciones en «Próximamente»)
Ahora mismo el portal solo vende servicios de **pago único**: planes de web, landing pages, desarrollos a medida, packs y extras de pago único.
- Mantenimiento, renting, extras mensuales o trimestrales y la financiación aparecen en **«Próximamente / Planes de Suscripción»**, difuminados y con los botones deshabilitados. No se ha borrado nada: precios y textos siguen en el código y en Negocio › 💶 Precios.
- Al registrarse, el cliente acepta en una sola casilla la política de privacidad y el Aviso Legal. Al pagar (servicio, anticipo o pago final de una web) tiene que marcar «He leído y acepto el Aviso Legal y las Condiciones de Contratación de Servicios de Pago Único». Queda constancia en Stripe (datos del pago) y en el detalle del caso («Condiciones aceptadas», solo lo ve el equipo).
- Las condiciones son el PDF `test-cliente/legal/condiciones-pago-unico.pdf`; para cambiarlas, sustituye ese archivo.
- Los datos del titular del Aviso Legal (nombre, NIF, domicilio, correo, teléfono) están en `EMPRESA`, al principio del `<script>` de `test-cliente/index.html`.
- Para volver a vender suscripciones: `SUSCRIPCIONES_ACTIVAS=true` en el portal y el secreto `SUSCRIPCIONES_ACTIVAS=1` en la función `pago`.
- Los clientes que ya tienen un plan mensual lo conservan y pueden darse de baja como siempre.

## 19. Guía para empleados

Dentro del panel, botón **❓** de la barra lateral (encima de «Cerrar sesión»). Se abre sola la primera vez que entra cada persona.
Tiene buscador y secciones paso a paso: el día a día, el pipeline, responder casos, urgencias, clientes, entregas, pagos, renovaciones, bóveda, valoraciones, atajos y «¿Qué hago si…?».
Para cambiar el texto: en `index.html`, busca `const GUIA = [`.

## 20. Ficha del cliente automática

`supabase_ficha_auto.sql` (ya aplicado) y las funciones `medir`, `pago` y `wp` (ya desplegadas) rellenan la ficha solas:
- **Plan**: cuando un servicio de mantenimiento o renting pasa a «activo».
- **Tokens incluidos**: según el plan (Negocio › 💶 Precios › tokens/mes).
- **Cambios completados y tokens usados del mes**: con los casos cerrados como Aceptado; en cada caso hay un campo «Tokens gastados».
- **Mensaje de estado y recomendación**: los escribe la medición (se pueden poner a mano desmarcando «Automático»).
- **Renovaciones de dominio y SSL**: con la fecha de caducidad (el dominio solo si su registro la publica; los .es no lo hacen).
- **Método de pago**: la tarjeta con la que paga en el portal.
- **WordPress**: plugin `wordpress/webcare-conector.zip`. En la ficha › «Conectar WordPress» se genera la clave; se instala el plugin en su web y se pega en Ajustes › Velority. Envía cada día actualizaciones, ataques y amenazas (con Wordfence) y copias (con UpdraftPlus).

## 21. Plan Tienda, entrar sin contraseña, recomendaciones y vista previa

**Pendiente:** ejecuta `supabase_crecimiento.sql` en el SQL Editor (la función `correo` ya está desplegada). Añade:
- **Mantenimiento Tienda**: 89 €/mes o 890 €/año, 3 tokens/mes, urgencias en 4 h. Su precio se cambia en Negocio › 💶 Precios.
- **Entrar sin contraseña**: en el acceso del portal, «✉️ Entrar sin contraseña» envía un enlace (Brevo) que vale 15 minutos y una sola vez.
- **Recomienda y gana**: cada cliente tiene su enlace en «Mi cuenta». Cuando alguien se registra con él y contrata (caso aceptado o pedido pagado), quien recomendó gana **1 token de regalo** que no caduca. En el panel lo ves en la ficha del cliente («Recomendaciones») y lo restas en «Editar ficha» › «Tokens de regalo».
- **Propiedad de la web**: pago único = suya desde el primer día; renting = suya al completar 24 cuotas (o antes, pagando las que falten); dominio siempre a su nombre. Está en la portada, el registro, las preguntas frecuentes y «Condiciones» (pie de página). Los clientes de renting ven en «Servicios» cuántas cuotas llevan.
- **Diseña tu web (vista previa de 10 minutos)**: botón «🎨 Diseña la tuya gratis» en la portada y «▶ Pruébala 10 minutos» en cada sector. El visitante elige entre **6 sectores** (reformas, estética, restaurante, clínica, tienda online y despacho profesional) y **5 estilos** (Moderno, Elegante, Minimal, Oscuro y Cálido), pone su nombre, frase, ciudad, teléfono, logo y color, quita secciones y lo ve en ordenador, tablet o móvil. Cada web de ejemplo es completa e interactiva (presupuesto, reservas, carta con QR, cita, carrito, test de caso). Plantilla: `plantillas/plantilla.html` (los textos de cada sector están en `const S`). Al acabar los 10 minutos (o al pulsar «Quiero esta web») se registra o pide presupuesto, y el equipo recibe en el chat el sector, el estilo y los datos que puso.

## 22. Publicar

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
