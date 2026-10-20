// Edge Function "pago": cobra con Stripe Checkout y solo entonces crea el pedido.
//   · crear     {token, nombre, servicio_id?} → página de pago de Stripe con el importe del CATÁLOGO (no el que mande el navegador)
//   · confirmar {token, sesion}              → al volver de Stripe: comprueba que está pagado y registra el pedido
//   · Aviso de Stripe (webhook «checkout.session.completed»): registra el pedido aunque el cliente cierre la página.
// El registro es idempotente (tabla pagos): un mismo pago nunca crea dos pedidos.
// Configuración (Supabase > Edge Functions > Secrets):
//   STRIPE_SECRET_KEY      clave secreta de Stripe (sk_test_… en pruebas, sk_live_… para cobrar de verdad)
//   STRIPE_WEBHOOK_SECRET  (recomendado) en Stripe > Desarrolladores > Webhooks > Añadir endpoint:
//                          URL https://<proyecto>.supabase.co/functions/v1/pago · evento checkout.session.completed
//   URL_PORTAL             (opcional) dirección del portal, para volver después de pagar
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "pago", y DESACTIVA «Verify JWT».
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const URL_PORTAL = env("URL_PORTAL") || "https://giodev2104.github.io/test-cliente/";

// Catálogo con precio cerrado (Propuesta Comercial 2026). Los planes de web van por presupuesto y no están aquí.
// tipo · importe en € · cada = meses entre cobros (0 = pago único)
type Item = { tipo: string; eur: number; cada: number };
const CATALOGO: Record<string, Item> = {
  "Mantenimiento Esencial": { tipo: "mantenimiento", eur: 19, cada: 1 },
  "Mantenimiento Pro": { tipo: "mantenimiento", eur: 39, cada: 1 },
  "Renting Plan Lanzamiento": { tipo: "renting", eur: 29, cada: 1 },
  "Renting Plan Negocio": { tipo: "renting", eur: 49, cada: 1 },
  "Renting Plan Ecommerce": { tipo: "renting", eur: 79, cada: 1 },
  "Pack Presencia Local Total": { tipo: "pack", eur: 119, cada: 0 },
  "Pack Despegue Marca & Web": { tipo: "pack", eur: 239, cada: 0 },
  "Pack Ecommerce Express": { tipo: "pack", eur: 179, cada: 0 },
  "Pack Marketing & Conversión 360°": { tipo: "pack", eur: 149, cada: 0 },
  "EXT-01 · Redacción Persuasiva (Copywriting)": { tipo: "extra", eur: 120, cada: 0 },
  "EXT-02 · Diseño de Logo & Marca Básico": { tipo: "extra", eur: 149, cada: 0 },
  "EXT-03 · Aviso Legal & LOPD/RGPD Adaptado": { tipo: "extra", eur: 45, cada: 0 },
  "EXT-04 · Pack Imágenes HD de Stock": { tipo: "extra", eur: 39, cada: 0 },
  "EXT-05 · Configuración Correo Corporativo": { tipo: "extra", eur: 29, cada: 0 },
  "EXT-06 · Pasarela de Pago Adicional": { tipo: "extra", eur: 49, cada: 0 },
  "EXT-07 · Web Multidioma": { tipo: "extra", eur: 89, cada: 0 },
  "EXT-08 · Widget Reseñas de Google": { tipo: "extra", eur: 39, cada: 0 },
  "EXT-09 · Asistente Chatbot IA / WhatsApp": { tipo: "extra", eur: 99, cada: 0 },
  "EXT-10 · Carga Masiva de Productos": { tipo: "extra", eur: 69, cada: 0 },
  "EXT-15 · Ficha Google Maps (SEO Local)": { tipo: "extra", eur: 79, cada: 0 },
  "EXT-16 · Google Search Console & Sitemap": { tipo: "extra", eur: 29, cada: 0 },
  "EXT-17 · Píxeles Meta (FB/IG) y TikTok": { tipo: "extra", eur: 39, cada: 0 },
  "EXT-19 · Gestión de Blog Mensual": { tipo: "extra", eur: 59, cada: 1 },
  "EXT-21 · Auditoría SEO Trimestral": { tipo: "extra", eur: 49, cada: 3 },
};

async function stripe(ruta: string, datos?: Record<string, string>) {
  const clave = env("STRIPE_SECRET_KEY");
  if (!clave) throw new Error("SIN_CONFIGURAR");
  const r = await fetch("https://api.stripe.com/v1/" + ruta, {
    method: datos ? "POST" : "GET",
    headers: { Authorization: "Bearer " + clave, "Content-Type": "application/x-www-form-urlencoded" },
    body: datos ? new URLSearchParams(datos) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Stripe: " + (j?.error?.message || r.status));
  return j;
}

// Comprueba la firma del aviso de Stripe (cabecera stripe-signature: t=…,v1=…)
async function firmaValida(cuerpo: string, cabecera: string) {
  const secreto = env("STRIPE_WEBHOOK_SECRET");
  if (!secreto) return false;
  const partes = Object.fromEntries(cabecera.split(",").map((p) => p.split("=") as [string, string]));
  const t = partes.t, v1 = cabecera.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(t + "." + cuerpo)));
  const hex = [...firma].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.includes(hex);
}

// Registra un pago completado (una sola vez por sesión de Stripe)
async function registrar(db: SupabaseClient, s: Record<string, any>) {
  const pagado = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  if (s.status !== "complete" || !pagado) return { pendiente: true };
  const m = s.metadata || {};
  const { data, error } = await db.rpc("servidor_registrar_pago", {
    p_sesion: s.id, p_cliente: m.cliente_id, p_tipo: m.tipo, p_nombre: m.nombre,
    p_importe: Number(s.amount_total || 0) / 100, p_modo: s.mode, p_servicio: m.servicio_id ? Number(m.servicio_id) : null,
  });
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const texto = await req.text();

    // Aviso automático de Stripe
    const firma = req.headers.get("stripe-signature");
    if (firma) {
      if (!(await firmaValida(texto, firma))) return responder({ error: "Firma no válida." }, 400);
      const ev = JSON.parse(texto);
      if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
        await registrar(db, ev.data.object);
      }
      return responder({ recibido: true });
    }

    const b = JSON.parse(texto || "{}");
    const { data: cid } = await db.rpc("servidor_cliente_de_token", { p_token: String(b.token || "") });
    if (!cid) return responder({ error: "Tu sesión ha caducado. Vuelve a entrar." }, 401);

    if (b.accion === "crear") {
      let nombre = String(b.nombre || ""), servicioId: number | null = null;
      if (b.servicio_id) {
        const { data: s } = await db.from("servicios_cliente").select("id,nombre,pagado_en,estado").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
        if (!s) return responder({ error: "Pedido no encontrado." }, 404);
        if (s.pagado_en) return responder({ error: "Este pedido ya está pagado." }, 400);
        nombre = s.nombre; servicioId = s.id;
      }
      const it = CATALOGO[nombre];
      if (!it) return responder({ error: "Este servicio se paga por presupuesto: el equipo te enviará el importe por el chat." }, 400);
      const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
      const d: Record<string, string> = {
        mode: it.cada ? "subscription" : "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(it.eur * 100)),
        "line_items[0][price_data][product_data][name]": nombre,
        client_reference_id: cid,
        "metadata[cliente_id]": cid, "metadata[tipo]": it.tipo, "metadata[nombre]": nombre,
        success_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=ok&sesion={CHECKOUT_SESSION_ID}",
        cancel_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=cancelado",
        locale: "es",
      };
      if (servicioId) d["metadata[servicio_id]"] = String(servicioId);
      if (c?.email) d.customer_email = c.email;
      if (it.cada) {
        d["line_items[0][price_data][recurring][interval]"] = "month";
        d["line_items[0][price_data][recurring][interval_count]"] = String(it.cada);
        d["subscription_data[metadata][cliente_id]"] = cid;
        d["subscription_data[metadata][nombre]"] = nombre;
      }
      const s = await stripe("checkout/sessions", d);
      return responder({ url: s.url });
    }

    if (b.accion === "confirmar") {
      const s = await stripe("checkout/sessions/" + encodeURIComponent(String(b.sesion || "")));
      if (s.metadata?.cliente_id !== cid) return responder({ error: "Ese pago no es de tu cuenta." }, 403);
      const r = await registrar(db, s);
      if ((r as { pendiente?: boolean }).pendiente) return responder({ pendiente: true });
      return responder({ ok: true, ...r });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "SIN_CONFIGURAR") return responder({ error: "El pago online todavía no está configurado (falta STRIPE_SECRET_KEY). No se ha creado ningún pedido." }, 503);
    return responder({ error: msg }, 500);
  }
});
