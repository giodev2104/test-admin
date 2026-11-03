// Edge Function "pago": cobra con Stripe Checkout y solo entonces crea el pedido.
//   · crear     {token, nombre, servicio_id?} → página de pago de Stripe con el importe de la tabla «catalogo» (no el que mande el navegador)
//   · confirmar {token, sesion}              → al volver de Stripe: comprueba que está pagado y registra el pedido
//   · Planes de web (proyectos por fases): {servicio_id} cobra el 50 % de anticipo del precio cerrado y, cuando el
//     cliente aprueba el diseño final, el 50 % restante.
//   · codigo    {token, codigo, nombre | servicio_id} → comprueba un código promocional y devuelve el importe con descuento
//   · facturas  {token}                      → añade a «Servicios y facturas» las facturas de sus pagos que aún no estén
//   · cancelar  {token, servicio_id? , motivo?} → baja de un plan (sin servicio_id) o de un extra mensual: crea el caso de
//     baja y deja la suscripción de Stripe cancelada al final del periodo pagado (no se cobra nada más)
//   · financiar {token, servicio_id, plazos, acepta} → pago a plazos de un pedido: suscripción de Stripe de N cuotas
//     mensuales que se termina sola tras la última
//   · Cuotas automáticas: al pagar el 50 % final de una web (o un extra que las lleve), Stripe guarda la tarjeta y se
//     crean solas las suscripciones con su periodo gratis: hosting EXT-28 (1 mes gratis), gestión de pedidos EXT-26
//     (Plan Ecommerce, EXT-12, Pack Tienda Lista; 3 meses) y asistente IA EXT-27 (EXT-09, Pack Citas; 1 mes).
//     No se crean si ya las cubre su mantenimiento o renting, o si ya las tiene. Solo con SUSCRIPCIONES_ACTIVAS=1.
//   · Avisos de Stripe (webhook), todos idempotentes:
//       checkout.session.completed / async_payment_succeeded → registra el pedido (o vincula el pago a plazos)
//       invoice.paid                 → renovación mensual o cuota de un pago a plazos (+ su factura en el portal)
//       invoice.payment_failed       → impago: se marca, se avisa al cliente por su chat y al equipo al móvil
//       customer.subscription.updated → baja programada (también si la pide desde el portal de Stripe)
//       customer.subscription.deleted → baja efectiva: deja de estar activo y se quita el plan
// Requiere preparado-suscripciones/suscripciones.sql.
// Precios con IVA incluido: cada cobro lleva el tipo «IVA 21 % incluido» de Stripe (no sube el importe).
// Configuración (Supabase > Edge Functions > Secrets):
//   STRIPE_SECRET_KEY      clave secreta de Stripe (sk_test_… en pruebas, sk_live_… para cobrar de verdad)
//   STRIPE_WEBHOOK_SECRET  en Stripe > Desarrolladores > Webhooks: URL https://<proyecto>.supabase.co/functions/v1/pago
//                          con los eventos de arriba
//   URL_PORTAL             (opcional) dirección del portal, para volver después de pagar
//   SUSCRIPCIONES_ACTIVAS  pon «1» para vender suscripciones y pago a plazos; sin él solo se cobra lo de pago único
// Despliegue: nombre "pago" y DESACTIVA «Verify JWT».
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const URL_PORTAL = env("URL_PORTAL") || "https://velority.es/";
const suscripcionesActivas = () => env("SUSCRIPCIONES_ACTIVAS") === "1";

// Pago a plazos: número de cuotas → recargo sobre el precio (igual que FINANCIACION en el portal)
const PLAZOS: Record<number, number> = { 3: 0, 6: 0.03, 12: 0.06 };
const FINANCIACION_MINIMO = 150;
const r2 = (n: number) => Math.round(n * 100) / 100;

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

// Tipo de IVA del 21 % incluido en el precio (se crea una vez en Stripe y se reutiliza)
const IVA_PCT = 21;
let ivaId = "";
async function ivaIncluido() {
  if (ivaId) return ivaId;
  const lista = await stripe("tax_rates?active=true&inclusive=true&limit=100");
  const t = (lista.data || []).find((x: Record<string, any>) => x.metadata?.velority === "iva" && Number(x.percentage) === IVA_PCT && x.inclusive);
  ivaId = t ? t.id : (await stripe("tax_rates", {
    display_name: "IVA", percentage: String(IVA_PCT), inclusive: "true", country: "ES", jurisdiction: "ES",
    tax_type: "vat", description: "IVA " + IVA_PCT + " % incluido", "metadata[velority]": "iva",
  })).id;
  return ivaId;
}
const PIE_FACTURA = "Precios con IVA incluido (" + IVA_PCT + " %).";

// Cupón «X% solo el primer cobro» (se crea una vez en Stripe y se reutiliza)
async function cuponPrimerMes(pct: number) {
  const id = "oferta-" + pct + "-primer-mes";
  try { await stripe("coupons/" + id); }
  catch { await stripe("coupons", { id, percent_off: String(pct), duration: "once", name: "Oferta " + pct + "% (primer mes)" }); }
  return id;
}

async function stripe(ruta: string, datos?: Record<string, string>, idem?: string) {
  const clave = env("STRIPE_SECRET_KEY");
  if (!clave) throw new Error("SIN_CONFIGURAR");
  const h: Record<string, string> = { Authorization: "Bearer " + clave, "Content-Type": "application/x-www-form-urlencoded" };
  if (idem) h["Idempotency-Key"] = idem;   // un mismo pago nunca crea dos suscripciones aunque el aviso llegue dos veces
  const r = await fetch("https://api.stripe.com/v1/" + ruta, {
    method: datos ? "POST" : "GET",
    headers: h,
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

// Códigos promocionales (tabla codigos_promo). En webs por fases el descuento se reparte entre las dos partes:
// el porcentaje se aplica a cada mitad y el importe fijo, la mitad en cada una. Stripe no cobra menos de 0,50 €.
type Codigo = { id: number; codigo: string; tipo: string; valor: number };
async function validarCodigo(db: SupabaseClient, codigo: string, cliente: string, tipo: string): Promise<Codigo> {
  const { data, error } = await db.rpc("servidor_validar_codigo", { p_codigo: codigo, p_cliente: cliente, p_tipo: tipo });
  if (error) throw new Error(error.message);
  return data as Codigo;
}
function descontar(eur: number, c: Codigo, fase: boolean) {
  const d = c.tipo === "porcentaje" ? Math.round(eur * c.valor) / 100 : (fase ? c.valor / 2 : c.valor);
  const ahora = Math.max(0.5, Math.round((eur - d) * 100) / 100);
  return { ahora, descuento: Math.round((eur - ahora) * 100) / 100 };
}
const textoCodigo = (c: Codigo) => c.tipo === "porcentaje" ? `-${Number(c.valor)} %` : `-${Number(c.valor).toLocaleString("es-ES")} €`;

// ---------- Utilidades de suscripciones ----------
const idDe = (x: unknown) => typeof x === "string" ? x : (x as { id?: string } | null)?.id || "";
// La suscripción y sus datos de una factura (cambian de sitio según la versión de la API de Stripe)
const subDeFactura = (inv: Record<string, any>) => idDe(inv.subscription) || idDe(inv.parent?.subscription_details?.subscription);
const metaDeFactura = (inv: Record<string, any>): Record<string, string> =>
  inv.parent?.subscription_details?.metadata || inv.subscription_details?.metadata || inv.lines?.data?.[0]?.metadata || {};
// Fin del periodo pagado de una suscripción
const finPeriodo = (sub: Record<string, any>) =>
  Number(sub.cancel_at || sub.current_period_end || sub.items?.data?.[0]?.current_period_end || 0);
// Suma meses a una fecha (segundos), respetando los meses cortos
function masMeses(seg: number, n: number) {
  const d = new Date(seg * 1000), dia = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return Math.floor(d.getTime() / 1000);
}
const isoDe = (seg: number) => seg ? new Date(seg * 1000).toISOString() : null;
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });

// Pago a plazos: la suscripción se termina sola 3 días después de la última cuota (se cobran exactamente N)
async function fijarFinPlazos(sub: string, n: number) {
  const s = await stripe("subscriptions/" + encodeURIComponent(sub));
  if (s.cancel_at) return;
  await stripe("subscriptions/" + encodeURIComponent(sub), {
    cancel_at: String(masMeses(Number(s.start_date || s.created), n - 1) + 3 * 86400), proration_behavior: "none",
  });
}

// Aviso al móvil del equipo (función «push», la misma de los demás avisos)
async function avisarEquipo(db: SupabaseClient, titulo: string, texto: string, enlace?: string) {
  try {
    const { data: aj } = await db.from("ajustes").select("valor").eq("clave", "secreto_cron").maybeSingle();
    if (!aj?.valor) return;
    await fetch(env("SUPABASE_URL") + "/functions/v1/push", {
      method: "POST", headers: { "Content-Type": "application/json", "x-secreto": aj.valor },
      body: JSON.stringify({ accion: "evento", titulo, texto, enlace: enlace || "", etiqueta: "cobros" }),
    });
  } catch (e) { console.error("Aviso al equipo: " + (e as Error).message); }
}

// ---------- Cuotas automáticas (hosting, gestión de pedidos y asistente IA) ----------
// código del catálogo → días gratis antes del primer cobro
const CUOTAS: Record<string, { dias: number; corto: string }> = {
  "EXT-28": { dias: 30, corto: "Hosting" },
  "EXT-26": { dias: 90, corto: "Gestión de pedidos" },
  "EXT-27": { dias: 30, corto: "Asistente IA" },
};
type Cuota = { codigo: string; nombre: string; eur: number; dias: number; corto: string };
// Qué cuotas lleva lo que se paga: la web al pagar su 50 % final; los extras y packs que las incluyen, al pagarlos
function cuotasDe(nombre: string, webFinal: boolean) {
  const l: string[] = [];
  if (webFinal) { l.push("EXT-28"); if (/^Plan Ecommerce/.test(nombre)) l.push("EXT-26"); }
  if (/^EXT-12 ·/.test(nombre) || nombre === "Pack Tienda Lista") l.push("EXT-26");
  if (/^EXT-09 ·/.test(nombre) || nombre === "Pack Citas") l.push("EXT-27");
  return l;
}
// Quita las que ya cubre su mantenimiento o renting (o que ya tiene) y saca nombre y precio del catálogo
async function cuotasPendientes(db: SupabaseClient, cliente: string, codigos: string[]): Promise<Cuota[]> {
  if (!codigos.length || !suscripcionesActivas()) return [];
  const { data: cub } = await db.rpc("servidor_cuotas_cubiertas", { p_cliente: cliente });
  const l: Cuota[] = [];
  for (const codigo of [...new Set(codigos)]) {
    if ((cub || []).includes(codigo) || !CUOTAS[codigo]) continue;
    const { data: c } = await db.from("catalogo").select("nombre,precio,activo").like("nombre", codigo + " %").eq("activo", true).maybeSingle();
    if (c) l.push({ codigo, nombre: c.nombre, eur: Number(c.precio), ...CUOTAS[codigo] });
  }
  return l;
}
const eurTxt = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " €";
const textoCuotas = (l: Cuota[]) => "Al pagar guardamos tu tarjeta para activar: " +
  l.map((c) => `${c.corto}, gratis ${c.dias === 30 ? "el primer mes" : "los 3 primeros meses"} y después ${eurTxt(c.eur)}/mes`).join("; ") +
  ". Sin permanencia: puedes darlo de baja cuando quieras desde tu portal.";
// Prepara la sesión de Checkout para guardar la tarjeta y anota qué cuotas se activarán al pagar
function conCuotas(d: Record<string, string>, l: Cuota[]) {
  if (!l.length) return;
  d["customer_creation"] = "always";
  d["payment_intent_data[setup_future_usage]"] = "off_session";
  d["metadata[cuotas]"] = l.map((c) => c.codigo).join(",");
  d["custom_text[submit][message]"] = textoCuotas(l);
}
// Producto fijo de Stripe para cada cuota (se crea la primera vez)
async function productoDe(c: Cuota) {
  const id = "velority-" + c.codigo.toLowerCase();
  try { return (await stripe("products/" + id)).id; }
  catch { return (await stripe("products", { id, name: c.nombre, "metadata[velority]": c.codigo })).id; }
}
// Tras el pago: crea cada suscripción con su periodo gratis y la da de alta como servicio del cliente
async function altaCuotas(db: SupabaseClient, sesion: Record<string, any>, caso: number | null) {
  const m = sesion.metadata || {}, cliente = m.cliente_id;
  const l = await cuotasPendientes(db, cliente, String(m.cuotas || "").split(",").filter(Boolean));
  if (!l.length) return;
  const s = await stripe("checkout/sessions/" + encodeURIComponent(sesion.id) + "?expand[]=payment_intent");
  const customer = idDe(s.customer), pm = idDe(s.payment_intent?.payment_method);
  if (!customer || !pm) throw new Error("El pago no guardó la tarjeta: no se han podido activar las cuotas.");
  for (const c of l) {
    const sub = await stripe("subscriptions", {
      customer, default_payment_method: pm, description: c.nombre,
      "items[0][price_data][currency]": "eur", "items[0][price_data][product]": await productoDe(c),
      "items[0][price_data][unit_amount]": String(Math.round(c.eur * 100)), "items[0][price_data][recurring][interval]": "month",
      "items[0][tax_rates][0]": await ivaIncluido(),
      trial_period_days: String(c.dias), "trial_settings[end_behavior][missing_payment_method]": "cancel",
      "metadata[cliente_id]": cliente, "metadata[nombre]": c.nombre, "metadata[tipo]": "extra", "metadata[cuota]": c.codigo,
    }, "cuota-" + sesion.id + "-" + c.codigo);
    const { error } = await db.rpc("servidor_alta_cuota", {
      p_cliente: cliente, p_nombre: c.nombre, p_importe: c.eur, p_suscripcion: sub.id,
      p_gratis_hasta: isoDe(Number(sub.trial_end || 0)), p_caso: caso,
    });
    if (error) throw error;
  }
}
// Las cuotas nunca bloquean el registro del pago: si algo falla, se avisa al equipo para activarlas a mano
async function altaCuotasSegura(db: SupabaseClient, sesion: Record<string, any>, caso: number | null) {
  if (!sesion.metadata?.cuotas) return;
  try { await altaCuotas(db, sesion, caso); }
  catch (e) {
    console.error("Cuotas: " + (e as Error).message);
    await avisarEquipo(db, "⚠️ Cuotas sin activar", "Pago " + sesion.id + ": " + (e as Error).message, "cliente=" + (sesion.metadata?.cliente_id || ""));
  }
}

// Registra un pago completado de Checkout (una sola vez por sesión de Stripe)
async function registrar(db: SupabaseClient, s: Record<string, any>) {
  const pagado = s.payment_status === "paid" || s.payment_status === "no_payment_required";
  if (s.status !== "complete" || !pagado) return { pendiente: true };
  const m = s.metadata || {};
  // Pago a plazos: las cuotas se registran con cada factura (invoice.paid); aquí solo se vincula y se fija el final
  if (m.financiar) {
    const sub = idDe(s.subscription), n = Number(m.financiar);
    const { error } = await db.rpc("servidor_vincular_suscripcion", { p_servicio: Number(m.servicio_id), p_suscripcion: sub, p_plazos: n });
    if (error) throw error;
    await fijarFinPlazos(sub, n);
    await metodoPago(db, s.id, m.cliente_id).catch(() => {});
    return { servicio_id: Number(m.servicio_id), financiado: true };
  }
  if (m.parte) {
    const { data, error } = await db.rpc("servidor_registrar_fase", {
      p_sesion: s.id, p_cliente: m.cliente_id, p_servicio: Number(m.servicio_id), p_parte: m.parte, p_importe: Number(s.amount_total || 0) / 100,
    });
    if (error) throw error;
    if (m.codigo_id && !m.codigo_fijado) await db.rpc("servidor_usar_codigo", { p_codigo: Number(m.codigo_id), p_cliente: m.cliente_id, p_sesion: s.id, p_descuento: Number(m.descuento || 0), p_servicio: m.servicio_id ? Number(m.servicio_id) : null });
    await metodoPago(db, s.id, m.cliente_id).catch(() => {});
    await guardarFactura(db, s.id, m.cliente_id).catch((e) => console.error("Factura: " + e.message));
    if (m.parte === "final") await altaCuotasSegura(db, s, data?.caso_id ?? null);
    return data;
  }
  const { data, error } = await db.rpc("servidor_registrar_pago", {
    p_sesion: s.id, p_cliente: m.cliente_id, p_tipo: m.tipo, p_nombre: m.nombre,
    p_importe: m.cuota ? Number(m.cuota) : Number(s.amount_total || 0) / 100, p_modo: s.mode, p_servicio: m.servicio_id ? Number(m.servicio_id) : null,
  });
  if (error) throw error;
  // Suscripción: se apunta qué suscripción de Stripe cobra este servicio (renovaciones, impagos y bajas)
  if (s.mode === "subscription" && s.subscription && data?.servicio_id) {
    await db.rpc("servidor_vincular_suscripcion", { p_servicio: Number(data.servicio_id), p_suscripcion: idDe(s.subscription) });
  }
  if (m.codigo_id) await db.rpc("servidor_usar_codigo", { p_codigo: Number(m.codigo_id), p_cliente: m.cliente_id, p_sesion: s.id, p_descuento: Number(m.descuento || 0), p_servicio: null });
  await metodoPago(db, s.id, m.cliente_id).catch(() => {});
  await guardarFactura(db, s.id, m.cliente_id).catch((e) => console.error("Factura: " + e.message));
  if (s.mode === "payment") await altaCuotasSegura(db, s, data?.caso_id ?? null);
  return data;
}

// Factura de Stripe del pago (o, si no la hay, su recibo) en «Servicios y facturas» del portal: una sola vez por pago
const fechaEs = (seg: number) => new Date(seg * 1000).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" });
const eurosEs = (cent: number) => (cent / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
async function guardarFactura(db: SupabaseClient, sesion: string, cliente: string) {
  if (!cliente) return;
  const s = await stripe("checkout/sessions/" + encodeURIComponent(sesion) + "?expand[]=invoice&expand[]=payment_intent.latest_charge");
  const inv = s.invoice && typeof s.invoice === "object" ? s.invoice : null, ch = s.payment_intent?.latest_charge;
  let f: Record<string, unknown> | null = null;
  if (inv && inv.status !== "draft" && (inv.hosted_invoice_url || inv.invoice_pdf)) {
    f = { numero: inv.number || "Factura", fecha: fechaEs(inv.status_transitions?.paid_at || inv.created), importe: eurosEs(inv.amount_paid ?? s.amount_total ?? 0),
      url: inv.invoice_pdf || inv.hosted_invoice_url, sesion };
  } else if (ch && typeof ch === "object" && ch.receipt_url) {
    f = { numero: "Recibo " + (ch.receipt_number || sesion.slice(-8).toUpperCase()), fecha: fechaEs(ch.created), importe: eurosEs(s.amount_total ?? ch.amount ?? 0),
      url: ch.receipt_url, sesion };
  }
  if (!f) return;
  const { error } = await db.rpc("servidor_anadir_factura", { p_cliente: cliente, p_factura: f });
  if (error) throw error;
}
// Factura de una renovación o de una cuota (viene directamente en el aviso de Stripe)
async function guardarFacturaDe(db: SupabaseClient, inv: Record<string, any>, cliente: string) {
  if (!cliente || !(inv.invoice_pdf || inv.hosted_invoice_url)) return;
  const f = { numero: inv.number || "Factura", fecha: fechaEs(inv.status_transitions?.paid_at || inv.created), importe: eurosEs(inv.amount_paid ?? 0),
    url: inv.invoice_pdf || inv.hosted_invoice_url, sesion: inv.id };
  const { error } = await db.rpc("servidor_anadir_factura", { p_cliente: cliente, p_factura: f });
  if (error) throw error;
}

// Apunta en la ficha del cliente la tarjeta con la que ha pagado («Visa terminada en 4242»)
async function metodoPago(db: SupabaseClient, sesion: string, cliente: string) {
  const s = await stripe("checkout/sessions/" + encodeURIComponent(sesion) + "?expand[]=payment_intent.payment_method&expand[]=subscription.default_payment_method");
  const card = s.payment_intent?.payment_method?.card || s.subscription?.default_payment_method?.card;
  if (!card?.last4 || !cliente) return;
  const marca = String(card.brand || "Tarjeta").replace(/^\w/, (c: string) => c.toUpperCase());
  await db.from("webs_cliente").upsert({ cliente_id: cliente, metodo_pago: marca + " terminada en " + card.last4 }, { onConflict: "cliente_id" });
}

// ---------- Avisos de Stripe sobre suscripciones ----------
// Factura cobrada: renovación mensual o cuota de un pago a plazos (la primera de una suscripción normal ya la registra Checkout)
async function facturaCobrada(db: SupabaseClient, inv: Record<string, any>) {
  const sub = subDeFactura(inv), md = metaDeFactura(inv), cliente = md.cliente_id;
  if (!sub || !cliente) return;
  const importe = Number(inv.amount_paid || 0) / 100;
  if (md.financiar) {
    const { error } = await db.rpc("servidor_registrar_plazo", {
      p_factura: inv.id, p_cliente: cliente, p_servicio: Number(md.servicio_id), p_importe: importe, p_total: Number(md.financiar),
    });
    if (error) throw error;
  } else if (inv.billing_reason === "subscription_cycle") {
    const { error } = await db.rpc("servidor_renovacion", { p_factura: inv.id, p_cliente: cliente, p_suscripcion: sub, p_nombre: md.nombre || "", p_importe: importe });
    if (error) throw error;
  } else return;
  await guardarFacturaDe(db, inv, cliente).catch((e) => console.error("Factura: " + e.message));
}
// Cobro fallido: Stripe lo reintenta solo; se marca, el cliente ve el aviso y el equipo recibe uno en el móvil
async function facturaFallida(db: SupabaseClient, inv: Record<string, any>) {
  const sub = subDeFactura(inv), md = metaDeFactura(inv);
  if (!sub) return;
  const intento = Number(inv.attempt_count || 1), proximo = isoDe(Number(inv.next_payment_attempt || 0));
  const { data, error } = await db.rpc("servidor_impago", {
    p_factura: inv.id, p_cliente: md.cliente_id || null, p_suscripcion: sub, p_nombre: md.nombre || null,
    p_importe: Number(inv.amount_due || 0) / 100, p_intento: intento, p_proximo: proximo,
  });
  if (error) throw error;
  if (data?.servicio_id && (intento <= 1 || !proximo)) {
    await avisarEquipo(db, "⚠️ Cobro fallido · " + data.nombre,
      `No se han podido cobrar ${eurosEs(Number(inv.amount_due || 0))}. ` + (proximo ? `Stripe lo reintentará el ${fechaCorta(proximo)}.` : "Stripe ya no lo reintentará: habla con el cliente."),
      "cliente=" + data.cliente_id);
  }
}
// Cambio en la suscripción: si queda programada para cancelarse, se apunta la fecha (también si la anula)
async function suscripcionCambiada(db: SupabaseClient, sub: Record<string, any>) {
  if (sub.metadata?.financiar) return;   // el final de un pago a plazos lo fija este mismo servidor
  const fin = sub.cancel_at_period_end || sub.cancel_at ? isoDe(finPeriodo(sub)) : null;
  const { error } = await db.rpc("servidor_baja_programada", { p_suscripcion: sub.id, p_fin: fin });
  if (error) throw error;
}
// Suscripción terminada: baja efectiva (al final del periodo o por impago)
async function suscripcionTerminada(db: SupabaseClient, sub: Record<string, any>) {
  const { data, error } = await db.rpc("servidor_fin_suscripcion", { p_suscripcion: sub.id });
  if (error) throw error;
  if (data?.servicio_id && !data.plazos) {
    await avisarEquipo(db, "Baja · " + data.nombre, data.impago ? "Se ha dado de baja por falta de pago." : "Ha terminado su periodo pagado y se ha dado de baja.", "cliente=" + data.cliente_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const texto = await req.text();

    // Avisos automáticos de Stripe
    const firma = req.headers.get("stripe-signature");
    if (firma) {
      if (!(await firmaValida(texto, firma))) return responder({ error: "Firma no válida." }, 400);
      const ev = JSON.parse(texto), o = ev.data.object;
      if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") await registrar(db, o);
      else if (ev.type === "invoice.paid") await facturaCobrada(db, o);
      else if (ev.type === "invoice.payment_failed") await facturaFallida(db, o);
      else if (ev.type === "customer.subscription.updated") await suscripcionCambiada(db, o);
      else if (ev.type === "customer.subscription.deleted") await suscripcionTerminada(db, o);
      return responder({ recibido: true });
    }

    const b = JSON.parse(texto || "{}");
    // Titular o persona invitada con permiso de «Facturación y pagos»
    const { data: cid } = await db.rpc("servidor_acceso", { p_token: String(b.token || ""), p_permisos: "facturacion" });
    if (!cid) {
      const { data: inv } = await db.rpc("servidor_invitado_de_token", { p_token: String(b.token || "") });
      if (inv) return responder({ error: "Tu usuario no tiene permiso para pagos. Pídeselo al titular de la cuenta." }, 403);
      return responder({ error: "Tu sesión ha caducado. Vuelve a entrar." }, 401);
    }

    if (b.accion === "crear") {
      let nombre = String(b.nombre || ""), servicioId: number | null = null;
      if (b.servicio_id) {
        const { data: s } = await db.from("servicios_cliente").select("id,nombre,pagado_en,estado,tipo,importe,anticipo_en,aprobado_en,codigo_id,plazos_total").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
        if (!s) return responder({ error: "Pedido no encontrado." }, 404);
        if (s.pagado_en) return responder({ error: "Este pedido ya está pagado." }, 400);
        if (s.plazos_total) return responder({ error: "Este pedido se está pagando a plazos: las cuotas se cobran solas cada mes." }, 400);
        nombre = s.nombre; servicioId = s.id;
        // Proyecto web por fases: 50 % de anticipo y 50 % al aprobar el diseño final
        if (s.tipo === "web") {
          if (!s.importe) return responder({ error: "Todavía no tenemos tu precio cerrado: te lo enviamos por el chat antes de empezar." }, 400);
          const parte = s.anticipo_en ? "final" : "anticipo";
          if (parte === "final" && !s.aprobado_en) return responder({ error: "El 50 % restante se paga cuando apruebes el diseño final en la demo." }, 400);
          if (!b.acepta) return responder({ error: "Para pagar tienes que aceptar el Aviso Legal y las Condiciones de Contratación. Recarga la página e inténtalo de nuevo." }, 400);
          const total = Number(s.importe), anticipo = Math.round(total * 50) / 100;
          let eur = parte === "anticipo" ? anticipo : Math.round((total - anticipo) * 100) / 100;
          // Código: el que ya quedó fijado en el anticipo se aplica solo al pago final; si no, el que escriba ahora el cliente
          let cod: Codigo | null = null, fijado = false;
          if (s.codigo_id) {
            const { data: c } = await db.from("codigos_promo").select("id,codigo,tipo,valor").eq("id", s.codigo_id).maybeSingle();
            if (c) { cod = c as Codigo; fijado = true; }
          } else if (b.codigo) cod = await validarCodigo(db, String(b.codigo), cid, "web");
          const rebaja = cod ? descontar(eur, cod, true) : null;
          if (rebaja) eur = rebaja.ahora;
          const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
          const d: Record<string, string> = {
            mode: "payment", "managed_payments[enabled]": "false", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
            "line_items[0][price_data][unit_amount]": String(Math.round(eur * 100)),
            "line_items[0][price_data][product_data][name]": nombre + (parte === "anticipo" ? " · anticipo del 50 %" : " · pago final del 50 %") + (cod ? ` (código ${cod.codigo} ${textoCodigo(cod)})` : ""),
            client_reference_id: cid,
            "metadata[cliente_id]": cid, "metadata[tipo]": "web", "metadata[nombre]": nombre, "metadata[servicio_id]": String(s.id), "metadata[parte]": parte,
            "metadata[acepta_condiciones]": String(b.acepta).slice(0, 60), "metadata[acepta_en]": new Date().toISOString(),
            "invoice_creation[enabled]": "true", "invoice_creation[invoice_data][metadata][cliente_id]": cid,
            "invoice_creation[invoice_data][description]": nombre + (parte === "anticipo" ? " · anticipo del 50 %" : " · pago final del 50 %"),
            "invoice_creation[invoice_data][footer]": PIE_FACTURA, "line_items[0][tax_rates][0]": await ivaIncluido(),
            success_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=ok&sesion={CHECKOUT_SESSION_ID}",
            cancel_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=cancelado",
            locale: "es",
          };
          if (c?.email) d.customer_email = c.email;
          if (cod && rebaja) { d["metadata[codigo_id]"] = String(cod.id); d["metadata[codigo]"] = cod.codigo; d["metadata[descuento]"] = String(rebaja.descuento); if (fijado) d["metadata[codigo_fijado]"] = "1"; }
          if (parte === "final") conCuotas(d, await cuotasPendientes(db, cid, cuotasDe(nombre, true)));
          const ses = await stripe("checkout/sessions", d);
          return responder({ url: ses.url });
        }
      }
      const it = await delCatalogo(db, nombre);
      if (!it) return responder({ error: "Este servicio se paga por presupuesto: el equipo te enviará el importe por el chat." }, 400);
      if (!it.activo && !servicioId) return responder({ error: "Este servicio ya no está disponible." }, 400);
      if (it.cada && !suscripcionesActivas()) return responder({ error: "Los planes de suscripción estarán disponibles muy pronto. Ahora mismo solo contratamos servicios de pago único." }, 400);
      if (!b.acepta) return responder({ error: "Para pagar tienes que aceptar el Aviso Legal y las Condiciones de Contratación. Recarga la página e inténtalo de nuevo." }, 400);
      const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
      const cod = b.codigo && !it.cada ? await validarCodigo(db, String(b.codigo), cid, it.tipo) : null;
      const rebaja = cod ? descontar(it.eur, cod, false) : null;
      if (rebaja) it.eur = rebaja.ahora;
      const d: Record<string, string> = {
        mode: it.cada ? "subscription" : "payment", "managed_payments[enabled]": "false",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round((it.cada ? it.normal : it.eur) * 100)),
        "line_items[0][price_data][product_data][name]": nombre + (it.oferta && !it.cada ? " (oferta -" + it.oferta + "%)" : "") + (cod ? ` (código ${cod.codigo} ${textoCodigo(cod)})` : ""),
        client_reference_id: cid,
        "metadata[cliente_id]": cid, "metadata[tipo]": it.tipo, "metadata[nombre]": nombre,
        // Constancia de la aceptación de las condiciones (versión y momento), guardada en el propio pago de Stripe
        "metadata[acepta_condiciones]": String(b.acepta).slice(0, 60), "metadata[acepta_en]": new Date().toISOString(),
        success_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=ok&sesion={CHECKOUT_SESSION_ID}",
        cancel_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=cancelado",
        locale: "es",
      };
      if (servicioId) d["metadata[servicio_id]"] = String(servicioId);
      if (cod && rebaja) { d["metadata[codigo_id]"] = String(cod.id); d["metadata[codigo]"] = cod.codigo; d["metadata[descuento]"] = String(rebaja.descuento); }
      d["line_items[0][tax_rates][0]"] = await ivaIncluido();
      if (!it.cada) { d["invoice_creation[enabled]"] = "true"; d["invoice_creation[invoice_data][metadata][cliente_id]"] = cid; d["invoice_creation[invoice_data][footer]"] = PIE_FACTURA; }
      if (c?.email) d.customer_email = c.email;
      if (!it.cada) conCuotas(d, await cuotasPendientes(db, cid, cuotasDe(nombre, false)));
      if (it.cada) {
        d["line_items[0][price_data][recurring][interval]"] = "month";
        d["line_items[0][price_data][recurring][interval_count]"] = String(it.cada);
        d["subscription_data[metadata][cliente_id]"] = cid;
        d["subscription_data[metadata][nombre]"] = nombre;
        d["subscription_data[metadata][tipo]"] = it.tipo;
        d["metadata[cuota]"] = String(it.normal);
        if (it.oferta) d["discounts[0][coupon]"] = await cuponPrimerMes(it.oferta);
      }
      const s = await stripe("checkout/sessions", d);
      return responder({ url: s.url });
    }

    // Pago a plazos de un pedido: N cuotas mensuales automáticas (la primera hoy)
    if (b.accion === "financiar") {
      if (!suscripcionesActivas()) return responder({ error: "El pago a plazos estará disponible muy pronto." }, 400);
      const n = Number(b.plazos), recargo = PLAZOS[n];
      if (recargo === undefined) return responder({ error: "Elige 3, 6 o 12 plazos." }, 400);
      const { data: s } = await db.from("servicios_cliente").select("id,nombre,tipo,importe,pagado_en,anticipo_en,plazos_total,caso_id").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
      if (!s) return responder({ error: "Pedido no encontrado." }, 404);
      if (s.pagado_en) return responder({ error: "Este pedido ya está pagado." }, 400);
      if (s.plazos_total) return responder({ error: "Este pedido ya se está pagando a plazos." }, 400);
      let base = 0;
      if (s.tipo === "web") {
        if (!s.importe) return responder({ error: "Primero te enviamos el precio cerrado por el chat; después podrás pagarlo a plazos." }, 400);
        if (s.anticipo_en) return responder({ error: "Ya pagaste el anticipo: el 50 % restante se paga de una vez al aprobar el diseño." }, 400);
        base = Number(s.importe);
      } else {
        const it = await delCatalogo(db, s.nombre);
        if (!it || it.cada) return responder({ error: "Este pedido no se puede pagar a plazos." }, 400);
        base = it.eur;
      }
      if (base < FINANCIACION_MINIMO) return responder({ error: `El pago a plazos es para pedidos desde ${FINANCIACION_MINIMO} €.` }, 400);
      if (!b.acepta) return responder({ error: "Para continuar tienes que aceptar las condiciones. Recarga la página e inténtalo de nuevo." }, 400);
      const total = r2(base * (1 + recargo)), cuota = r2(total / n);
      const { data: c } = await db.from("clientes").select("email").eq("id", cid).maybeSingle();
      const desc = `${s.nombre} · pago a plazos (${n} cuotas de ${cuota.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €)`;
      const d: Record<string, string> = {
        mode: "subscription", "managed_payments[enabled]": "false",
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(cuota * 100)),
        "line_items[0][price_data][product_data][name]": desc,
        "line_items[0][price_data][recurring][interval]": "month", "line_items[0][price_data][recurring][interval_count]": "1",
        "line_items[0][tax_rates][0]": await ivaIncluido(),
        client_reference_id: cid,
        "metadata[cliente_id]": cid, "metadata[tipo]": s.tipo, "metadata[nombre]": s.nombre, "metadata[servicio_id]": String(s.id),
        "metadata[financiar]": String(n), "metadata[total]": String(total),
        "metadata[acepta_condiciones]": String(b.acepta).slice(0, 60), "metadata[acepta_en]": new Date().toISOString(),
        "subscription_data[metadata][cliente_id]": cid, "subscription_data[metadata][nombre]": s.nombre,
        "subscription_data[metadata][servicio_id]": String(s.id), "subscription_data[metadata][financiar]": String(n),
        "subscription_data[metadata][total]": String(total), "subscription_data[description]": desc,
        success_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=ok&sesion={CHECKOUT_SESSION_ID}",
        cancel_url: URL_PORTAL + (URL_PORTAL.includes("?") ? "&" : "?") + "pago=cancelado",
        locale: "es",
      };
      if (c?.email) d.customer_email = c.email;
      const ses = await stripe("checkout/sessions", d);
      return responder({ url: ses.url });
    }

    // Baja: se crea el caso (como siempre) y la suscripción de Stripe se cancela al final del periodo pagado
    if (b.accion === "cancelar") {
      let s: Record<string, any> | null = null, caso: Record<string, any> | null = null;
      if (b.servicio_id) {
        const { data } = await db.from("servicios_cliente").select("id,nombre,stripe_suscripcion,plazos_total").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
        if (!data) return responder({ error: "Servicio no encontrado." }, 404);
        if (data.plazos_total) return responder({ error: "Un pago a plazos no se puede cancelar desde aquí. Si quieres pagar lo que falta de una vez, escríbenos por el chat." }, 400);
        s = data;
        const r = await db.rpc("cliente_baja_servicio", { p_token: String(b.token), p_servicio: s.id });
        if (r.error) return responder({ error: r.error.message }, 400);
        caso = r.data;
      } else {
        const r = await db.rpc("cliente_cancelar_plan", { p_token: String(b.token), p_motivo: String(b.motivo || "").slice(0, 1000) });
        if (r.error) return responder({ error: r.error.message }, 400);
        caso = r.data;
        const { data: w } = await db.from("webs_cliente").select("plan").eq("cliente_id", cid).maybeSingle();
        const { data: l } = await db.from("servicios_cliente").select("id,nombre,stripe_suscripcion")
          .eq("cliente_id", cid).in("tipo", ["mantenimiento", "renting"]).eq("estado", "activo").not("stripe_suscripcion", "is", null)
          .order("creado_en", { ascending: false });
        s = (l || []).find((x) => x.nombre === w?.plan) || (l || [])[0] || null;
      }
      let fin: string | null = null;
      if (s?.stripe_suscripcion) {
        const sub = await stripe("subscriptions/" + encodeURIComponent(s.stripe_suscripcion), { cancel_at_period_end: "true" });
        fin = isoDe(finPeriodo(sub));
        await db.rpc("servidor_baja_programada", { p_suscripcion: s.stripe_suscripcion, p_fin: fin });
        if (caso?.id && fin) {
          await db.from("mensajes_caso").insert({ caso_id: caso.id, autor_tipo: "staff", autor: "sistema",
            texto: `La suscripción de «${s.nombre}» ya está cancelada en Stripe: sigue activa hasta el ${fechaCorta(fin)} y no se hará ningún cobro más. No hace falta hacer nada más; se dará de baja sola ese día.` });
        }
      }
      return responder({ caso, fin });
    }

    if (b.accion === "codigo") {
      // Solo calcula: el cobro real lo vuelve a comprobar «crear»
      let tipo = "", eur = 0, fase = false;
      if (b.servicio_id) {
        const { data: s } = await db.from("servicios_cliente").select("nombre,tipo,importe,anticipo_en,codigo_id").eq("id", Number(b.servicio_id)).eq("cliente_id", cid).maybeSingle();
        if (!s) return responder({ error: "Pedido no encontrado." }, 404);
        if (s.tipo === "web") {
          if (s.codigo_id) return responder({ error: "Ya aplicaste un código en el anticipo: se descuenta también en este pago." }, 400);
          const total = Number(s.importe || 0), anticipo = Math.round(total * 50) / 100;
          tipo = "web"; fase = true; eur = s.anticipo_en ? Math.round((total - anticipo) * 100) / 100 : anticipo;
        } else { const it = await delCatalogo(db, s.nombre); if (!it) return responder({ error: "Este pedido no admite códigos." }, 400); tipo = it.tipo; eur = it.eur; }
      } else { const it = await delCatalogo(db, String(b.nombre || "")); if (!it || it.cada) return responder({ error: "Este servicio no admite códigos." }, 400); tipo = it.tipo; eur = it.eur; }
      const cod = await validarCodigo(db, String(b.codigo || ""), cid, tipo);
      const r = descontar(eur, cod, fase);
      return responder({ ok: true, codigo: cod.codigo, texto: textoCodigo(cod), antes: eur, ahora: r.ahora, descuento: r.descuento, fase });
    }

    if (b.accion === "facturas") {
      const { data: ps } = await db.from("pagos").select("sesion").eq("cliente_id", cid).like("sesion", "cs_%").order("creado_en", { ascending: false }).limit(50);
      for (const p of ps || []) await guardarFactura(db, p.sesion, cid).catch((e) => console.error("Factura " + p.sesion + ": " + e.message));
      const { data: w } = await db.from("webs_cliente").select("facturas").eq("cliente_id", cid).maybeSingle();
      return responder({ facturas: w?.facturas || [] });
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
