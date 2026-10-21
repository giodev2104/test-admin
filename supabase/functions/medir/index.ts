// Edge Function "medir": comprueba las webs de los clientes y rellena su ficha sola.
//   · Cada hora (pg_cron → lanzar_medicion): visita cada web → disponibilidad (% online 30 días) y SSL.
//   · Una vez al día por cliente: Google PageSpeed (gratis) → puntuación (0-100), velocidad (s) y recomendación;
//     caducidad del dominio (RDAP) y del certificado SSL (crt.sh) → renovaciones automáticas.
//   · Mensaje de estado de «Mi web»: se escribe solo con lo medido (si está en automático en la ficha).
//   · Desde el panel (botón «Medir ahora», sesión del staff): mide un cliente al momento.
// Solo mide clientes con dominio y con «Medición automática» activada en su ficha.
// Si la web falla dos comprobaciones seguidas, abre una Incidencia (una sola a la vez) y avisa por
// correo a los propietarios (si Brevo está configurado); cuando vuelve a responder, lo anota en el caso.
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
    const r = await conTiempo(15000, (signal) => fetch("https://" + dominio, { redirect: "follow", signal, headers: { "User-Agent": "VelorityMonitor/1.0" } }));
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
  const audits = j?.lighthouseResult?.audits || {};
  const score = j?.lighthouseResult?.categories?.performance?.score;
  const lcp = audits["largest-contentful-paint"]?.numericValue;
  if (typeof score !== "number") return null;
  // La mejora con más ahorro que propone Google
  const mejora = Object.entries(audits as Record<string, any>)
    .filter(([id, a]) => CONSEJOS[id] && a?.details?.type === "opportunity" && (a.details.overallSavingsMs || 0) > 300)
    .sort((a, b) => b[1].details.overallSavingsMs - a[1].details.overallSavingsMs)[0];
  return { puntuacion: Math.round(score * 100), velocidad: typeof lcp === "number" ? Math.round(lcp / 100) / 10 : null, mejora: mejora ? mejora[0] : null };
}

// Mejoras de PageSpeed explicadas al cliente
const IMAGENES = "Las imágenes pesan más de lo necesario: optimizándolas, tu web cargaría bastante más rápido en el móvil.";
const CODIGO = "Tu web carga código que no utiliza: limpiándolo, cargaría más rápido.";
const CONSEJOS: Record<string, string> = {
  "render-blocking-resources": "Hay archivos que retrasan lo primero que ve tu visitante: cargándolos de otra forma, tu web se mostraría antes.",
  "uses-responsive-images": IMAGENES, "modern-image-formats": IMAGENES, "uses-optimized-images": IMAGENES, "offscreen-images": IMAGENES,
  "unused-javascript": CODIGO, "unused-css-rules": CODIGO, "unminified-javascript": CODIGO, "unminified-css": CODIGO,
  "server-response-time": "El servidor tarda en responder: con una caché o un alojamiento más rápido, tu web volaría.",
  "uses-text-compression": "Activando la compresión del servidor, tu web pesaría mucho menos.",
  "uses-long-cache-ttl": "Configurando la caché, las visitas que repiten verían tu web al instante.",
  "redirects": "Hay redirecciones que retrasan la carga: podemos eliminarlas.",
};
const coma = (n: number) => String(n).replace(".", ",");
function recomendacion(ps: { puntuacion: number; velocidad: number | null; mejora: string | null }) {
  const lenta = ps.velocidad !== null && ps.velocidad > 2.5 ? "Tu web tarda " + coma(ps.velocidad) + " s en cargar en el móvil. " : "";
  if (ps.mejora) return lenta + CONSEJOS[ps.mejora];
  if (lenta) return lenta + "Podemos dejarla por debajo de 2,5 s.";
  if (ps.puntuacion >= 90) return "Tu web es rápida (" + ps.puntuacion + "/100). El siguiente paso: mejorar tu posicionamiento en Google para que te encuentren más clientes.";
  return null;
}

// Mensaje de estado de «Mi web» con lo último medido
function resumen(w: Record<string, any>, online: boolean, sslCaduca: string | null) {
  const dias = sslCaduca ? Math.floor((new Date(sslCaduca).getTime() - Date.now()) / 86400000) : null;
  if (!online) return "Ahora mismo tu web no responde. Ya lo estamos revisando.";
  if (w.ssl_activo === false) return "Tu certificado de seguridad (SSL) no funciona. Ya lo estamos revisando.";
  if (dias !== null && dias < 0) return "Tu certificado de seguridad (SSL) ha caducado. Ya lo estamos renovando.";
  if ((w.amenazas || 0) > 0) return "Hemos detectado " + w.amenazas + (w.amenazas === 1 ? " amenaza" : " amenazas") + " en tu web y ya estamos actuando.";
  if (dias !== null && dias < 10) return "Tu web funciona con normalidad. Su certificado de seguridad caduca en " + dias + " días: lo renovamos a tiempo.";
  if (typeof w.disponibilidad === "number" && w.disponibilidad < 99) return "Tu web ha tenido algún corte este mes (" + coma(w.disponibilidad) + " % en línea). La estamos vigilando.";
  if (typeof w.velocidad === "number" && w.velocidad > 4) return "Tu web está segura y en línea, aunque carga algo lenta (" + coma(w.velocidad) + " s).";
  return "Tu web está segura y funcionando con normalidad.";
}

// Caducidad del dominio (RDAP, gratis; algunos dominios como .es no la publican)
function dominioRaiz(d: string) {
  const p = d.replace(/^www\./, "").split(".");
  return p.length > 2 && /^(com|co|org|net|gob|edu|nom)$/.test(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}
async function caducaDominio(dominio: string) {
  try {
    const r = await conTiempo(15000, (signal) => fetch("https://rdap.org/domain/" + dominioRaiz(dominio), { signal, headers: { accept: "application/rdap+json" } }));
    if (!r.ok) return null;
    const ev = ((await r.json()).events || []).find((e: any) => e.eventAction === "expiration");
    return ev?.eventDate ? String(ev.eventDate).slice(0, 10) : null;
  } catch { return null; }
}
// Caducidad del certificado SSL vigente (registro público de certificados crt.sh)
async function caducaSSL(dominio: string) {
  try {
    const r = await conTiempo(20000, (signal) => fetch("https://crt.sh/?output=json&exclude=expired&q=" + encodeURIComponent(dominio), { signal }));
    if (!r.ok) return null;
    const padre = dominio.split(".").slice(1).join(".");
    const fechas = ((await r.json()) as any[])
      .filter((c) => String(c.name_value || "").split("\n").some((n: string) => n === dominio || n === "*." + padre))
      .map((c) => String(c.not_after || "").slice(0, 10)).filter(Boolean).sort();
    return fechas.length ? fechas[fechas.length - 1] : null;
  } catch { return null; }
}

async function correoEquipo(db: SupabaseClient, asunto: string, texto: string) {
  const clave = Deno.env.get("BREVO_API_KEY"), de = Deno.env.get("CORREO_REMITENTE");
  if (!clave || !de) return;
  const { data: duenos } = await db.from("staff").select("usuario,email").eq("es_dueno", true);
  for (const s of duenos || []) {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": clave, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { email: de, name: Deno.env.get("NOMBRE_REMITENTE") || "Velority" }, to: [{ email: s.email }],
        subject: asunto, htmlContent: `<p style="font-family:Arial,sans-serif;font-size:15px">${texto}</p>` }),
    }).catch(() => {});
  }
}

// Web caída: Incidencia automática tras 2 fallos seguidos; nota de recuperación cuando vuelve
async function vigilarCaida(db: SupabaseClient, c: { id: string; dominio: string; nombre?: string; email?: string }, v: { ok: boolean; codigo: number | null }, anteriorOk: boolean | null) {
  const { data: abiertos } = await db.from("reportes").select("id").eq("cliente_id", c.id).eq("origen", "medicion")
    .is("eliminado_en", null).not("estado", "in", "(Aceptado,Denegado)").limit(1);
  const abierto = abiertos && abiertos[0];
  if (!v.ok && anteriorOk === false && !abierto) {
    const { data: r } = await db.from("reportes").insert({
      tipo_reporte: "Incidencia", titulo: "Tu web no responde: " + c.dominio, estado: "Entrada de leads", urgencia: 1, origen: "medicion",
      descripcion: "La vigilancia automática ha detectado que https://" + c.dominio + " no responde" + (v.codigo ? " (código " + v.codigo + ")" : "")
        + " en dos comprobaciones seguidas. El equipo ya lo está revisando.",
      usuario_discord: c.nombre || null, email: c.email || null, dominio: c.dominio, cliente_id: c.id,
    }).select("id").single();
    await correoEquipo(db, "⚠ Web caída: " + c.dominio, "La web <b>" + c.dominio + "</b> no responde en dos comprobaciones seguidas. Se ha abierto el caso #" + (r ? r.id : "?") + " en el panel.");
  } else if (v.ok && anteriorOk === false && abierto) {
    await db.from("mensajes_caso").insert({ caso_id: abierto.id, autor_tipo: "staff", autor: "sistema", texto: "✅ La web vuelve a responder (comprobado automáticamente)." });
  }
}

async function medirCliente(db: SupabaseClient, c: { id: string; dominio: string; nombre?: string; email?: string }, w: Record<string, unknown> | undefined, conPageSpeed: boolean) {
  const v = await visitar(c.dominio);
  const { data: previa } = await db.from("comprobaciones").select("ok").eq("cliente_id", c.id).order("creado_en", { ascending: false }).limit(1);
  await vigilarCaida(db, c, v, previa && previa.length ? previa[0].ok : null);
  await db.from("comprobaciones").insert({ cliente_id: c.id, ok: v.ok, codigo: v.codigo, ms: v.ms });
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: hist } = await db.from("comprobaciones").select("ok").eq("cliente_id", c.id).gte("creado_en", desde);
  const total = hist?.length || 0, buenas = (hist || []).filter((h) => h.ok).length;
  const cambios: Record<string, unknown> = { cliente_id: c.id, revisado_en: new Date().toISOString() };
  if (total) cambios.disponibilidad = Math.round((buenas / total) * 10000) / 100;
  if (v.ssl !== null) cambios.ssl_activo = v.ssl;
  let sslCaduca: string | null = null;
  if (conPageSpeed) {
    const [ps, dom, ssl] = await Promise.all([pagespeed(c.dominio).catch(() => null), caducaDominio(c.dominio), caducaSSL(c.dominio)]);
    if (ps) {
      Object.assign(cambios, { puntuacion: ps.puntuacion, velocidad: ps.velocidad, pagespeed_en: new Date().toISOString() });
      const rec = w?.recomendacion_auto === false ? null : recomendacion(ps);
      if (rec) cambios.recomendacion = rec;
    }
    if (dom) await db.rpc("servidor_renovacion_auto", { p_cliente: c.id, p_auto: "dominio", p_concepto: "Dominio " + dominioRaiz(c.dominio), p_tipo: "dominio", p_fecha: dom, p_avisar: 30 });
    if (ssl) await db.rpc("servidor_renovacion_auto", { p_cliente: c.id, p_auto: "ssl", p_concepto: "Certificado SSL " + c.dominio, p_tipo: "ssl", p_fecha: ssl, p_avisar: 10 });
    sslCaduca = ssl;
  }
  if (w?.resumen_auto !== false) cambios.resumen = resumen({ ...(w || {}), ...cambios }, v.ok, sslCaduca);
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

    const { data: clientes } = await db.from("clientes").select("id,dominio,nombre,email").not("dominio", "is", null);
    const { data: webs } = await db.from("webs_cliente").select("cliente_id,medir_auto,pagespeed_en,resumen_auto,recomendacion_auto,amenazas,ssl_activo,disponibilidad,velocidad");
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
