// Edge Function "pago": cobra con Stripe Checkout y solo entonces crea el pedido.
//   · crear     {token, nombre, servicio_id?} → página de pago de Stripe con el importe de la tabla «catalogo» (no el que mande el navegador)
//   · confirmar {token, sesion}              → al volver de Stripe: comprueba que está pagado y registra el pedido
//   · Planes de web (proyectos por fases): {servicio_id} cobra el 50 % de anticipo del precio cerrado y, cuando el
//     cliente aprueba el diseño final, el 50 % restante.
//   · Aviso de Stripe (webhook «checkout.session.completed»): registra el pedido aunque el cliente cierre la página.
// El registro es idempotente (tabla pagos): un mismo pago nunca crea dos pedidos.
// Las sesiones desactivan «Managed Payments» de Stripe: el vendedor es Velority (precios con IVA incluido).
// Configuración (Supabase > Edge Functions > Secrets):
//   STRIPE_SECRET_KEY      clave secreta de Stripe (sk_test_… en pruebas, sk_live_… para cobrar de verdad)
//   STRIPE_WEBHOOK_SECRET  (recomendado) en Stripe > Desarrolladores > Webhooks > Añadir endpoint:
//                          URL https://<proyecto>.supabase.co/functions/v1/pago · evento checkout.session.completed
//   URL_PORTAL             (opcional) dirección del portal, para volver después de pagar
//   SUSCRIPCIONES_ACTIVAS  (opcional) pon «1» para volver a vender suscripciones; sin él solo se cobra lo de pago único
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

// Los importes salen de la tabla «catalogo» (la misma que muestra el portal y se edita en el panel),
// con la oferta aplicada si está en vigor. Los planes de web van por presupuesto: no se cobran aquí.
// En las suscripciones la oferta solo rebaja el primer cobro (cupón de Stripe de un solo uso); después, precio normal.
type Item = { tipo: string; eur: number; normal: number; cada: number; activo: boolean; oferta: number };
async function delCatalogo(db: SupabaseClient, nombre: string): Promise<Item | null> {
  const { data } = await db.from("catalogo").select("tipo,precio,cada,activo,oferta_pct,oferta_hasta").eq("nombre", nombre).maybeSingle();
  if (!data || data.tipo === "web") return null;
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const oferta = data.oferta_pct && (!data.oferta_hasta || data.oferta_hasta >= hoy) ? Number(data.oferta_pct) : 0;
  const eur = Math.round(Number(data.precio) * (100 - oferta)) / 100;
  return { tipo: data.tipo, eur, normal: Number(data.precio), cada: data.cada || 0, activo: data.activo !== false, oferta };
}

// Cupón «X% solo el primer cobro» (se crea una vez en Stripe y se reutiliza)
async function cuponPrimerMes(pct: number) {
  const id = "oferta-" + pct + "-primer-mes";
  try { await stripe("coupons/" + id); }
  catch { await stripe("coupons", { id, percent_off: String(pct), duration: "once", name: "Oferta " + pct + "% (primer mes)" }); }
  return id;
}

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
  if (m.parte) {
    const { data, error } = await db.rpc("servidor_registrar_fase", {
      p_sesion: s.id, p_cliente: m.cliente_id, p_servicio: Number(m.servicio_id), p_parte: m.parte, p_importe: Number(s.amount_total || 0) / 100,
    });
    if (error) throw error;
    await metodoPago(db, s.id, m.cliente_id).catch(() => {});
    return data;
  }
  const { data, error } = await db.rpc("servidor_registrar_pago", {
    p_sesion: s.id, p_cliente: m.cliente_id, p_tipo: m.tipo, p_nombre: m.nombre,
    p_importe: m.cuota ? Number(m.cuota) : Number(s.amount_total || 0) / 100, p_modo: s.mode, p_servicio: m.servicio_id ? Number(m.servicio_id) : null,
  });
  if (error) throw error;
  await metodoPago(db, s.id, m.cliente_id).catch(() => {});
  return data;
}

// Apunta en la ficha del cliente la tarjeta con la que ha pagado («Visa terminada en 4242»)
async function metodoPago(db: SupabaseClient, sesion: string, cliente: string) {
  const s = await stripe("checkout/sessions/" + encodeURIComponent(sesion) + "?expand[]=payment_intent.payment_method&expand[]=subscription.default_payment_method");
  const card = s.payment_intent?.payment_method?.card || s.subscription?.default_payment_method?.card;
  if (!card?.last4 || !cliente) return;
  const marca = String(card.brand || "Tarjeta").replace(/^\w/, (c: string) => c.toUpperCase());
  await db.from("webs_cliente").upsert({ cliente_id: cliente, metodo_pago: marca + " terminada en " + card.last4 }, { onConflict: "cliente_id" });
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
        const { data: s } = await db.from("servicios_cliente").select("id,nombre,pagado_en,estado,tipo,importe,anticipo_en,aprobado_en").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
        if (!s) return responder({ error: "Pedido no encontrado." }, 404);
        if (s.pagado_en) return responder({ error: "Este pedido ya está pagado." }, 400);
        nombre = s.nombre; servicioId = s.id;
        // Proyecto web por fases: 50 % de anticipo y 50 % al aprobar el diseño final
        if (s.tipo === "web") {
          if (!s.importe) return responder({ error: "Todavía no tenemos tu precio cerrado: te lo enviamos por el chat antes de empezar." }, 400);
          const parte = s.anticipo_en ? "final" : "anticipo";
          if (parte === "final" && !s.aprobado_en) return responder({ error: "El 50 % restante se paga cuando apruebes el diseño final en la demo." }, 400);
          if (!b.acepta) return responder({ error: "Para pagar tienes que aceptar el Aviso Legal y las Condiciones de Contratación de Servicios de Pago Único. Recarga la página e inténtalo de nuevo." }, 400);
          const total = Number(s.importe), anticipo = Math.round(total * 50) / 100, eur = parte === "anticipo" ? anticipo : Math.round((total - anticipo) * 100) / 100;
          const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
          const d: Record<string, string> = {
            mode: "payment", "managed_payments[enabled]": "false", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][unit_amount]": String(Math.round(eur * 100)),
            "line_items[0][price_data][product_data][name]": nombre + (parte === "anticipo" ? " · anticipo del 50 %" : " · pago final del 50 %"),
            client_reference_id: cid,
            "metadata[cliente_id]": cid, "metadata[tipo]": "web", "metadata[nombre]": nombre, "metadata[servicio_id]": String(s.id), "metadata[parte]": parte,
            "metadata[acepta_condiciones]": String(b.acepta).slice(0, 60), "metadata[acepta_en]": new Date().toISOString(),
            success_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=ok&sesion={CHECKOUT_SESSION_ID}",
            cancel_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=cancelado",
            locale: "es",
          };
          if (c?.email) d.customer_email = c.email;
          const ses = await stripe("checkout/sessions", d);
          return responder({ url: ses.url });
        }
      }
      const it = await delCatalogo(db, nombre);
      if (!it) return responder({ error: "Este servicio se paga por presupuesto: el equipo te enviará el importe por el chat." }, 400);
      if (!it.activo && !servicioId) return responder({ error: "Este servicio ya no está disponible." }, 400);
      if (it.cada && env("SUSCRIPCIONES_ACTIVAS") !== "1") return responder({ error: "Los planes de suscripción estarán disponibles muy pronto. Ahora mismo solo contratamos servicios de pago único." }, 400);
      if (!b.acepta) return responder({ error: "Para pagar tienes que aceptar el Aviso Legal y las Condiciones de Contratación de Servicios de Pago Único. Recarga la página e inténtalo de nuevo." }, 400);
      const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
      const d: Record<string, string> = {
        mode: it.cada ? "subscription" : "payment", "managed_payments[enabled]": "false",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round((it.cada ? it.normal : it.eur) * 100)),
        "line_items[0][price_data][product_data][name]": nombre + (it.oferta && !it.cada ? " (oferta -" + it.oferta + "%)" : ""),
        client_reference_id: cid,
        "metadata[cliente_id]": cid, "metadata[tipo]": it.tipo, "metadata[nombre]": nombre,
        // Constancia de la aceptación de las condiciones (versión y momento), guardada en el propio pago de Stripe
        "metadata[acepta_condiciones]": String(b.acepta).slice(0, 60), "metadata[acepta_en]": new Date().toISOString(),
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
        d["metadata[cuota]"] = String(it.normal);
        if (it.oferta) d["discounts[0][coupon]"] = await cuponPrimerMes(it.oferta);
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
