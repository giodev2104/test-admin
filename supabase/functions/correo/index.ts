// Edge Function "correo": envía los correos de Velority con Brevo (gratis hasta 300 al día).
//   · recuperar          (portal, sin sesión)      → enlace para cambiar la contraseña
//   · enlace             (portal, sin sesión)      → enlace para entrar sin contraseña (15 minutos, un solo uso)
//   · aviso_cliente      (panel, sesión del staff) → «el equipo te ha respondido» / «tu solicitud ha cambiado»
//   · aviso_responsable  (panel, sesión del staff) → «te han asignado el caso #…»
//   · aviso_equipo       (portal, token cliente)   → «el cliente ha escrito en el caso #…» al responsable
//   · aviso_urgente      (portal, token cliente)   → «🚨 urgencia» a todo el equipo, con el plazo de su plan
// Despliegue: Supabase > Edge Functions > Deploy a new function > Via Editor, nombre "correo",
// y DESACTIVA «Verify JWT» (la función comprueba ella misma quién llama).
// Secretos (Edge Functions > Secrets): BREVO_API_KEY, CORREO_REMITENTE (el correo verificado en Brevo)
// y opcionales NOMBRE_REMITENTE, URL_PORTAL, URL_PANEL, TURNSTILE_SECRET (protege «recuperar» y «enlace» de robots).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const URL_PORTAL = env("URL_PORTAL") || "https://giodev2104.github.io/test-cliente/";
// Logo de la cabecera de los correos: se sirve desde el propio portal (logo-correo.png)
const BASE_PORTAL = URL_PORTAL.replace(/[?#].*$/, "");
const LOGO = new URL("logo-correo.png", /\/[^/.]+$/.test(BASE_PORTAL) ? BASE_PORTAL + "/" : BASE_PORTAL).href;
const URL_PANEL = env("URL_PANEL") || "https://giodev2104.github.io/test-admin/";
const MINUTOS_ENTRE_AVISOS = 10;
// Objetivo interno de respuesta a urgencias según el plan (horas). Igual que PLAZO_URGENTE_H en el panel.
const PLAZO_URGENTE_H: Record<string, number> = { "Mantenimiento Esencial": 24, "Mantenimiento Pro": 4, "Mantenimiento Tienda": 4, "Renting Plan Lanzamiento": 24, "Renting Plan Negocio": 24, "Renting Plan Ecommerce": 4, "": 24 };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const estadoCliente = (e: string) =>
  e === "Aceptado" ? "Completada" : e === "Denegado" ? "Cerrada" : !e || e === "Entrada de leads" ? "Recibida" : "En curso";

// Turnstile (Cloudflare): sin el secreto TURNSTILE_SECRET no se comprueba, para no bloquear los avisos
async function turnstileValido(token: unknown, ip: string) {
  const secreto = env("TURNSTILE_SECRET");
  if (!secreto) return true;
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  const datos = new URLSearchParams({ secret: secreto, response: token });
  if (ip) datos.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: datos }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return !!j?.success;
}
const NO_ROBOT = "No hemos podido comprobar que no eres un robot. Recarga la página e inténtalo de nuevo.";

function plantilla(titulo: string, parrafos: string[], boton?: { texto: string; url: string }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f8;font-family:Arial,Helvetica,sans-serif;color:#1f2433">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <p style="font-size:20px;font-weight:bold;margin:0 0 18px"><img src="${LOGO}" width="39" height="30" alt="" style="vertical-align:middle;border:0;margin-right:8px">Velority</p>
    <div style="background:#fff;border-radius:12px;padding:26px">
      <h1 style="font-size:20px;margin:0 0 14px">${esc(titulo)}</h1>
      ${parrafos.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${p}</p>`).join("")}
      ${boton ? `<p style="margin:22px 0 4px"><a href="${esc(boton.url)}" style="background:#5b6cff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(boton.texto)}</a></p>` : ""}
    </div>
    <p style="font-size:12px;color:#7b8194;margin:16px 4px">Recibes este correo por tu cuenta en Velority. Si no esperabas este mensaje, puedes ignorarlo.</p>
  </div></body></html>`;
}

async function enviar(para: string, nombre: string | null, asunto: string, html: string) {
  const clave = env("BREVO_API_KEY"), de = env("CORREO_REMITENTE");
  if (!clave || !de) throw new Error("SIN_CONFIGURAR");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": clave, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: de, name: env("NOMBRE_REMITENTE") || "Velority" },
      to: [{ email: para, ...(nombre ? { name: nombre } : {}) }],
      subject: asunto,
      htmlContent: html,
    }),
  });
  // El detalle de Brevo queda en los registros de la función (Supabase > Edge Functions > correo > Logs), nunca en la pantalla del cliente
  if (!r.ok) { console.error("Brevo " + r.status + ": " + (await r.text()).slice(0, 500)); throw new Error("ENVIO_FALLIDO"); }
  const j = await r.json().catch(() => ({}));
  console.log("Correo enviado a Brevo · «" + asunto + "» · messageId " + (j?.messageId || "?"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const cuerpo = await req.json().catch(() => ({}));
    const { accion } = cuerpo;

    // Quién del equipo llama (para las acciones del panel)
    const staffQueLlama = async () => {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user?.email) return null;
      const { data } = await admin.from("staff").select("usuario,email").eq("email", user.email.toLowerCase()).maybeSingle();
      return data;
    };
    const caso = async (id: number) => {
      const { data } = await admin.from("reportes")
        .select("id,titulo,estado,cliente_id,responsable_usuario,usuario_discord,aviso_cliente_en,aviso_equipo_en,eliminado_en")
        .eq("id", id).maybeSingle();
      return data && !data.eliminado_en ? data : null;
    };
    const reciente = (f: string | null) => !!f && Date.now() - new Date(f).getTime() < MINUTOS_ENTRE_AVISOS * 60000;

    if (accion === "recuperar") {
      const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
      if (!(await turnstileValido(cuerpo.turnstile, ip))) return responder({ error: NO_ROBOT }, 400);
      const { data, error } = await admin.rpc("servidor_crear_recuperacion", { p_email: String(cuerpo.email || ""), p_ip: ip });
      if (error) throw error;
      if (data?.error === "limite") return responder({ error: "Has pedido demasiados enlaces. Espera una hora y vuelve a probar." }, 429);
      if (data?.error === "reciente") return responder({ error: "Ya te hemos enviado un enlace hace un momento. Revisa tu correo (y el spam) o espera 5 minutos para pedir otro." }, 429);
      if (data?.token) {
        const url = URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "recuperar=" + data.token;
        await enviar(data.email, data.nombre, "Cambia tu contraseña de Velority", plantilla("Cambia tu contraseña", [
          `Hola, ${esc(String(data.nombre).split(" ")[0])}. Hemos recibido una petición para cambiar la contraseña de tu portal.`,
          "Pulsa el botón para elegir una nueva. El enlace caduca en 1 hora y solo se puede usar una vez.",
          "Si no lo has pedido tú, ignora este correo: tu contraseña no cambiará.",
        ], { texto: "Elegir una contraseña nueva", url }));
      }
      return responder({ ok: true });   // misma respuesta exista o no la cuenta
    }

    if (accion === "enlace") {
      const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
      if (!(await turnstileValido(cuerpo.turnstile, ip))) return responder({ error: NO_ROBOT }, 400);
      const { data, error } = await admin.rpc("servidor_crear_enlace", { p_email: String(cuerpo.email || ""), p_ip: ip });
      if (error) throw error;
      if (data?.error === "limite") return responder({ error: "Has pedido demasiados enlaces. Espera una hora y vuelve a probar." }, 429);
      if (data?.error === "reciente") return responder({ error: "Ya te hemos enviado un enlace hace un momento. Revisa tu correo (y el spam)." }, 429);
      if (data?.token) {
        const url = URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "entrar=" + data.token;
        await enviar(data.email, data.nombre, "Tu enlace para entrar en Velority", plantilla("Entra en tu portal", [
          `Hola, ${esc(String(data.nombre).split(" ")[0])}. Pulsa el botón para entrar en tu portal sin contraseña.`,
          "El enlace caduca en 15 minutos y solo se puede usar una vez.",
          "Si no lo has pedido tú, ignora este correo: nadie podrá entrar sin él.",
        ], { texto: "Entrar en mi portal", url }));
      }
      return responder({ ok: true });   // misma respuesta exista o no la cuenta
    }

    if (accion === "aviso_cliente") {
      const yo = await staffQueLlama();
      if (!yo) return responder({ error: "Sesión no válida." }, 401);
      const r = await caso(Number(cuerpo.caso_id));
      if (!r || !r.cliente_id) return responder({ ok: true, omitido: "El caso no tiene cuenta en el portal." });
      if (cuerpo.motivo !== "estado" && reciente(r.aviso_cliente_en)) return responder({ ok: true, omitido: "Ya se avisó hace poco." });
      const { data: c } = await admin.from("clientes").select("email,nombre").eq("id", r.cliente_id).maybeSingle();
      if (!c) return responder({ ok: true, omitido: "Cliente no encontrado." });
      const nombre = esc(String(c.nombre).split(" ")[0]);
      const html = cuerpo.motivo === "estado"
        ? plantilla(`Tu solicitud #${r.id} está: ${estadoCliente(r.estado)}`, [
            `Hola, ${nombre}. Hay novedades en tu solicitud «${esc(r.titulo || "Sin título")}».`,
            `Su estado ahora es <b>${esc(estadoCliente(r.estado))}</b>.`,
          ], { texto: "Ver mi solicitud", url: URL_PORTAL })
        : plantilla("El equipo te ha respondido", [
            `Hola, ${nombre}. Tienes una respuesta nueva en «${esc(r.titulo || "Sin título")}» (#${r.id}).`,
            "Entra en tu portal para leerla y contestar.",
          ], { texto: "Leer la respuesta", url: URL_PORTAL });
      await enviar(c.email, c.nombre, cuerpo.motivo === "estado" ? `Novedades en tu solicitud #${r.id}` : `Tienes una respuesta del equipo (#${r.id})`, html);
      await admin.from("reportes").update({ aviso_cliente_en: new Date().toISOString() }).eq("id", r.id);
      return responder({ ok: true });
    }

    if (accion === "aviso_responsable") {
      const yo = await staffQueLlama();
      if (!yo) return responder({ error: "Sesión no válida." }, 401);
      const r = await caso(Number(cuerpo.caso_id));
      if (!r || !r.responsable_usuario || r.responsable_usuario === yo.usuario) return responder({ ok: true, omitido: "Sin responsable o eres tú." });
      const { data: s } = await admin.from("staff").select("usuario,email").eq("usuario", r.responsable_usuario).maybeSingle();
      if (!s) return responder({ ok: true, omitido: "Responsable no encontrado." });
      await enviar(s.email, s.usuario, `Te han asignado el caso #${r.id}`, plantilla(`Te han asignado el caso #${r.id}`, [
        `${esc(yo.usuario)} te ha asignado «${esc(r.titulo || "Sin título")}» de ${esc(r.usuario_discord || "un cliente")}.`,
      ], { texto: "Abrir el panel", url: URL_PANEL }));
      return responder({ ok: true });
    }

    if (accion === "aviso_equipo") {
      const id = Number(cuerpo.caso_id);
      const { data: suyo } = await admin.rpc("servidor_caso_del_cliente", { p_token: String(cuerpo.token || ""), p_caso: id });
      if (!suyo) return responder({ error: "Sesión no válida." }, 401);
      const r = await caso(id);
      if (!r || reciente(r.aviso_equipo_en)) return responder({ ok: true, omitido: "Ya se avisó hace poco." });
      const q = r.responsable_usuario
        ? admin.from("staff").select("usuario,email").eq("usuario", r.responsable_usuario)
        : admin.from("staff").select("usuario,email").eq("es_dueno", true);
      const { data: destinos } = await q;
      for (const s of destinos || []) {
        await enviar(s.email, s.usuario, `Nuevo mensaje del cliente en el caso #${r.id}`, plantilla(`${r.usuario_discord || "Un cliente"} ha escrito`, [
          `Hay un mensaje nuevo en «${esc(r.titulo || "Sin título")}» (#${r.id})${r.responsable_usuario ? "" : ". El caso no tiene responsable"}.`,
        ], { texto: "Responder en el panel", url: URL_PANEL }));
      }
      await admin.from("reportes").update({ aviso_equipo_en: new Date().toISOString() }).eq("id", r.id);
      return responder({ ok: true });
    }

    if (accion === "aviso_urgente") {
      const id = Number(cuerpo.caso_id);
      const { data: suyo } = await admin.rpc("servidor_caso_del_cliente", { p_token: String(cuerpo.token || ""), p_caso: id });
      if (!suyo) return responder({ error: "Sesión no válida." }, 401);
      const r = await caso(id);
      const { data: extra } = await admin.from("reportes").select("origen,plan,descripcion").eq("id", id).maybeSingle();
      if (!r || extra?.origen !== "urgente" || reciente(r.aviso_equipo_en)) return responder({ ok: true, omitido: "No es urgente o ya se avisó." });
      const { data: w } = await admin.from("webs_cliente").select("plan").eq("cliente_id", r.cliente_id).maybeSingle();
      const plazo = PLAZO_URGENTE_H[w?.plan || ""] ?? PLAZO_URGENTE_H[""];
      const { data: equipo } = await admin.from("staff").select("usuario,email");
      for (const s of equipo || []) {
        await enviar(s.email, s.usuario, `🚨 URGENTE · caso #${r.id} de ${r.usuario_discord || "un cliente"}`, plantilla(`Urgencia de ${r.usuario_discord || "un cliente"}`, [
          `Plan: <b>${esc(w?.plan || "sin plan")}</b> · plazo de respuesta: <b>${plazo} h</b>.`,
          `«${esc(r.titulo || "Sin título")}» (#${r.id})`,
          esc(String(extra?.descripcion || "").slice(0, 600)),
        ], { texto: "Atender en el panel", url: URL_PANEL }));
      }
      await admin.from("reportes").update({ aviso_equipo_en: new Date().toISOString() }).eq("id", r.id);
      return responder({ ok: true });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "SIN_CONFIGURAR" || msg === "ENVIO_FALLIDO") {
      if (msg === "SIN_CONFIGURAR") console.error("Faltan los secretos BREVO_API_KEY o CORREO_REMITENTE");
      return responder({ error: "Ahora mismo no podemos enviar correos. Inténtalo más tarde o escríbenos por WhatsApp y te ayudamos." }, 503);
    }
    return responder({ error: msg }, 500);
  }
});
