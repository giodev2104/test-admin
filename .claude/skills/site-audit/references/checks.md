# Las 17 comprobaciones

Cada comprobación: **PASS** (cumple), **PARTIAL** (cumple a medias) o **FAIL** (no cumple). La nota debe decir qué se ha visto.

## Accesibilidad (A)

**A1 · Idioma de la página**
- PASS: `<html lang="es">` (o el idioma real del contenido).
- PARTIAL: `lang` presente pero no coincide con el idioma del contenido.
- FAIL: sin atributo `lang`.

**A2 · Texto alternativo en imágenes**
- PASS: ≥ 95 % de las `<img>` tienen `alt` (las decorativas con `alt=""`).
- PARTIAL: 70-95 %.
- FAIL: < 70 %, o logotipo/imágenes con texto sin alt.

**A3 · Estructura de encabezados**
- PASS: un único `<h1>` y sin saltos de nivel (h1 → h2 → h3).
- PARTIAL: varios `<h1>` o algún salto de nivel.
- FAIL: sin `<h1>`, o encabezados usados solo como estilo.

**A4 · Formularios, botones y enlaces con nombre**
- PASS: todos los campos con `<label>` o `aria-label`; botones y enlaces con texto o `aria-label` (iconos incluidos).
- PARTIAL: algún campo, botón-icono o enlace sin nombre accesible.
- FAIL: la mayoría sin nombre, o formularios solo con `placeholder`.

**A5 · Declaración y ayudas de accesibilidad**
- PASS: enlace a una declaración/página de accesibilidad y enlace «saltar al contenido» o landmarks (`<main>`, `<nav>`, `<header>`, `<footer>`).
- PARTIAL: hay landmarks pero no declaración (o al revés).
- FAIL: ni declaración ni landmarks.
- Nota: la declaración es obligatoria en el sector público (RD 1112/2018) y, desde el 28-06-2025, muchas tiendas online y servicios digitales deben cumplir los requisitos de accesibilidad (Ley 11/2023, que traspone el Acta Europea de Accesibilidad).

## Usabilidad (U)

**U1 · HTTPS**
- PASS: certificado válido y `http://` redirige a `https://`.
- PARTIAL: HTTPS funciona pero no redirige, o hay contenido mixto (recursos `http://`).
- FAIL: sin HTTPS o certificado inválido.

**U2 · Adaptada a móvil**
- PASS: `<meta name="viewport" content="width=device-width, initial-scale=1">` y diseño adaptable (media queries o framework responsive); si se comprueba con Playwright a 390 px, sin scroll horizontal.
- PARTIAL: viewport presente pero hay desbordes o texto diminuto.
- FAIL: sin viewport.

**U3 · Contacto visible**
- PASS: teléfono con enlace `tel:` o email con `mailto:`/formulario, y dirección u horario si es un negocio físico, accesibles desde la portada.
- PARTIAL: solo un medio de contacto, o sin enlaces pulsables.
- FAIL: no hay forma de contacto desde la portada.

**U4 · Navegación y servicios online**
- PASS: menú claro (`<nav>`), enlaces internos que funcionan y la acción principal (comprar, reservar, pedir cita, presupuesto) a un clic.
- PARTIAL: navegación confusa, enlaces rotos aislados o la acción principal escondida.
- FAIL: sin menú o con enlaces principales rotos.

## SEO (S)

**S1 · Título de la página**
- PASS: `<title>` único y descriptivo de 30-65 caracteres, con la actividad y la marca o la zona.
- PARTIAL: existe pero es genérico («Inicio», «Home»), demasiado corto o > 65 caracteres.
- FAIL: sin `<title>` o vacío.

**S2 · Meta description**
- PASS: 70-160 caracteres, propia de la página.
- PARTIAL: existe pero es demasiado corta/larga o genérica.
- FAIL: no existe.

**S3 · Indexable y canonical**
- PASS: sin `noindex`, con `<link rel="canonical">` correcto.
- PARTIAL: sin canonical, o canonical que apunta a otro dominio/versión.
- FAIL: `noindex` en la portada o robots.txt que bloquea todo (`Disallow: /`).

**S4 · robots.txt y sitemap.xml**
- PASS: `/robots.txt` existe y enlaza el sitemap; `/sitemap.xml` válido.
- PARTIAL: solo uno de los dos, o el sitemap no está enlazado.
- FAIL: ninguno de los dos.

**S5 · Vista previa al compartir (Open Graph)**
- PASS: `og:title`, `og:description` y `og:image` presentes.
- PARTIAL: alguno falta.
- FAIL: ninguno.

## GEO · Buscadores con IA (G)

**G1 · Datos estructurados (JSON-LD)**
- PASS: `<script type="application/ld+json">` válido con el tipo adecuado (LocalBusiness, Organization, Store, Restaurant, Product, FAQPage…) y datos clave (nombre, dirección, teléfono, horario, URL).
- PARTIAL: schema presente pero incompleto o de tipo poco específico.
- FAIL: sin datos estructurados.

**G2 · llms.txt**
- PASS: `/llms.txt` existe con un resumen del negocio y enlaces a las páginas clave.
- PARTIAL: existe pero vacío o sin estructura.
- FAIL: no existe (404).

**G3 · Rastreadores de IA**
- PASS: robots.txt no bloquea `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended` ni `CCBot`, y el contenido principal está en el HTML (no solo cargado por JavaScript).
- PARTIAL: bloquea alguno, o el contenido depende de JavaScript.
- FAIL: bloquea a todos los rastreadores de IA, o la página llega vacía sin JavaScript.
