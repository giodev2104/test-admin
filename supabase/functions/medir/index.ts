// Edge Function "medir": comprueba las webs de los clientes y rellena su ficha sola.
//   · Cada hora (pg_cron → lanzar_medicion): visita cada web → disponibilidad (% online 30 días) y SSL.
//   · Una vez al día por cliente: Google PageSpeed (gratis) → puntuación (0-100) y velocidad (s).
//   · Desde el panel (botón «Medir ahora», sesión del staff): mide un cliente al momento.
// Solo mide clientes con dominio y con «Medición automática» activada en su ficha.
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "medir",
// y DESACTIVA «Verify JWT». Opcional: secreto PAGESPEED_API_KEY (más cupo en Google).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PAGESPEED_POR_RONDA = 3;          // PageSpeed tarda; como mucho 3 webs por ejecución horaria
const HORAS_ENTRE_PAGESPEED = 20;

async function conTiempo<T>(ms: number, f: (s: AbortSignal) => Promise<T>) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await f(ac.signal); } finally { clearTimeout(t); }
}

async function visitar(dominio: string) {
  const inicio = Date.now();
  try {
    const r = await conTiempo(15000, (signal) => fetch("https://" + dominio, { redirect: "follow", signal, headers: { "User-Agent": "WebcareMonitor/1.0" } }));
    await r.body?.cancel();
    return { ok: r.status < 500, codigo: r.status, ms: Date.now() - inicio, ssl: true };
  } catch (e) {
    const m = String((e as Error)?.message || e).toLowerCase();
    return { ok: false, codigo: null, ms: Date.now() - inicio, ssl: /cert|ssl|tls/.test(m) ? false : null };
  }
}

async function pagespeed(dominio: string) {
  const clave = Deno.env.get("PAGESPEED_API_KEY");
  const url = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&category=performance&url="
    + encodeURIComponent("https://" + dominio) + (clave ? "&key=" + clave : "");
  const r = await conTiempo(90000, (signal) => fetch(url, { signal }));
  if (!r.ok) return null;
  const j = await r.json();
  const score = j?.lighthouseResult?.categories?.performance?.score;
  const lcp = j?.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
  if (typeof score !== "number") return null;
  return { puntuacion: Math.round(score * 100), velocidad: typeof lcp === "number" ? Math.round(lcp / 100) / 10 : null };
}

async function medirCliente(db: SupabaseClient, c: { id: string; dominio: string }, w: Record<string, unknown> | undefined, conPageSpeed: boolean) {
  const v = await visitar(c.dominio);
  await db.from("comprobaciones").insert({ cliente_id: c.id, ok: v.ok, codigo: v.codigo, ms: v.ms });
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: hist } = await db.from("comprobaciones").select("ok").eq("cliente_id", c.id).gte("creado_en", desde);
  const total = hist?.length || 0, buenas = (hist || []).filter((h) => h.ok).length;
  const cambios: Record<string, unknown> = { cliente_id: c.id, revisado_en: new Date().toISOString() };
  if (total) cambios.disponibilidad = Math.round((buenas / total) * 10000) / 100;
  if (v.ssl !== null) cambios.ssl_activo = v.ssl;
  if (conPageSpeed) {
    const ps = await pagespeed(c.dominio).catch(() => null);
    if (ps) Object.assign(cambios, ps, { pagespeed_en: new Date().toISOString() });
  }
  const { error } = await db.from("webs_cliente").upsert(cambios, { onConflict: "cliente_id" });
  if (error) throw error;
  return { dominio: c.dominio, online: v.ok, ...cambios };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const cuerpo = await req.json().catch(() => ({}));

    // ¿Quién llama? El cron (cabecera x-secreto) o alguien del equipo (botón «Medir ahora»)
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
    const { data: webs } = await db.from("webs_cliente").select("cliente_id,medir_auto,pagespeed_en");
    const fichas = new Map((webs || []).map((w) => [w.cliente_id, w]));

    if (esStaff && cuerpo.cliente_id) {
      const c = (clientes || []).find((x) => x.id === cuerpo.cliente_id);
      if (!c) return responder({ error: "Este cliente no tiene dominio en su ficha." }, 400);
      return responder({ ok: true, resultado: await medirCliente(db, c, fichas.get(c.id), true) });
    }

    const lista = (clientes || []).filter((c) => fichas.get(c.id)?.medir_auto !== false);
    let pendientesPS = PAGESPEED_POR_RONDA;
    const resultados = [];
    for (const c of lista) {
      const w = fichas.get(c.id);
      const tocaPS = pendientesPS > 0 && (!w?.pagespeed_en || Date.now() - new Date(w.pagespeed_en).getTime() > HORAS_ENTRE_PAGESPEED * 3600000);
      if (tocaPS) pendientesPS--;
      try { resultados.push(await medirCliente(db, c, w, tocaPS)); }
      catch (e) { resultados.push({ dominio: c.dominio, error: String((e as Error)?.message || e) }); }
    }
    await db.from("comprobaciones").delete().lt("creado_en", new Date(Date.now() - 35 * 86400000).toISOString());
    return responder({ ok: true, medidas: resultados.length, resultados });
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
