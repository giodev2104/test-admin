// Edge Function "asistente": chatbot con IA (Claude) que resuelve dudas de los visitantes y clientes del portal.
//   {mensajes: [{role: "user"|"assistant", content: string}, …]} → {respuesta}
// Responde con los precios y servicios reales de la tabla «catalogo» y deriva al equipo lo que no sabe.
// Configuración (Supabase > Edge Functions > Secrets):
//   ANTHROPIC_API_KEY   clave de la API de Anthropic (console.anthropic.com > API Keys)
// Despliegue: nombre "asistente" y DESACTIVA «Verify JWT» (lo usan también visitantes sin cuenta).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";

const MAX_MENSAJES = 16, MAX_CARACTERES = 1500;

const INSTRUCCIONES = `Eres el asistente virtual de Velority, un negocio de creación de páginas web para pequeños negocios y autónomos en España. Atiendes a visitantes y clientes desde el portal web.

Cómo trabajamos (información fiable):
- Ahora mismo solo vendemos servicios de PAGO ÚNICO: creación de webs (planes de web), landing pages, desarrollos a medida, packs y servicios extra. Sin cuotas ni permanencia.
- Los planes de mantenimiento mensual, el renting web y la financiación aparecen como «Próximamente»: todavía no se pueden contratar.
- Planes de web: se pide presupuesto desde el portal (botón «Pedir presupuesto»). El rango de precio orienta; antes de empezar enviamos por el chat el precio cerrado exacto.
- Pago de una web en dos partes: 50 % de anticipo para empezar; desarrollamos la web en un servidor de pruebas (demo); el cliente tiene 2 rondas de revisión incluidas; al aprobar el diseño final paga el 50 % restante; después entregamos todos los archivos y publicamos la web.
- Garantía de 30 días desde la publicación (con el 100 % pagado) para errores o fallos técnicos. Los cambios fuera de lo pactado se presupuestan aparte.
- Packs y extras se pagan al 100 % al contratarlos, con tarjeta (pago seguro con Stripe).
- La web es del cliente en cuanto completa el pago y el dominio siempre está a su nombre.
- Los precios que se muestran son finales: no se suma nada más.
- En el portal se puede probar gratis una vista previa interactiva de su web durante 10 minutos (botón «🎨 Diseña la tuya gratis»), eligiendo sector, estilo, colores y textos.
- Para hablar con una persona: crear una cuenta en el portal (botón «Empezar» o «Ya soy cliente») y escribir al equipo por el chat; los clientes también pueden abrir una solicitud en «Soporte».

Normas:
- Responde en el idioma del usuario (normalmente español), de forma cercana, clara y breve: como máximo unas 120 palabras. Usa listas cortas solo si ayudan. Sin títulos ni tablas.
- Usa solo la información de este mensaje y del catálogo de abajo. No inventes precios, plazos de entrega, descuentos, funcionalidades ni políticas. Si no lo sabes, dilo y recomienda escribir al equipo por el chat del portal.
- No negocies precios ni prometas descuentos que no estén en el catálogo. Las ofertas vigentes ya vienen indicadas en él.
- Para un presupuesto concreto, problemas con un pago, con su cuenta o con una web ya entregada, deriva al equipo por el chat del portal.
- Nunca pidas contraseñas, datos de tarjeta ni documentos de identidad.
- No des asesoramiento legal ni fiscal; las condiciones están en el Aviso Legal y en las Condiciones de Contratación de Servicios de Pago Único del portal.
- Si te preguntan algo ajeno a webs y a Velority, indícalo con amabilidad y vuelve al tema.`;

// Catálogo vivo (solo lo que está a la venta), con las ofertas en vigor
async function catalogoTexto(db: ReturnType<typeof createClient>) {
  const { data } = await db.from("catalogo").select("nombre,tipo,precio,precio_hasta,cada,activo,oferta_pct,oferta_hasta").eq("activo", true).order("orden");
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const eur = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " €";
  const grupos: Record<string, string> = { web: "Planes de web (por presupuesto)", pack: "Packs (pago único)", extra: "Servicios extra (pago único)" };
  const lineas: string[] = [];
  for (const [tipo, titulo] of Object.entries(grupos)) {
    const filas = (data || []).filter((c) => c.tipo === tipo && !c.cada);
    if (!filas.length) continue;
    lineas.push(titulo + ":");
    for (const c of filas) {
      const of = c.oferta_pct && (!c.oferta_hasta || c.oferta_hasta >= hoy) ? Number(c.oferta_pct) : 0;
      const p = (v: number) => eur(of ? Math.round(v * (100 - of)) / 100 : v);
      const precio = tipo === "web" ? (c.precio_hasta ? p(Number(c.precio)) + " – " + p(Number(c.precio_hasta)) : "desde " + p(Number(c.precio))) : p(Number(c.precio));
      lineas.push("- " + c.nombre + ": " + precio + (of ? " (oferta −" + of + " %" + (c.oferta_hasta ? " hasta el " + c.oferta_hasta : "") + ", precio normal " + eur(Number(c.precio)) + ")" : ""));
    }
  }
  return lineas.length ? "Catálogo actual:\n" + lineas.join("\n") : "Catálogo actual: no disponible ahora mismo; para precios, deriva al equipo.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!env("ANTHROPIC_API_KEY")) return responder({ error: "El asistente todavía no está configurado. Escríbenos por el chat del portal." }, 503);
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const { data: excedido } = await db.rpc("servidor_limite_asistente", { p_ip: ip, p_max: 40 });
    if (excedido) return responder({ error: "Has hecho muchas preguntas seguidas. Espera un rato o escríbenos por el chat del portal." }, 429);

    const b = await req.json().catch(() => ({}));
    const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : [])
      .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_MENSAJES)
      .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content.slice(0, MAX_CARACTERES) }));
    while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== "user") return responder({ error: "Escribe tu pregunta." }, 400);

    const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: INSTRUCCIONES + "\n\n" + (await catalogoTexto(db)), cache_control: { type: "ephemeral" } }],
      messages: mensajes,
    });
    if (r.stop_reason === "refusal") return responder({ respuesta: "Eso no puedo responderlo. Si necesitas ayuda con tu web, escríbenos por el chat del portal y te atenderá el equipo." });
    const texto = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
    return responder({ respuesta: texto || "No he podido responder ahora. Escríbenos por el chat del portal y te ayudamos." });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "El asistente está muy ocupado. Inténtalo en un momento." }, 429);
    if (e instanceof Anthropic.APIError) return responder({ error: "El asistente no está disponible ahora mismo. Escríbenos por el chat del portal." }, 502);
    return responder({ error: "No se pudo responder. Inténtalo de nuevo." }, 500);
  }
});
