// Edge Function "enlaces": busca enlaces rotos y errores 404 en la web de un cliente.
// Recorre hasta 40 páginas de la propia web y comprueba cada enlace e imagen (hasta 300).
// Cuenta como roto: 404, 410, errores 5xx o un dominio que no existe. No cuenta 401/403/429 (webs que bloquean robots).
//   · Cada hora (pg_cron → lanzar_funcion('enlaces')): revisa UNA web, la que lleve más tiempo sin revisar
//     (cada web se revisa como mucho una vez cada 25 días), para no pasarse del tiempo máximo de la función.
//   · Desde el panel (botón «Revisar enlaces ahora»): { cliente_id }.
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "enlaces", y DESACTIVA «Verify JWT».
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const MAX_PAGINAS = 40, MAX_ENLACES = 300, A_LA_VEZ = 6, TIEMPO_MAX = 110000, DIAS_ENTRE_REVISIONES = 25;
const UA = { "User-Agent": "WebcareLinkCheck/1.0 (+revision de enlaces rotos)" };

async function conTiempo<T>(ms: number, f: (s: AbortSignal) => Promise<T>) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await f(ac.signal); } finally { clearTimeout(t); }
}
const host = (u: URL) => u.hostname.replace(/^www\./, "").toLowerCase();
function normal(href: string, base: URL) {
  try {
    const u = new URL(href.trim().replace(/&amp;/g, "&"), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u;
  } catch { return null; }
}
const enlacesDe = (html: string) => [...html.matchAll(/<(?:a|link)\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["']|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
  .map((m) => ({ url: m[1] || m[2], tipo: m[1] ? "enlace" : "imagen" }))
  .filter((x) => !/^(mailto|tel|javascript|data|whatsapp):/i.test(x.url));

async function estado(url: string): Promise<number | null> {
  try {
    let r = await conTiempo(8000, (signal) => fetch(url, { method: "HEAD", redirect: "follow", signal, headers: UA }));
    if (r.status === 405 || r.status === 501 || r.status === 403) {
      r = await conTiempo(10000, (signal) => fetch(url, { method: "GET", redirect: "follow", signal, headers: UA }));
      await r.body?.cancel();
    }
    return r.status;
  } catch (e) {
    const m = String((e as Error)?.message || e).toLowerCase();
    return /dns|not known|name or service|failed to lookup|no address/.test(m) ? 0 : null;   // 0 = el dominio no existe; null = no se pudo comprobar
  }
}
const roto = (c: number | null) => c === 0 || c === 404 || c === 410 || (c !== null && c >= 500);

async function revisar(db: SupabaseClient, c: { id: string; dominio: string }) {
  const inicio = Date.now();
  const raiz = new URL("https://" + c.dominio.replace(/^https?:\/\//, "").replace(/\/.*$/, "") + "/");
  const propio = host(raiz);
  const cola = [raiz.href], vistas = new Set<string>([raiz.href]);
  const enlaces = new Map<string, { pagina: string; tipo: string }>();
  let paginas = 0;
  const rotos: { url: string; codigo: number | null; pagina: string; tipo: string }[] = [];

  // 1) Recorre las páginas de la web
  while (cola.length && paginas < MAX_PAGINAS && Date.now() - inicio < TIEMPO_MAX / 2) {
    const url = cola.shift()!;
    let r: Response;
    try { r = await conTiempo(12000, (signal) => fetch(url, { redirect: "follow", signal, headers: UA })); }
    catch { if (url === raiz.href) throw new Error("La web no responde."); continue; }
    paginas++;
    if (roto(r.status) && url !== raiz.href) { await r.body?.cancel(); continue; }   // ya saldrá como enlace roto
    if (!(r.headers.get("content-type") || "").includes("text/html")) { await r.body?.cancel(); continue; }
    const html = (await r.text()).slice(0, 1500000);
    const base = new URL(r.url || url);
    for (const e of enlacesDe(html)) {
      const u = normal(e.url, base);
      if (!u) continue;
      if (!enlaces.has(u.href) && enlaces.size < MAX_ENLACES) enlaces.set(u.href, { pagina: url, tipo: e.tipo });
      if (e.tipo === "enlace" && host(u) === propio && !vistas.has(u.href) && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3|css|js|xml|ico)$/i.test(u.pathname)
          && !/\/(wp-admin|wp-login|feed|wp-json)\b/.test(u.pathname)) {
        vistas.add(u.href); cola.push(u.href);
      }
    }
  }
  // 2) Comprueba cada enlace (de A_LA_VEZ en A_LA_VEZ)
  const lista = [...enlaces.entries()];
  let i = 0;
  await Promise.all(Array.from({ length: A_LA_VEZ }, async () => {
    while (i < lista.length && Date.now() - inicio < TIEMPO_MAX) {
      const [url, info] = lista[i++];
      const cod = await estado(url);
      if (roto(cod)) rotos.push({ url, codigo: cod, pagina: info.pagina, tipo: info.tipo });
    }
  }));
  const cambios = {
    cliente_id: c.id, enlaces_revisado_en: new Date().toISOString(), enlaces_paginas: paginas,
    enlaces_rotos: rotos.sort((a, b) => a.pagina.localeCompare(b.pagina)).slice(0, 100),
  };
  const { error } = await db.from("webs_cliente").upsert(cambios, { onConflict: "cliente_id" });
  if (error) throw error;
  return { dominio: c.dominio, paginas, comprobados: Math.min(i, lista.length), rotos: rotos.length };
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

    if (esStaff && cuerpo.cliente_id) {
      const { data: c } = await db.from("clientes").select("id,dominio").eq("id", cuerpo.cliente_id).maybeSingle();
      if (!c?.dominio) return responder({ error: "Este cliente no tiene dominio en su ficha." }, 400);
      return responder({ ok: true, resultado: await revisar(db, c) });
    }
    // Automático: la web con plan que lleve más tiempo sin revisar
    const { data: webs } = await db.from("webs_cliente").select("cliente_id,enlaces_revisado_en").not("plan", "is", null)
      .order("enlaces_revisado_en", { ascending: true, nullsFirst: true }).limit(20);
    const limite = Date.now() - DIAS_ENTRE_REVISIONES * 86400000;
    for (const w of webs || []) {
      if (w.enlaces_revisado_en && new Date(w.enlaces_revisado_en).getTime() > limite) break;
      const { data: c } = await db.from("clientes").select("id,dominio").eq("id", w.cliente_id).maybeSingle();
      if (!c?.dominio) continue;
      try { return responder({ ok: true, resultado: await revisar(db, c) }); }
      catch (e) {
        await db.from("webs_cliente").update({ enlaces_revisado_en: new Date().toISOString() }).eq("cliente_id", c.id);
        return responder({ ok: false, dominio: c.dominio, error: String((e as Error)?.message || e) });
      }
    }
    return responder({ ok: true, resultado: "Nada pendiente." });
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
