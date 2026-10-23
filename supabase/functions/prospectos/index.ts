// Edge Function "prospectos": busca negocios de España sin página web propia y los guarda en la tabla «prospectos».
// Fuente: Google Maps si existe el secreto GOOGLE_PLACES_KEY (recomendado); si no, OpenStreetMap (datos públicos, sin clave).
//   · accion "auto"   (panel)  {forzar?}          → recorre tipos de negocio y ciudades de España, uno por llamada (como mucho cada 6 h)
//   · accion "buscar" (panel)  {zona, negocio?}   → busca en una ciudad o zona concreta
//   · accion "correos" (panel) {ids?}             → busca el correo de los negocios que no lo tienen (hasta 8 por llamada)
// Correos: Google Maps no los da. Primero se mira su página de enlaces (Linktree, business.site…) si la tiene; después, con el
// secreto BRAVE_SEARCH_KEY, se busca en toda la web con Brave Search (nombre + ciudad, su teléfono y correos de Gmail/Hotmail…
// con su nombre): el correo suele salir en Facebook, Instagram, directorios, asociaciones, prensa local…
// Solo se acepta un correo que aparezca junto al nombre o el teléfono del negocio. Límite: LIMITE_BRAVE búsquedas al mes
// (servidor_gastar_cupo, supabase_prospectos_correos.sql), por debajo del crédito gratuito mensual de Brave.
// Límite de Google: como mucho LIMITE_GOOGLE peticiones al mes (el plan gratuito de estos datos es de 1.000); al llegar,
// la función deja de llamar a Google hasta el mes siguiente. Lo cuenta servidor_gastar_google (supabase_prospectos.sql).
// Despliegue: nombre "prospectos" y DESACTIVA «Verify JWT» (la función comprueba ella misma quién llama).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Ciudades que recorre la búsqueda automática (nombre en español, como en OpenStreetMap «name:es»/«name»)
const CIUDADES = ["Gandía", "Alzira", "Sagunto", "Torrent", "Paterna", "Castellón de la Plana", "Elche", "Alicante", "Benidorm", "Murcia",
  "Cartagena", "Albacete", "Valencia", "Getafe", "Alcalá de Henares", "Móstoles", "Leganés", "Fuenlabrada", "Alcorcón", "Madrid",
  "Toledo", "Guadalajara", "Zaragoza", "Logroño", "Pamplona", "Vitoria-Gasteiz", "Bilbao", "San Sebastián", "Santander", "Oviedo", "Gijón",
  "León", "Burgos", "Valladolid", "Salamanca", "Cáceres", "Badajoz", "Córdoba", "Jaén", "Granada", "Almería", "Málaga", "Marbella",
  "Sevilla", "Huelva", "Cádiz", "Jerez de la Frontera", "Algeciras", "Palma", "Las Palmas de Gran Canaria", "Santa Cruz de Tenerife",
  "Tarragona", "Reus", "Lleida", "Girona", "Sabadell", "Terrassa", "Badalona", "Mataró", "Barcelona", "A Coruña", "Vigo", "Ourense", "Lugo"];

// Tipos de negocio que recorre la búsqueda automática con Google Maps (en cada ciudad, todos los tipos)
const BUSQUEDAS = ["Peluquería", "Barbería", "Centro de estética", "Taller mecánico", "Fisioterapia", "Clínica dental", "Restaurante",
  "Cafetería", "Panadería", "Floristería", "Fontanero", "Electricista", "Academia", "Gimnasio", "Inmobiliaria", "Veterinario",
  "Autoescuela", "Tienda de ropa", "Carpintería", "Reformas"];

// Qué es cada negocio, en español (etiquetas de OpenStreetMap)
const TIPOS: Record<string, string> = {
  hairdresser: "Peluquería", beauty: "Centro de estética", clothes: "Tienda de ropa", shoes: "Zapatería", bakery: "Panadería",
  pastry: "Pastelería", butcher: "Carnicería", greengrocer: "Frutería", florist: "Floristería", optician: "Óptica", jewelry: "Joyería",
  furniture: "Tienda de muebles", hardware: "Ferretería", doityourself: "Ferretería", bicycle: "Tienda de bicis", car_repair: "Taller mecánico",
  car: "Concesionario", car_parts: "Recambios", tyres: "Neumáticos", toys: "Juguetería", books: "Librería", sports: "Tienda de deportes",
  mobile_phone: "Tienda de móviles", computer: "Informática", electronics: "Electrónica", photo: "Fotografía", pet: "Tienda de animales",
  gift: "Tienda de regalos", deli: "Charcutería", seafood: "Pescadería", wine: "Vinoteca", alcohol: "Bodega", tobacco: "Estanco",
  stationery: "Papelería", copyshop: "Copistería", laundry: "Lavandería", dry_cleaning: "Tintorería", tattoo: "Estudio de tatuajes",
  cosmetics: "Perfumería", perfumery: "Perfumería", interior_decoration: "Decoración", kitchen: "Cocinas", bed: "Colchonería",
  garden_centre: "Vivero", music: "Tienda de música", travel_agency: "Agencia de viajes", massage: "Masajes", nutrition_supplements: "Dietética",
  restaurant: "Restaurante", cafe: "Cafetería", bar: "Bar", dentist: "Clínica dental", clinic: "Clínica", veterinary: "Veterinario",
  driving_school: "Autoescuela", estate_agent: "Inmobiliaria", lawyer: "Abogados", accountant: "Asesoría", insurance: "Seguros",
  fitness_centre: "Gimnasio", physiotherapist: "Fisioterapia", podiatrist: "Podología", psychotherapist: "Psicología",
  carpenter: "Carpintería", electrician: "Electricista", plumber: "Fontanería", painter: "Pintor", photographer: "Fotógrafo",
  shoemaker: "Zapatero", tailor: "Sastrería", locksmith: "Cerrajería", glaziery: "Cristalería", upholsterer: "Tapicería",
};

// El nombre del pueblo sin importar tildes ni mayúsculas, y también dentro de nombres dobles («Elx/Elche», «Donostia/San Sebastián»)
function patronZona(zona: string) {
  const VOC: Record<string, string> = { a: "[aáà]", e: "[eéè]", i: "[iíïì]", o: "[oóò]", u: "[uúüù]", n: "[nñ]", c: "[cç]" };
  const base = norm(zona).replace(/[^a-z0-9 '·-]/g, "").trim().replace(/\s+/g, " ");
  return "(^|/)" + [...base].map((ch) => VOC[ch] || (ch === " " ? "[ -]" : ch)).join("") + "($|/| -)";
}
function consultaOSM(zona: string) {
  const z = patronZona(zona);
  const sinWeb = `["name"][!"website"][!"contact:website"][!"url"][!"brand"][!"brand:wikidata"]`;
  return `[out:json][timeout:50];area["ISO3166-1"="ES"]->.es;
(area["boundary"="administrative"]["admin_level"~"^(7|8|9|10)$"]["name"~"${z}",i](area.es);
 area["boundary"="administrative"]["admin_level"~"^(7|8|9|10)$"]["name:es"~"${z}",i](area.es);)->.c;
(nwr["shop"]${sinWeb}(area.c);nwr["craft"]${sinWeb}(area.c);
 nwr["amenity"~"^(restaurant|cafe|dentist|clinic|veterinary|driving_school)$"]${sinWeb}(area.c);
 nwr["office"~"^(estate_agent|lawyer|accountant|insurance)$"]${sinWeb}(area.c);
 nwr["leisure"="fitness_centre"]${sinWeb}(area.c);nwr["healthcare"]${sinWeb}(area.c););out center tags 600;`;
}
async function pedirOSM(zona: string) {
  const cuerpo = "data=" + encodeURIComponent(consultaOSM(zona));
  const fallos: string[] = [];
  const inicio = Date.now();
  // Los servidores públicos a veces están llenos (502/429/504): se prueban varios, con una pequeña espera entre uno y otro
  const servidores = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.osm.jp/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"];
  for (const [n, base] of servidores.entries()) {
    if (n) await new Promise((ok) => setTimeout(ok, 1500 * n));
    const queda = 130000 - (Date.now() - inicio);
    if (queda < 10000) break;
    const host = new URL(base).hostname;
    try {
      const r = await fetch(base, { method: "POST", body: cuerpo, signal: AbortSignal.timeout(Math.min(45000, queda)),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "Velority-panel/1.0 (contact-velority@velority.es)" } });
      if (r.ok) return ((await r.json()).elements || []) as Record<string, any>[];
      fallos.push(host + " " + r.status);
    } catch (e) { fallos.push(host + " " + String((e as Error)?.name || e)); }
  }
  console.error("OpenStreetMap: " + fallos.join(", "));
  throw new Error("Los servidores gratuitos de OpenStreetMap están saturados ahora mismo. Prueba en unos minutos o añade la clave de Google Maps (GOOGLE_PLACES_KEY).");
}
function filaOSM(el: Record<string, any>, zona: string, consulta: string) {
  const t = el.tags || {};
  const clave = t.shop || t.craft || t.amenity || t.office || t.healthcare || t.leisure || "";
  const categoria = TIPOS[clave] || (clave ? clave.replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase()) : "Negocio");
  const ciudad = t["addr:city"] || zona;
  const calle = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const direccion = [calle, [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const busca = [t.name, calle, ciudad].filter(Boolean).join(", ");
  return {
    place_id: "osm:" + el.type + "/" + el.id, nombre: String(t.name).slice(0, 300), categoria, direccion, ciudad,
    telefono: (t.phone || t["contact:phone"] || t["contact:mobile"] || "").split(";")[0].trim() || null,
    email: (t.email || t["contact:email"] || "").split(";")[0].trim().toLowerCase().slice(0, 320) || null,
    web_social: t["contact:instagram"] || t["contact:facebook"] || t.instagram || t.facebook || null,
    maps_url: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(busca),
    busqueda: consulta,
  };
}

// Google Maps (opcional, solo si hay clave): una «web» que es una red social o un directorio cuenta como «sin web»
const LIMITE_GOOGLE = 900;
const SOCIAL = /(facebook\.|instagram\.|fb\.(com|me)|linktr\.ee|tiktok\.|twitter\.|(^|\.)x\.com$|wa\.me|whatsapp\.|business\.site$|g\.page|tripadvisor\.|paginasamarillas\.|eltenedor\.|thefork\.|booksy\.|treatwell\.|glovoapp\.|just-eat\.|ubereats\.)/i;
const CAMPOS = ["places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.nationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri", "places.rating", "places.userRatingCount", "places.primaryTypeDisplayName",
  "places.businessStatus", "nextPageToken"].join(",");
async function pedirGoogle(db: any, clave: string, negocio: string, zona: string, consulta: string, paginas = 3) {
  let pageToken = "", total = 0, conWeb = 0, uso = 0;
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < paginas; i++) {
    // Antes de cada petición: si ya se ha llegado al límite del mes, no se llama a Google
    const { data: n, error: e } = await db.rpc("servidor_gastar_google", { p_max: LIMITE_GOOGLE });
    if (e) throw new Error("No se pudo comprobar el límite de Google: " + e.message);
    if (n === -1) {
      if (i === 0) throw new Error(`Límite gratuito de Google Maps alcanzado este mes (${LIMITE_GOOGLE} búsquedas). Se reanuda el día 1; mientras tanto no se gasta nada.`);
      uso = LIMITE_GOOGLE; break;
    }
    uso = n;
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": clave, "X-Goog-FieldMask": CAMPOS },
      body: JSON.stringify({ textQuery: consulta, languageCode: "es", regionCode: "ES", pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Google Maps no ha respondido (" + r.status + "): " + (j?.error?.message || "revisa la clave"));
    for (const p of (j.places || []) as Record<string, any>[]) {
      total++;
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      const web = String(p.websiteUri || "");
      let host = ""; try { host = web ? new URL(web).hostname : ""; } catch (_) { host = ""; }
      if (web && !SOCIAL.test(host)) { conWeb++; continue; }
      const comp = (p.addressComponents || []) as Record<string, any>[];
      filas.push({
        place_id: p.id, nombre: String(p.displayName?.text || "Sin nombre").slice(0, 300), categoria: p.primaryTypeDisplayName?.text || negocio || "Negocio",
        direccion: p.formattedAddress || null, ciudad: (comp.find((c) => (c.types || []).includes("locality")) || {}).longText || zona,
        telefono: p.nationalPhoneNumber || null, maps_url: p.googleMapsUri || null,
        valoracion: typeof p.rating === "number" ? Math.round(p.rating * 10) / 10 : null, n_resenas: p.userRatingCount ?? null,
        web_social: web || null, busqueda: consulta,
      });
    }
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }
  return { filas, total, conWeb, uso };
}

// ---------- Correos con Brave Search ----------
const LIMITE_BRAVE = 900, POR_LLAMADA = 8;
const RE_CORREO = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Correos que no son del negocio: los de las propias webs y directorios, ejemplos, imágenes…
const CORREO_NO = /@(.*\.)?(facebook|instagram|google|example|sentry|wixpress|paginasamarillas|infoisinfo|cylex|yelp|tripadvisor|einforma|axesor|empresite|guiaempresa|qdq|habitissimo|brave|domain|tudominio|sudominio|email|correo)\.|\.(png|jpe?g|gif|webp|svg)$|^(noreply|no-reply|privacy|abuse|webmaster|postmaster)@/i;
const GENERICAS = new Set(["peluqueria", "barberia", "centro", "estetica", "taller", "mecanico", "fisioterapia", "clinica", "dental", "restaurante",
  "cafeteria", "panaderia", "floristeria", "fontanero", "fontaneria", "electricista", "academia", "gimnasio", "inmobiliaria", "veterinario",
  "veterinaria", "autoescuela", "tienda", "ropa", "carpinteria", "reformas", "bar", "casa", "arte", "floral", "salon", "beauty", "hair", "studio", "estudio"]);
const plano = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
async function brave(clave: string, q: string, intento = 0): Promise<{ url: string; texto: string }[]> {
  const u = "https://api.search.brave.com/res/v1/web/search?" + new URLSearchParams({ q, country: "ES", search_lang: "es", count: "20", extra_snippets: "true" });
  const r = await fetch(u, { headers: { Accept: "application/json", "X-Subscription-Token": clave } });
  if (r.status === 429 && intento < 2) { await espera(1500); return brave(clave, q, intento + 1); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Brave Search no ha respondido (" + r.status + "): " + (j?.error?.detail || j?.message || "revisa la clave BRAVE_SEARCH_KEY"));
  return ((j.web?.results || []) as Record<string, any>[]).map((x) => ({
    url: String(x.url || ""), texto: [x.title, x.description, ...(x.extra_snippets || [])].join(" ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " "),
  }));
}
// Su propia página de enlaces (Linktree, business.site…): si tiene correo, es suyo. Facebook e Instagram no se abren
// (no permiten la lectura automática): de esas solo se usa lo que muestran los buscadores.
const PAGINA_PROPIA = /(^|\.)(linktr\.ee|business\.site|carrd\.co|beacons\.ai|bio\.link|linkin\.bio|taplink\.cc|wixsite\.com|blogspot\.com|wordpress\.com|webnode\.es|jimdosite\.com|site123\.me)$/i;
async function correoDePagina(url: string) {
  let host = ""; try { host = new URL(url).hostname; } catch (_) { return null; }
  if (!PAGINA_PROPIA.test(host)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Velority-panel/1.0 (contact-velority@velority.es)", Accept: "text/html" } });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 400000).replace(/&#64;|\[at\]|\(at\)/gi, "@");
    const c = [...new Set((html.match(RE_CORREO) || []).map((x) => x.toLowerCase()))].find((x) => !CORREO_NO.test(x));
    return c ? { email: c, fuente: url } : null;
  } catch (_) { return null; }
}
// Elige el correo que aparece junto al nombre (palabras propias, no «peluquería») o el teléfono del negocio
function elegirCorreo(p: Record<string, any>, res: { url: string; texto: string }[]) {
  const palabras = plano(p.nombre).split(" ").filter((w) => w.length >= 4 && !GENERICAS.has(w));
  const tel = String(p.telefono || "").replace(/\D/g, "").slice(-9);
  const ciudad = plano(p.ciudad || "");
  const puntos = new Map<string, { n: number; url: string }>();
  for (const r of res) {
    const t = plano(r.texto), digitos = r.texto.replace(/\D/g, "");
    const conTel = tel.length === 9 && digitos.includes(tel);
    const conNombre = palabras.length ? palabras.every((w) => t.includes(w)) : false;
    for (const c of new Set((r.texto.match(RE_CORREO) || []).map((x) => x.toLowerCase().replace(/\.$/, "")))) {
      if (CORREO_NO.test(c)) continue;
      const enCorreo = palabras.some((w) => c.replace(/[^a-z0-9]/g, "").includes(w));
      let n = (conTel ? 4 : 0) + (conNombre ? 3 : 0) + (enCorreo ? 3 : 0) + (ciudad && t.includes(ciudad) ? 1 : 0);
      if (!conTel && !conNombre && !enCorreo) n = 0;
      const prev = puntos.get(c);
      if (n && (!prev || n > prev.n)) puntos.set(c, { n: (prev ? Math.max(prev.n, n) : n), url: r.url });
      else if (n && prev) prev.n += 1;   // aparece en varios resultados
    }
  }
  const mejor = [...puntos.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return mejor && mejor[1].n >= 4 ? { email: mejor[0], fuente: mejor[1].url } : null;
}
async function buscarCorreos(db: any, clave: string, ids?: number[]) {
  let q = db.from("prospectos").select("id,nombre,ciudad,telefono,web_social").is("email", null).is("correo_buscado_en", null).eq("estado", "nuevo")
    .order("creado_en", { ascending: false }).limit(POR_LLAMADA);
  if (ids?.length) q = db.from("prospectos").select("id,nombre,ciudad,telefono,web_social").in("id", ids.slice(0, POR_LLAMADA)).is("email", null);
  const { data: lista, error } = await q;
  if (error) throw error;
  let encontrados = 0, buscados = 0, uso = 0, agotado = false;
  for (const p of (lista || []) as Record<string, any>[]) {
    // 1) su página de enlaces; 2) toda la web: nombre + ciudad; 3) su teléfono; 4) correos de Gmail, Hotmail… con su nombre
    const consultas = [`${p.nombre} ${p.ciudad || ""} email correo contacto`];
    if (p.telefono) consultas.push(`"${String(p.telefono).replace(/\s+/g, " ")}" email`);
    consultas.push(`"${p.nombre}" ${p.ciudad || ""} "@gmail.com" OR "@hotmail.com" OR "@outlook.es" OR "@hotmail.es" OR "@yahoo.es"`);
    let hallado: { email: string; fuente: string } | null = p.web_social ? await correoDePagina(p.web_social) : null;
    for (const c of hallado ? [] : consultas) {
      const { data: n } = await db.rpc("servidor_gastar_cupo", { p_clave: "brave_search_uso", p_max: LIMITE_BRAVE });
      if (n === -1) { agotado = true; break; }
      uso = n;
      hallado = elegirCorreo(p, await brave(clave, c));
      await espera(1100);   // el plan de Brave admite 1 búsqueda por segundo
      if (hallado) break;
    }
    if (agotado) break;
    buscados++;
    if (hallado) encontrados++;
    await db.from("prospectos").update({ correo_buscado_en: new Date().toISOString(), ...(hallado ? { email: hallado.email, correo_fuente: hallado.fuente.slice(0, 500) } : {}) }).eq("id", p.id);
  }
  const { count } = await db.from("prospectos").select("id", { count: "exact", head: true }).is("email", null).is("correo_buscado_en", null).eq("estado", "nuevo");
  return { buscados, encontrados, pendientes: count || 0, uso_brave: uso, limite_brave: LIMITE_BRAVE, agotado };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    const { data: yo } = user?.email
      ? await admin.from("staff").select("usuario").eq("email", user.email.toLowerCase()).maybeSingle()
      : { data: null };
    if (!yo) return responder({ error: "Sesión no válida." }, 401);

    const cuerpo = await req.json().catch(() => ({}));
    let zona = "", negocio = "", fuente = "OpenStreetMap";
    let estadoAuto: Record<string, any> | null = null;

    if (cuerpo.accion === "correos") {
      const clave = env("BRAVE_SEARCH_KEY");
      if (!clave) return responder({ ok: true, sin_clave: true });
      const ids = Array.isArray(cuerpo.ids) ? cuerpo.ids.map(Number).filter(Boolean) : undefined;
      return responder({ ok: true, ...(await buscarCorreos(admin, clave, ids)) });
    }

    if (cuerpo.accion === "auto") {
      const { data: aj } = await admin.from("ajustes_web").select("valor").eq("clave", "prospectos_auto").maybeSingle();
      estadoAuto = (aj?.valor || {}) as Record<string, any>;
      const { count } = await admin.from("prospectos").select("id", { count: "exact", head: true }).eq("estado", "nuevo");
      const reciente = estadoAuto.ultimo && Date.now() - Date.parse(estadoAuto.ultimo) < 6 * 3600e3;
      if (!cuerpo.forzar && reciente && (count || 0) >= 20) return responder({ ok: true, saltado: true });
      const i = estadoAuto.i || 0;
      if (env("GOOGLE_PLACES_KEY")) {   // Google: todos los tipos de negocio en una ciudad y luego la siguiente
        zona = CIUDADES[Math.floor(i / BUSQUEDAS.length) % CIUDADES.length]; negocio = BUSQUEDAS[i % BUSQUEDAS.length];
      } else zona = CIUDADES[i % CIUDADES.length];
    } else if (cuerpo.accion === "buscar") {
      zona = String(cuerpo.zona || "").trim().slice(0, 80);
      negocio = String(cuerpo.negocio || "").trim().slice(0, 80);
      if (!zona) return responder({ error: "Escribe la ciudad o zona." }, 400);
    } else return responder({ error: "Acción desconocida." }, 400);

    const consulta = negocio ? `${negocio} en ${zona}` : `Negocios en ${zona}`;
    let filas: Record<string, any>[] = [], total = 0, conWeb = 0, uso: number | null = null;
    const claveGoogle = env("GOOGLE_PLACES_KEY");
    if (claveGoogle) {
      fuente = "Google Maps";
      ({ filas, total, conWeb, uso } = await pedirGoogle(admin, claveGoogle, negocio, zona, consulta, estadoAuto ? 2 : 3));
    } else {
      const els = (await pedirOSM(zona)).filter((e) => e.tags?.name && !e.tags?.disused && !e.tags?.["disused:shop"]);
      filas = els.map((e) => filaOSM(e, zona, consulta));
      if (negocio) { const n = norm(negocio); filas = filas.filter((f) => norm(f.categoria + " " + f.nombre).includes(n)); }
      total = filas.length;
    }
    // Primero los que tienen forma de contactarlos
    filas.sort((a, b) => (b.email ? 2 : 0) + (b.telefono ? 1 : 0) - (a.email ? 2 : 0) - (a.telefono ? 1 : 0));
    filas = filas.slice(0, 300);

    let nuevos = 0;
    if (filas.length) {
      // Los que ya estaban (por place_id) se dejan como están: no se pierde su estado ni sus notas
      const { data, error } = await admin.from("prospectos").upsert(filas, { onConflict: "place_id", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      nuevos = (data || []).length;
    }
    if (estadoAuto) {
      await admin.from("ajustes_web").upsert({ clave: "prospectos_auto", valor: { i: (estadoAuto.i || 0) + 1, ultimo: new Date().toISOString(), ultima_zona: zona }, actualizado_por: yo.usuario });
    }
    console.log(`Prospectos ${fuente} «${consulta}»: ${filas.length} sin web, ${nuevos} nuevos`);
    return responder({ ok: true, fuente, consulta, total, con_web: conWeb, sin_web: filas.length, nuevos, repetidos: filas.length - nuevos,
      con_contacto: filas.filter((f) => f.telefono || f.email).length, uso_google: uso, limite_google: LIMITE_GOOGLE });
  } catch (e) {
    console.error(String((e as Error)?.message || e));
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
