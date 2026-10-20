// Edge Function "google": rellena la parte SEO de la ficha con datos reales de Google.
//   · Search Console: clics, impresiones, palabras en primera página y las búsquedas principales con su posición.
//   · Analytics 4 (opcional, si la ficha tiene «ID de propiedad GA4»): visitas que llegan desde Google.
// Compara los últimos 28 días con los 28 anteriores (lo que el portal muestra como «% de cambio»).
//   · Cada lunes a las 6:30 (pg_cron → lanzar_funcion('google')): todas las webs.
//   · Desde el panel (botón «Actualizar desde Google»): { cliente_id }.
// Configuración (una vez, gratis):
//   1. Google Cloud > crea un proyecto > activa «Google Search Console API» y «Google Analytics Data API».
//   2. IAM > Cuentas de servicio > crea una > Claves > Añadir clave JSON.
//   3. Pega el JSON entero en Supabase > Edge Functions > Secrets como GOOGLE_SERVICE_ACCOUNT.
//   4. En cada web: Search Console > Configuración > Usuarios y permisos > añade el correo de la cuenta de servicio
//      (permiso «Restringido» basta). Para GA4: Administrar > Acceso a la propiedad > añade el mismo correo como «Lector».
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "google", y DESACTIVA «Verify JWT».
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------- Acceso con la cuenta de servicio (JWT firmado con RS256) ----------
let tokenCache: { token: string; caduca: number } | null = null;
async function tokenGoogle() {
  if (tokenCache && tokenCache.caduca > Date.now() + 60000) return tokenCache.token;
  const raw = env("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("SIN_CONFIGURAR");
  const sa = JSON.parse(raw);
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const clave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const ahora = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const cabecera = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const datos = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600,
    scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly",
  })));
  const firma = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, enc.encode(cabecera + "." + datos)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: cabecera + "." + datos + "." + firma }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google no acepta la cuenta de servicio: " + (j.error_description || j.error || r.status));
  tokenCache = { token: j.access_token, caduca: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}
async function api(url: string, cuerpo?: unknown) {
  const r = await fetch(url, {
    method: cuerpo ? "POST" : "GET",
    headers: { Authorization: "Bearer " + await tokenGoogle(), "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || "Google respondió " + r.status);
  return j;
}

// ---------- Fechas: últimos 28 días (Search Console va ~3 días por detrás) y los 28 anteriores ----------
const dia = (d: Date) => d.toISOString().slice(0, 10);
function periodos() {
  const fin = new Date(); fin.setUTCDate(fin.getUTCDate() - 3);
  const ini = new Date(fin); ini.setUTCDate(ini.getUTCDate() - 27);
  const finA = new Date(ini); finA.setUTCDate(finA.getUTCDate() - 1);
  const iniA = new Date(finA); iniA.setUTCDate(iniA.getUTCDate() - 27);
  return { act: { startDate: dia(ini), endDate: dia(fin) }, ant: { startDate: dia(iniA), endDate: dia(finA) }, fin };
}
const cambio = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0;

// ---------- Qué propiedad de Search Console corresponde a la web ----------
let sitiosCache: string[] | null = null;
async function propiedad(dominio: string, fija: string | null) {
  if (fija) return fija;
  if (!sitiosCache) sitiosCache = ((await api("https://www.googleapis.com/webmasters/v3/sites")).siteEntry || [])
    .filter((s: { permissionLevel: string }) => s.permissionLevel !== "siteUnverifiedUser").map((s: { siteUrl: string }) => s.siteUrl);
  const d = dominio.replace(/^www\./, "").toLowerCase();
  const candidatos = ["sc-domain:" + d, "https://" + d + "/", "https://www." + d + "/", "http://" + d + "/", "http://www." + d + "/"];
  const p = candidatos.find((c) => sitiosCache!.includes(c));
  if (!p) throw new Error("La cuenta de servicio no tiene acceso a " + d + " en Search Console (añádela como usuario de la propiedad).");
  return p;
}

async function actualizar(db: SupabaseClient, c: { id: string; dominio: string }, w: Record<string, unknown> | undefined) {
  const { act, ant, fin } = periodos();
  const prop = await propiedad(c.dominio, (w?.gsc_propiedad as string) || null);
  const base = "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(prop) + "/searchAnalytics/query";
  const [totA, totB, qA, qB] = await Promise.all([
    api(base, { ...act }), api(base, { ...ant }),
    api(base, { ...act, dimensions: ["query"], rowLimit: 1000 }), api(base, { ...ant, dimensions: ["query"], rowLimit: 1000 }),
  ]);
  const t = (j: { rows?: { clicks: number; impressions: number }[] }) => j.rows?.[0] || { clicks: 0, impressions: 0 };
  const filasA: { keys: string[]; clicks: number; impressions: number; position: number }[] = qA.rows || [];
  const antes = new Map<string, number>((qB.rows || []).map((r: { keys: string[]; position: number }) => [r.keys[0], r.position]));
  const top = filasA.slice().sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 8);
  const cambios: Record<string, unknown> = {
    cliente_id: c.id,
    seo_clics: cambio(t(totA).clicks, t(totB).clicks),
    seo_impresiones: cambio(t(totA).impressions, t(totB).impressions),
    seo_visitas: cambio(t(totA).clicks, t(totB).clicks),
    seo_primera_pagina: filasA.filter((r) => r.position <= 10).length,
    seo_palabras: top.map((r) => ({ palabra: r.keys[0], antes: antes.has(r.keys[0]) ? Math.round(antes.get(r.keys[0])!) : null, ahora: Math.round(r.position) })),
    seo_periodo: "Últimos 28 días (hasta el " + fin.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ")",
    google_en: new Date().toISOString(), google_error: null,
  };
  const ga4 = String(w?.ga4_propiedad || "").replace(/\D/g, "");
  if (ga4) {
    const informe = await api("https://analyticsdata.googleapis.com/v1beta/properties/" + ga4 + ":runReport", {
      dateRanges: [act, ant], metrics: [{ name: "sessions" }],
      dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } },
    });
    let sA = 0, sB = 0;
    for (const r of informe.rows || []) {
      const v = Number(r.metricValues?.[0]?.value || 0);
      if (r.dimensionValues?.[0]?.value === "date_range_1") sB += v; else sA += v;
    }
    cambios.seo_visitas = cambio(sA, sB);
  }
  const { error } = await db.from("webs_cliente").upsert(cambios, { onConflict: "cliente_id" });
  if (error) throw error;
  return { dominio: c.dominio, propiedad: prop, ...cambios };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const cuerpo = await req.json().catch(() => ({}));
    const { data: aj } = await db.from("ajustes").select("valor").eq("clave", "secreto_cron").maybeSingle();
    const esCron = !!aj?.valor && req.headers.get("x-secreto") === aj.valor;
    let esStaff = false;
    if (!esCron) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await db.auth.getUser(token);
      if (user?.email) {
        const { data: s } = await db.from("staff").select("usuario").eq("email", user.email.toLowerCase()).maybeSingle();
        esStaff = !!s;
      }
    }
    if (!esCron && !esStaff) return responder({ error: "No autorizado." }, 401);

    const { data: clientes } = await db.from("clientes").select("id,dominio").not("dominio", "is", null);
    const { data: webs } = await db.from("webs_cliente").select("cliente_id,plan,gsc_propiedad,ga4_propiedad");
    const fichas = new Map((webs || []).map((w) => [w.cliente_id, w]));

    if (esStaff && cuerpo.cliente_id) {
      const c = (clientes || []).find((x) => x.id === cuerpo.cliente_id);
      if (!c) return responder({ error: "Este cliente no tiene dominio en su ficha." }, 400);
      try { return responder({ ok: true, resultado: await actualizar(db, c, fichas.get(c.id)) }); }
      catch (e) {
        const m = String((e as Error)?.message || e);
        if (m !== "SIN_CONFIGURAR") await db.from("webs_cliente").update({ google_error: m.slice(0, 300) }).eq("cliente_id", c.id);
        throw e;
      }
    }
    const resultados = [];
    for (const c of clientes || []) {
      if (!fichas.get(c.id)?.plan) continue;
      try { resultados.push(await actualizar(db, c, fichas.get(c.id))); }
      catch (e) {
        const m = String((e as Error)?.message || e);
        if (m === "SIN_CONFIGURAR") throw e;
        await db.from("webs_cliente").update({ google_error: m.slice(0, 300) }).eq("cliente_id", c.id);
        resultados.push({ dominio: c.dominio, error: m });
      }
    }
    return responder({ ok: true, actualizadas: resultados.filter((r) => !(r as { error?: string }).error).length, resultados });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "SIN_CONFIGURAR") return responder({ error: "Google no está configurado: falta el secreto GOOGLE_SERVICE_ACCOUNT (mira la GUIA)." }, 503);
    return responder({ error: msg }, 500);
  }
});
