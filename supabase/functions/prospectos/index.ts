// Edge Function "prospectos": busca negocios de España sin página web propia y los guarda en la tabla «prospectos».
// Fuente principal: OpenStreetMap (datos públicos, gratis, sin clave). Opcional: Google Maps si existe GOOGLE_PLACES_KEY.
//   · accion "auto"   (panel)  {forzar?}          → recorre ciudades de España, una por llamada (como mucho cada 6 h)
//   · accion "buscar" (panel)  {zona, negocio?}   → busca en una ciudad o zona concreta
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
  const q = encodeURIComponent(consultaOSM(zona));
  let ultimo = "";
  const inicio = Date.now();
  // El servidor público a veces está lleno (502/429): se reintenta con espera y se alterna con otro servidor
  const servidores = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter", "https://overpass-api.de/api/interpreter"];
  for (const [n, base] of servidores.entries()) {
    if (n) await new Promise((ok) => setTimeout(ok, 3000 * n));
    const queda = 130000 - (Date.now() - inicio);
    if (queda < 10000) break;
    try {
      const r = await fetch(base + "?data=" + q, { signal: AbortSignal.timeout(Math.min(55000, queda)), headers: { "User-Agent": "Velority-panel/1.0 (contact-velority@velority.es)" } });
      if (r.ok) return ((await r.json()).elements || []) as Record<string, any>[];
      ultimo = "OpenStreetMap ocupado (" + r.status + ")";
    } catch (e) { ultimo = "OpenStreetMap no responde (" + String((e as Error)?.name || e) + ")"; }
  }
  throw new Error(ultimo + ". Prueba otra vez en un minuto.");
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
const SOCIAL = /(facebook\.|instagram\.|fb\.(com|me)|linktr\.ee|tiktok\.|twitter\.|(^|\.)x\.com$|wa\.me|whatsapp\.|business\.site$|g\.page|tripadvisor\.|paginasamarillas\.|eltenedor\.|thefork\.|booksy\.|treatwell\.|glovoapp\.|just-eat\.|ubereats\.)/i;
const CAMPOS = ["places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.nationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri", "places.rating", "places.userRatingCount", "places.primaryTypeDisplayName",
  "places.businessStatus", "nextPageToken"].join(",");
async function pedirGoogle(clave: string, negocio: string, zona: string, consulta: string) {
  let pageToken = "", total = 0, conWeb = 0;
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < 3; i++) {
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
        place_id: p.id, nombre: String(p.displayName?.text || "Sin nombre").slice(0, 300), categoria: p.primaryTypeDisplayName?.text || negocio,
        direccion: p.formattedAddress || null, ciudad: (comp.find((c) => (c.types || []).includes("locality")) || {}).longText || zona,
        telefono: p.nationalPhoneNumber || null, maps_url: p.googleMapsUri || null,
        valoracion: typeof p.rating === "number" ? Math.round(p.rating * 10) / 10 : null, n_resenas: p.userRatingCount ?? null,
        web_social: web || null, busqueda: consulta,
      });
    }
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }
  return { filas, total, conWeb };
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

    if (cuerpo.accion === "auto") {
      const { data: aj } = await admin.from("ajustes_web").select("valor").eq("clave", "prospectos_auto").maybeSingle();
      estadoAuto = (aj?.valor || {}) as Record<string, any>;
      const { count } = await admin.from("prospectos").select("id", { count: "exact", head: true }).eq("estado", "nuevo");
      const reciente = estadoAuto.ultimo && Date.now() - Date.parse(estadoAuto.ultimo) < 6 * 3600e3;
      if (!cuerpo.forzar && reciente && (count || 0) >= 20) return responder({ ok: true, saltado: true, siguiente: CIUDADES[(estadoAuto.i || 0) % CIUDADES.length] });
      zona = CIUDADES[(estadoAuto.i || 0) % CIUDADES.length];
    } else if (cuerpo.accion === "buscar") {
      zona = String(cuerpo.zona || "").trim().slice(0, 80);
      negocio = String(cuerpo.negocio || "").trim().slice(0, 80);
      if (!zona) return responder({ error: "Escribe la ciudad o zona." }, 400);
    } else return responder({ error: "Acción desconocida." }, 400);

    const consulta = negocio ? `${negocio} en ${zona}` : `Negocios en ${zona}`;
    let filas: Record<string, any>[] = [], total = 0, conWeb = 0;
    const claveGoogle = env("GOOGLE_PLACES_KEY");
    if (claveGoogle && negocio) {
      fuente = "Google Maps";
      ({ filas, total, conWeb } = await pedirGoogle(claveGoogle, negocio, zona, consulta));
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
      con_contacto: filas.filter((f) => f.telefono || f.email).length });
  } catch (e) {
    console.error(String((e as Error)?.message || e));
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
