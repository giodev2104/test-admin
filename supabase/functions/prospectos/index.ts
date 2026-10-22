// Edge Function "prospectos": busca en Google Maps (Places API, «Text Search») negocios de España y guarda en la
// tabla «prospectos» los que no tienen página web propia (sin web o solo con Facebook/Instagram).
//   · accion "buscar" (panel, sesión del staff) {negocio, zona, paginas?} → {nuevos, repetidos, con_web, total}
// Google no da el correo de los negocios: se apunta a mano en el panel (de su Instagram, Facebook…).
// Secreto (Edge Functions > Secrets): GOOGLE_PLACES_KEY = clave de Google Maps Platform con «Places API (New)» activada.
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
const CAMPOS = ["places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.nationalPhoneNumber",
  "places.websiteUri", "places.googleMapsUri", "places.rating", "places.userRatingCount", "places.primaryTypeDisplayName",
  "places.businessStatus", "nextPageToken"].join(",");
// Una «web» que en realidad es una red social o un directorio cuenta como «sin web propia»
const SOCIAL = /(facebook\.|instagram\.|fb\.(com|me)|linktr\.ee|tiktok\.|twitter\.|(^|\.)x\.com$|wa\.me|whatsapp\.|business\.site$|g\.page|tripadvisor\.|paginasamarillas\.|eltenedor\.|thefork\.|booksy\.|treatwell\.|glovoapp\.|just-eat\.|ubereats\.)/i;

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
    if (cuerpo.accion !== "buscar") return responder({ error: "Acción desconocida." }, 400);
    const clave = env("GOOGLE_PLACES_KEY");
    if (!clave) return responder({ error: "Falta el secreto GOOGLE_PLACES_KEY en Supabase (Edge Functions > Secrets)." }, 503);
    const negocio = String(cuerpo.negocio || "").trim().slice(0, 80), zona = String(cuerpo.zona || "").trim().slice(0, 80);
    if (!negocio || !zona) return responder({ error: "Escribe el tipo de negocio y la ciudad o zona." }, 400);
    const paginas = Math.min(3, Math.max(1, Number(cuerpo.paginas) || 1));   // 20 negocios por página, máximo 60
    const consulta = `${negocio} en ${zona}`;

    let pageToken = "", total = 0, conWeb = 0;
    const filas: Record<string, unknown>[] = [];
    for (let i = 0; i < paginas; i++) {
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": clave, "X-Goog-FieldMask": CAMPOS },
        body: JSON.stringify({ textQuery: consulta, languageCode: "es", regionCode: "ES", pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("Places " + r.status + ": " + JSON.stringify(j).slice(0, 500));
        return responder({ error: "Google Maps no ha respondido (" + r.status + "): " + (j?.error?.message || "revisa la clave y que «Places API (New)» esté activada") }, 502);
      }
      for (const p of (j.places || []) as Record<string, any>[]) {
        total++;
        if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
        let web = String(p.websiteUri || ""), host = "";
        try { host = web ? new URL(web).hostname : ""; } catch (_) { host = ""; }
        if (web && !SOCIAL.test(host)) { conWeb++; continue; }
        const comp = (p.addressComponents || []) as Record<string, any>[];
        const ciudad = (comp.find((c) => (c.types || []).includes("locality")) || comp.find((c) => (c.types || []).includes("administrative_area_level_2")) || {}).longText || zona;
        filas.push({
          place_id: p.id, nombre: String(p.displayName?.text || "Sin nombre").slice(0, 300), categoria: p.primaryTypeDisplayName?.text || negocio,
          direccion: p.formattedAddress || null, ciudad, telefono: p.nationalPhoneNumber || null, maps_url: p.googleMapsUri || null,
          valoracion: typeof p.rating === "number" ? Math.round(p.rating * 10) / 10 : null, n_resenas: p.userRatingCount ?? null,
          web_social: web || null, busqueda: consulta,
        });
      }
      pageToken = j.nextPageToken || "";
      if (!pageToken) break;
    }
    let nuevos = 0;
    if (filas.length) {
      // Los que ya estaban (por place_id) se dejan como están: no se pierde su estado ni sus notas
      const { data, error } = await admin.from("prospectos").upsert(filas, { onConflict: "place_id", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      nuevos = (data || []).length;
    }
    return responder({ ok: true, consulta, total, con_web: conWeb, sin_web: filas.length, nuevos, repetidos: filas.length - nuevos });
  } catch (e) {
    console.error(String((e as Error)?.message || e));
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
