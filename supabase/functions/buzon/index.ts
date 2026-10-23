// Edge Function "buzon": el buzón de la dirección de contacto (contact-velority@velority.es) dentro del panel.
//   · POST ?k=CLAVE        (Brevo, «inbound parsing»)  → guarda en «correos» los correos que llegan
//   · accion "responder"   (panel, sesión del staff)    → envía la respuesta con Brevo y la guarda
//     Con plantilla "propuesta" (correos a clientes potenciales) va con diseño: «PRUEBA GRATUITA» destacada y botón a la demo.
//   · accion "vista"       (panel, sesión del staff)    → devuelve el HTML de la propuesta sin enviarla (vista previa)
//   · accion "adjunto"     (panel, sesión del staff)    → descarga un archivo adjunto de un correo recibido
//   · accion "estado"      (panel, sesión del staff)    → si la recepción está conectada en Brevo
//   · accion "conectar"    (panel, sesión del staff)    → registra en Brevo la recepción para un subdominio
// Los correos automáticos de la web (cambiar contraseña, avisos…) no pasan por aquí: solo los que escriben las
// personas a la dirección de contacto y las respuestas del equipo.
// Usa los mismos secretos que «correo»: BREVO_API_KEY, CORREO_REMITENTE y opcional NOMBRE_REMITENTE.
// Despliegue: nombre "buzon" y DESACTIVA «Verify JWT» (Brevo llama sin sesión; la clave va en la URL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const BREVO = "https://api.brevo.com/v3";
const brevo = (ruta: string, init: RequestInit = {}) =>
  fetch(BREVO + ruta, { ...init, headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", accept: "application/json", ...(init.headers || {}) } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const correoValido = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s) && s.length <= 320;

// Clave secreta de la URL que llama Brevo: sale de la clave de servicio, así no hace falta otro secreto
async function claveWebhook() {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("buzon|" + env("SUPABASE_SERVICE_ROLE_KEY")));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const urlWebhook = async () => env("SUPABASE_URL") + "/functions/v1/buzon?k=" + (await claveWebhook());

// Propuesta a un negocio sin web: el texto lo escribe el equipo en el panel; aquí se le da diseño.
// La línea con el enlace a la demo se convierte en un botón grande; las líneas que empiezan por 🎁 se destacan;
// desde «—» es la letra pequeña (baja).
const DEMO = "https://velority.es/?demo=1", LOGO = "https://velority.es/logo-correo.png";
const enlaces = (h: string) => h.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#e8590c;font-weight:bold">${u.replace(/^https?:\/\//, "")}</a>`);
const boton = (texto: string, url: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto"><tr><td align="center" style="border-radius:999px;background:#ff6a2b;background-image:linear-gradient(90deg,#ff8a3d,#ff4f8b)">
  <a href="${url}" style="display:inline-block;padding:16px 34px;font-size:18px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">${texto}</a></td></tr></table>`;
function htmlPropuesta(texto: string) {
  const lineas = texto.split("\n"), corte = lineas.findIndex((l) => l.trim().startsWith("—"));
  const cuerpo = corte >= 0 ? lineas.slice(0, corte) : lineas, pie = corte >= 0 ? lineas.slice(corte + 1).join(" ").trim() : "";
  let conBoton = false;
  const bloques = cuerpo.join("\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((b) => {
    if (b.includes("velority.es/?demo")) {
      conBoton = true;
      const resto = b.split("\n").map((l) => l.replace(/👉?\s*[^:\n]*:\s*https?:\/\/\S*velority\.es\/\?demo\S*/, "").trim()).filter(Boolean);
      return boton("🎁 Quiero mi prueba gratuita", DEMO) + resto.map((l) => `<p style="margin:0 0 18px;text-align:center;font-size:14px;color:#5b6170">${enlaces(esc(l))}</p>`).join("");
    }
    const h = enlaces(esc(b)).replace(/\n/g, "<br>");
    if (b.startsWith("🎁")) return `<div style="margin:0 0 16px;padding:14px 16px;border-radius:12px;background:#fff4ec;border:2px solid #ff8a3d;font-size:16px;line-height:1.5;color:#1f2433">${h.replace(/^🎁\s*([^:<]+:)/, '🎁 <strong style="color:#e8590c">$1</strong>')}</div>`;
    return `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1f2433">${h}</p>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f1f2f6;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Os preparamos gratis una demo de vuestra web. Sin compromiso: solo pagáis si os gusta.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
  <tr><td style="background:#0d1020;padding:18px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td><img src="${LOGO}" alt="" height="34" style="display:block;height:34px;border:0"></td><td style="padding-left:10px;font-size:20px;font-weight:bold;color:#ffffff">Velority</td></tr></table></td></tr>
  <tr><td align="center" style="background:#ff6a2b;background-image:linear-gradient(135deg,#ff8a3d 0%,#ff4f8b 60%,#a855f7 100%);padding:30px 24px 32px;color:#ffffff">
    <div style="display:inline-block;background:#ffffff;color:#e8590c;font-weight:bold;font-size:14px;letter-spacing:2px;padding:7px 16px;border-radius:999px">🎁 PRUEBA GRATUITA</div>
    <h1 style="margin:16px 0 8px;font-size:30px;line-height:1.15;color:#ffffff">Vuestra web, gratis para probar</h1>
    <p style="margin:0;font-size:17px;line-height:1.45;color:#ffffff">Os la preparamos sin compromiso.<br><strong>Solo pagáis si os encanta.</strong></p>
  </td></tr>
  <tr><td style="padding:26px 26px 10px">${bloques}${conBoton ? "" : boton("🎁 Quiero mi prueba gratuita", DEMO)}</td></tr>
  <tr><td style="padding:0 26px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7fb;border-radius:12px"><tr>
    <td align="center" style="padding:14px 6px;font-size:13px;color:#1f2433;width:33%"><div style="font-size:22px">✅</div><strong>Demo gratis</strong><br>con vuestro negocio</td>
    <td align="center" style="padding:14px 6px;font-size:13px;color:#1f2433;width:34%"><div style="font-size:22px">🤝</div><strong>Sin compromiso</strong><br>ni permanencia</td>
    <td align="center" style="padding:14px 6px;font-size:13px;color:#1f2433;width:33%"><div style="font-size:22px">💶</div><strong>Desde 100 €</strong><br>pago único</td></tr></table></td></tr>
</table>
${pie ? `<p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.5;color:#8a8fa0">${enlaces(esc(pie))}</p>` : ""}
</td></tr></table></body></html>`;
}

// Texto legible de un correo: el mensaje que extrae Brevo (sin la cita del correo anterior) o el texto completo
function textoDe(it: Record<string, any>) {
  const md = String(it.ExtractedMarkdownMessage || "").trim();
  if (md) return md;
  const t = String(it.RawTextBody || "").trim();
  if (t) return t;
  return String(it.RawHtmlBody || "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    // ---------- Brevo nos manda los correos recibidos ----------
    const k = new URL(req.url).searchParams.get("k");
    if (k !== null) {
      if (k !== (await claveWebhook())) return responder({ error: "Clave no válida." }, 401);
      const cuerpo = await req.json().catch(() => ({}));
      const items: Record<string, any>[] = Array.isArray(cuerpo?.items) ? cuerpo.items : Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      const propio = env("CORREO_REMITENTE").toLowerCase();
      let guardados = 0;
      for (const it of items) {
        const de = it?.ReplyTo?.Address || it?.From?.Address || "";
        const contacto = String(de).trim().toLowerCase();
        if (!correoValido(contacto) || contacto === propio) continue;
        const fila = {
          direccion: "entrada",
          contacto,
          contacto_nombre: String((it.ReplyTo?.Address ? it.ReplyTo?.Name : it.From?.Name) || "").slice(0, 200) || null,
          asunto: String(it.Subject || "(sin asunto)").slice(0, 500),
          texto: textoDe(it).slice(0, 60000),
          message_id: it.MessageId ? String(it.MessageId).slice(0, 500) : null,
          en_respuesta_a: it.InReplyTo ? String(it.InReplyTo).slice(0, 500) : null,
          adjuntos: (Array.isArray(it.Attachments) ? it.Attachments : []).slice(0, 20).map((a: Record<string, any>) => ({
            nombre: String(a.Name || "archivo").slice(0, 200), tipo: String(a.ContentType || ""), tamano: Number(a.ContentLength) || null,
            token: String(a.DownloadToken || ""),
          })),
          creado_en: it.SentAtDate && !isNaN(Date.parse(it.SentAtDate)) ? new Date(it.SentAtDate).toISOString() : new Date().toISOString(),
        };
        const { error } = await admin.from("correos").insert(fila);
        if (error && error.code !== "23505") throw error;   // 23505 = Brevo lo ha mandado dos veces
        if (!error) guardados++;
      }
      console.log("Buzón: " + guardados + " correo(s) nuevo(s)");
      return responder({ ok: true, guardados });
    }

    // ---------- Acciones del panel (solo el equipo) ----------
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    const { data: yo } = user?.email
      ? await admin.from("staff").select("usuario,email").eq("email", user.email.toLowerCase()).maybeSingle()
      : { data: null };
    if (!yo) return responder({ error: "Sesión no válida." }, 401);
    if (!env("BREVO_API_KEY")) return responder({ error: "Falta el secreto BREVO_API_KEY en Supabase." }, 503);
    const cuerpo = await req.json().catch(() => ({}));
    const { accion } = cuerpo;

    if (accion === "vista") return responder({ html: htmlPropuesta(String(cuerpo.texto || "").slice(0, 20000)) });

    if (accion === "responder") {
      const de = env("CORREO_REMITENTE"), contacto = String(cuerpo.contacto || "").trim().toLowerCase();
      const asunto = String(cuerpo.asunto || "").trim().slice(0, 200), texto = String(cuerpo.texto || "").trim();
      if (!de) return responder({ error: "Falta el secreto CORREO_REMITENTE en Supabase." }, 503);
      if (!correoValido(contacto)) return responder({ error: "El correo del destinatario no es válido." }, 400);
      if (!asunto) return responder({ error: "Escribe un asunto." }, 400);
      if (!texto || texto.length > 20000) return responder({ error: "Escribe el mensaje (máximo 20.000 caracteres)." }, 400);
      const ref = cuerpo.en_respuesta_a ? String(cuerpo.en_respuesta_a).slice(0, 500) : "";
      const nombre = env("NOMBRE_REMITENTE") || "Velority";
      const html = cuerpo.plantilla === "propuesta" ? htmlPropuesta(texto) : `<!doctype html><html lang="es"><body style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2433">
        <div style="max-width:620px;padding:8px 4px">${esc(texto).replace(/\n/g, "<br>")}</div></body></html>`;
      const r = await brevo("/smtp/email", {
        method: "POST",
        body: JSON.stringify({
          sender: { email: de, name: nombre }, replyTo: { email: de, name: nombre },
          to: [{ email: contacto }], subject: asunto, htmlContent: html, textContent: texto,
          ...(ref ? { headers: { "In-Reply-To": ref, References: ref } } : {}),
        }),
      });
      if (!r.ok) {
        console.error("Brevo " + r.status + ": " + (await r.text()).slice(0, 500));
        return responder({ error: "Brevo no ha aceptado el correo. Revisa los registros de la función «buzon»." }, 502);
      }
      const j = await r.json().catch(() => ({}));
      const { data, error } = await admin.from("correos").insert({
        direccion: "salida", contacto, asunto, texto, message_id: j?.messageId || null, en_respuesta_a: ref || null,
        enviado_por: yo.usuario, leido_en: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      return responder(data);
    }

    if (accion === "adjunto") {
      const { data: c } = await admin.from("correos").select("adjuntos").eq("id", Number(cuerpo.id)).maybeSingle();
      const a = c?.adjuntos?.[Number(cuerpo.i)];
      if (!a?.token) return responder({ error: "Adjunto no encontrado." }, 404);
      const r = await brevo("/inbound/attachments/" + encodeURIComponent(a.token), { headers: { accept: "*/*" } });
      if (!r.ok) return responder({ error: "Brevo ya no tiene este adjunto (" + r.status + ")." }, 502);
      return new Response(await r.arrayBuffer(), { headers: { ...cors, "Content-Type": a.tipo || "application/octet-stream" } });
    }

    if (accion === "estado" || accion === "conectar") {
      const url = await urlWebhook();
      const lista = await brevo("/webhooks?type=inbound");
      const txt = await lista.text();
      // Sin ninguna conexión creada, Brevo responde 400/404 «document_not_found» en vez de una lista vacía
      if (!lista.ok && !/document_not_found/.test(txt)) return responder({ error: "Brevo no responde (" + lista.status + "): " + txt.slice(0, 200) }, 502);
      const hooks = (lista.ok ? (JSON.parse(txt || "{}")?.webhooks || []) : []) as Record<string, any>[];
      const nuestro = hooks.find((h) => String(h.url || "").includes("/functions/v1/buzon"));
      if (accion === "estado") return responder({ conectado: !!nuestro && nuestro.url === url, dominio: nuestro?.domain || null });
      const dominio = String(cuerpo.dominio || "").trim().toLowerCase();
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio)) return responder({ error: "Escribe un subdominio válido, por ejemplo buzon.velority.es." }, 400);
      if (nuestro) await brevo("/webhooks/" + nuestro.id, { method: "DELETE" });
      const r = await brevo("/webhooks", {
        method: "POST",
        body: JSON.stringify({ type: "inbound", events: ["inboundEmailProcessed"], url, domain: dominio, description: "Buzón del panel de Velority" }),
      });
      if (!r.ok) return responder({ error: "Brevo no ha aceptado la conexión (" + r.status + "): " + (await r.text()).slice(0, 300) }, 502);
      return responder({ ok: true, dominio });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error(String((e as Error)?.message || e));
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
