// Edge Function "informe": manda a cada cliente el informe de su web del mes anterior (con Brevo).
//   · Día 1 a las 8:00 (pg_cron → lanzar_funcion('informe')): todos los clientes con plan y «Informe mensual» activado.
//   · Desde el panel (sesión del staff): { cliente_id, mes? } lo manda al momento a ese cliente.
// Usa el historial que guarda el cierre de mes (webs_cliente_historial). Un cliente nunca recibe dos veces el mismo mes
// por el envío automático (tabla informes_enviados); desde el panel sí se puede reenviar.
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "informe", y DESACTIVA «Verify JWT».
// Usa los mismos secretos que «correo»: BREVO_API_KEY, CORREO_REMITENTE y opcionales NOMBRE_REMITENTE, URL_PORTAL.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const URL_PORTAL = env("URL_PORTAL") || "https://giodev2104.github.io/test-cliente/";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const num = (v: unknown, d = 0) => Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const hay = (v: unknown) => v !== null && v !== undefined && v !== "";
const pct = (v: unknown) => (Number(v) > 0 ? "▲ +" : Number(v) < 0 ? "▼ " : "") + num(v) + " %";

type Datos = Record<string, unknown>;

async function enviar(para: string, nombre: string | null, asunto: string, html: string) {
  const clave = env("BREVO_API_KEY"), de = env("CORREO_REMITENTE");
  if (!clave || !de) throw new Error("SIN_CONFIGURAR");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": clave, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: de, name: env("NOMBRE_REMITENTE") || "Webcare" },
      to: [{ email: para, ...(nombre ? { name: nombre } : {}) }], subject: asunto, htmlContent: html }),
  });
  if (!r.ok) throw new Error("Brevo " + r.status + ": " + (await r.text()).slice(0, 200));
}

function cifra(titulo: string, valor: string, nota = "") {
  return `<td style="width:50%;padding:6px"><div style="background:#f4f5fb;border-radius:10px;padding:14px">
    <div style="font-size:12px;color:#6b7186">${esc(titulo)}</div>
    <div style="font-size:22px;font-weight:bold;margin-top:2px">${esc(valor)}</div>
    ${nota ? `<div style="font-size:12px;color:#6b7186;margin-top:2px">${esc(nota)}</div>` : ""}</div></td>`;
}

// El correo del informe
function html(nombre: string, dominio: string, mesTxt: string, d: Datos, casos: { titulo: string; tipo: string }[], rotos: number | null) {
  const celdas: string[] = [];
  if (hay(d.disponibilidad)) celdas.push(cifra("Tu web estuvo online", num(d.disponibilidad, 2) + " %", "del tiempo"));
  if (hay(d.velocidad)) celdas.push(cifra("Velocidad de carga", num(d.velocidad, 1) + " s", Number(d.velocidad) <= 2 ? "Buena" : "Mejorable"));
  if (hay(d.puntuacion)) celdas.push(cifra("Puntuación de la web", num(d.puntuacion) + " / 100"));
  if (hay(d.mes_ataques)) celdas.push(cifra("Ataques bloqueados", num(d.mes_ataques)));
  if (hay(d.mes_actualizaciones)) celdas.push(cifra("Actualizaciones de seguridad", num(d.mes_actualizaciones)));
  if (hay(d.mes_cambios)) celdas.push(cifra("Cambios completados", num(d.mes_cambios)));
  if (hay(d.horas_incluidas)) celdas.push(cifra("Tokens usados", num(d.horas_usadas ?? d.mes_horas ?? 0, 1).replace(",0", "") + " de " + num(d.horas_incluidas, 1).replace(",0", "")));
  if (rotos !== null) celdas.push(cifra("Enlaces rotos", rotos ? String(rotos) : "Ninguno", rotos ? "Los estamos revisando" : "Todo correcto"));
  const filas: string[] = [];
  for (let i = 0; i < celdas.length; i += 2) filas.push(`<tr>${celdas[i]}${celdas[i + 1] || "<td></td>"}</tr>`);
  const seo = [hay(d.seo_visitas) ? `Visitas desde Google: <b>${pct(d.seo_visitas)}</b>` : "", hay(d.seo_clics) ? `Clics: <b>${pct(d.seo_clics)}</b>` : "",
    hay(d.seo_impresiones) ? `Veces que apareces: <b>${pct(d.seo_impresiones)}</b>` : "", hay(d.seo_primera_pagina) ? `Palabras en primera página: <b>${num(d.seo_primera_pagina)}</b>` : ""].filter(Boolean);
  const palabras = Array.isArray(d.seo_palabras) ? (d.seo_palabras as Datos[]).slice(0, 5) : [];
  return `<!doctype html><html lang="es"><body style="margin:0;background:#eef0f6;font-family:Arial,Helvetica,sans-serif;color:#1f2433">
  <div style="max-width:600px;margin:0 auto;padding:28px 14px">
    <p style="font-size:18px;font-weight:bold;margin:0 0 16px">■ Webcare</p>
    <div style="background:#fff;border-radius:14px;padding:26px 20px">
      <p style="font-size:13px;color:#6b7186;margin:0">Informe mensual · ${esc(dominio)}</p>
      <h1 style="font-size:22px;margin:4px 0 12px">${esc(mesTxt)}</h1>
      <p style="font-size:15px;line-height:1.55;margin:0 0 16px">Hola, ${esc(nombre)}. Este es el resumen de lo que ha pasado en tu web y de lo que hemos hecho por ella.</p>
      ${filas.length ? `<table role="presentation" style="width:100%;border-collapse:collapse">${filas.join("")}</table>` : ""}
      ${seo.length ? `<h2 style="font-size:16px;margin:22px 0 8px">Tu presencia en Google</h2><p style="font-size:14px;line-height:1.7;margin:0">${seo.join("<br>")}</p>` : ""}
      ${palabras.length ? `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px"><tr style="color:#6b7186;font-size:12px"><td style="padding:6px 0">Búsqueda</td><td style="text-align:right">Posición</td></tr>
        ${palabras.map((p) => `<tr style="border-top:1px solid #eceef4"><td style="padding:7px 0">${esc(p.palabra)}</td><td style="text-align:right">${hay(p.ahora) ? esc(p.ahora) : "—"}</td></tr>`).join("")}</table>` : ""}
      ${casos.length ? `<h2 style="font-size:16px;margin:22px 0 8px">Solicitudes completadas</h2><ul style="font-size:14px;line-height:1.6;margin:0;padding-left:18px">${casos.slice(0, 10).map((c) => `<li>${esc(c.titulo || c.tipo)}</li>`).join("")}</ul>` : ""}
      <p style="margin:24px 0 4px"><a href="${esc(URL_PORTAL)}" style="background:#5b6cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Ver el informe completo</a></p>
      <p style="font-size:13px;color:#6b7186;margin:12px 0 0">En tu portal puedes descargarlo en PDF desde «Mi web» › «Meses anteriores».</p>
    </div>
    <p style="font-size:12px;color:#7b8194;margin:16px 4px">Recibes este informe por tu plan de mantenimiento en Webcare. Si prefieres no recibirlo, contesta a este correo o escríbenos desde tu portal.</p>
  </div></body></html>`;
}

async function informeDe(db: SupabaseClient, clienteId: string, mes: string, quien: string, forzar: boolean) {
  if (!forzar) {
    const { data: ya } = await db.from("informes_enviados").select("cliente_id").eq("cliente_id", clienteId).eq("mes", mes).maybeSingle();
    if (ya) return { omitido: "ya enviado" };
  }
  const { data: c } = await db.from("clientes").select("id,email,nombre,dominio").eq("id", clienteId).maybeSingle();
  if (!c || !c.email) return { omitido: "sin cliente o sin correo" };
  const { data: h } = await db.from("webs_cliente_historial").select("datos").eq("cliente_id", clienteId).eq("mes", mes).maybeSingle();
  const { data: w } = await db.from("webs_cliente").select("plan,enlaces_rotos,enlaces_revisado_en").eq("cliente_id", clienteId).maybeSingle();
  const d: Datos = (h?.datos as Datos) || {};
  if (!h && !w?.plan) return { omitido: "sin datos del mes" };
  const fin = new Date(mes + "T00:00:00Z"); fin.setUTCMonth(fin.getUTCMonth() + 1);
  const { data: casos } = await db.from("reportes").select("titulo,tipo_reporte").eq("cliente_id", clienteId).eq("estado", "Aceptado")
    .is("eliminado_en", null).gte("resuelto_en", mes).lt("resuelto_en", fin.toISOString().slice(0, 10));
  const rotos = typeof d.enlaces_rotos === "number" ? d.enlaces_rotos as number
    : w?.enlaces_revisado_en ? (Array.isArray(w.enlaces_rotos) ? w.enlaces_rotos.length : 0) : null;
  const mesTxt = new Date(mes + "T12:00:00Z").toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  const Mes = mesTxt.charAt(0).toUpperCase() + mesTxt.slice(1);
  await enviar(c.email, c.nombre, `Informe de tu web · ${Mes}`, html(String(c.nombre).split(" ")[0], c.dominio || "tu web", Mes, d,
    (casos || []).map((x) => ({ titulo: x.titulo, tipo: x.tipo_reporte })), rotos));
  await db.from("informes_enviados").upsert({ cliente_id: clienteId, mes, enviado_en: new Date().toISOString(), enviado_por: quien });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const cuerpo = await req.json().catch(() => ({}));
    const { data: aj } = await db.from("ajustes").select("valor").eq("clave", "secreto_cron").maybeSingle();
    const esCron = !!aj?.valor && req.headers.get("x-secreto") === aj.valor;
    let staff: string | null = null;
    if (!esCron) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await db.auth.getUser(token);
      if (user?.email) {
        const { data: s } = await db.from("staff").select("usuario").eq("email", user.email.toLowerCase()).maybeSingle();
        staff = s?.usuario || null;
      }
    }
    if (!esCron && !staff) return responder({ error: "No autorizado." }, 401);

    const hoy = new Date();
    const mesPasado = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const mes = /^\d{4}-\d{2}-01$/.test(String(cuerpo.mes || "")) ? cuerpo.mes : mesPasado;

    if (staff && cuerpo.cliente_id) {
      const r = await informeDe(db, String(cuerpo.cliente_id), mes, staff, true);
      return responder(r.ok ? { ok: true, mes } : { error: "No se envió: " + r.omitido + "." }, r.ok ? 200 : 400);
    }
    const { data: webs } = await db.from("webs_cliente").select("cliente_id,plan,informe_auto").not("plan", "is", null);
    const resultados = [];
    for (const w of webs || []) {
      if (w.informe_auto === false) continue;
      try { resultados.push({ cliente_id: w.cliente_id, ...(await informeDe(db, w.cliente_id, mes, staff || "automático", false)) }); }
      catch (e) {
        const m = String((e as Error)?.message || e);
        if (m === "SIN_CONFIGURAR") throw e;
        resultados.push({ cliente_id: w.cliente_id, error: m });
      }
    }
    return responder({ ok: true, mes, enviados: resultados.filter((r) => (r as { ok?: boolean }).ok).length, resultados });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "SIN_CONFIGURAR") return responder({ error: "El envío de correos no está configurado (faltan BREVO_API_KEY y CORREO_REMITENTE)." }, 503);
    return responder({ error: msg }, 500);
  }
});
