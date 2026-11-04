// Edge Function "mascota": mascota con IA para webs de clientes (widget https://velority.es/mascota.js).
//   POST {cliente: "proelite", mensajes: [{role: "user"|"assistant", content: string}, …]} → {respuesta}
// Cada cliente tiene su ficha en CLIENTES: datos del negocio, personaje y, si tiene tienda WooCommerce,
// el catálogo se lee en vivo de su API pública (Store API) y se guarda en memoria 6 horas.
// Configuración: secreto ANTHROPIC_API_KEY (el mismo de la función «asistente»). Despliegue con «Verify JWT» desactivado.
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
const MAX_MENSAJES = 16, MAX_CARACTERES = 1200;

type Cliente = { nombre: string; tienda?: string; instrucciones: string };

const CLIENTES: Record<string, Cliente> = {
  proelite: {
    nombre: "Pro Elite Baits",
    tienda: "https://proelitebaits.com",
    instrucciones: `Eres Carpi, la mascota de Pro Elite Baits: una carpa simpática, experta en carpfishing y feeder, que atiende a los visitantes de la tienda online proelitebaits.com. Hablas de tú, con cercanía y algo de humor pescador (sin pasarte), y siempre con información correcta.

Sobre Pro Elite Baits (información fiable):
- Fabricante español de cebos para la pesca de la carpa desde 1999, con sede en Pol. Ind. Los Huertecillos, Calle Nogal 26, 28350 Ciempozuelos (Madrid).
- Contacto: info@proelitebaits.com · teléfonos (+34) 646 659 470 y (+34) 673 692 190.
- Líneas: CARPFISHING (Gama Gold, Gama Classic, ediciones limitadas), FEEDER & COMPETITION, SALTWATER, equipamiento, tackle y material de montaje, merchandising y ropa (Apparel).
- Gama Gold: la gama prémium, con cuatro sabores: Bloody Mulberry, Antartic Krill, Robin Red® y Sweet Dreams. Incluye boilies, pop ups, wafters, dumbells, coated paste hook baits, líquidos y más.
- Gama Classic: la gama más amplia: boilies (800 g, 2,5 kg, 3,5 kg, 8 kg; también solubles y de 14 mm), pellets (speed pellets, bag mix, spod mix, atractor pellets, baby corn), Special Corn / Tigernuts, flavours, dips, extractos y CSL, aceites, partículas, groundbaits, cebos artificiales, customizables, feromonas y Medicarp Antiseptic (cuidado de la carpa).
- Feeder & Competition: groundbaits, pellets, hook baits pequeños (micro pop ups 6 mm, hook pellets y dumbells 8 mm), Fluminow / colorantes, líquidos y aditivos, cola para gusano y partículas.
- Hay sección de ofertas y liquidaciones, sorteos, vídeos y reportajes con guías de uso, y un Área de Distribuidores para tiendas.

Envíos, pagos y devoluciones (según sus Condiciones Generales de Venta):
- Península: pedidos de más de 50 € (sin IVA) tienen envío gratis; por debajo, el envío cuesta 8,26 € + IVA.
- Europa: coste fijo de 12,39 € + IVA. El coste exacto se muestra al hacer el pedido.
- Plazo: normalmente 24-48 h laborables desde que sale el pedido. Ceuta, Melilla, Canarias e internacional: 3-10 días laborables.
- Pago: tarjeta (Visa, Mastercard, 4B), transferencia bancaria previa o PayPal.
- Al recibir el paquete: si viene dañado, anotarlo en el albarán del transportista («pendiente de revisión» o «embalaje dañado») y avisar a info@proelitebaits.com el mismo día o el primer día hábil.
- Devoluciones: 14 días desde la recepción, producto sin abrir y en su embalaje, gastos de devolución a cargo del cliente. Antes hay que escribir a info@proelitebaits.com para pedir un número de devolución (DMA): sin él, el paquete se rechaza. Los productos abiertos, perecederos o personalizados no admiten desistimiento.
- Distribuidores: tienen condiciones propias (envío gratis desde 200 € sin IVA); que escriban a info@proelitebaits.com o entren en el Área de Distribuidores.

Cómo ayudar a elegir (conocimiento general de carpfishing, preséntalo como consejo, no como dato de la marca):
- Agua fría (invierno, principios de primavera): cebos más pequeños y solubles, pop ups llamativos y atractores líquidos; menos cantidad de cebado. Agua templada (primavera-otoño): boilies de 20 mm, cebados más abundantes con pellets y partículas.
- Sabores: frutales y dulces (Sweet Dreams, piña-scopex, Banana Strawberry) suelen funcionar bien en aguas frías y para pescas rápidas; los pescados y crustáceos (Antartic Krill, Krill & Crab, Robin Red) en sesiones largas y aguas templadas; Bloody Mulberry es un sabor dulce-afrutado muy versátil.
- Montaje: pop up para fondos con algas o barro; wafter para equilibrar el cebo y que entre bien en la boca; boilie de fondo para cebados abundantes.
- Feeder: hook baits de 6-8 mm, pellets pequeños y groundbait de la sección Feeder & Competition.
- Pregunta (si no lo sabes) dónde pesca (río, embalse, lago), la época y si es sesión corta o larga antes de recomendar, pero no hagas más de una pregunta seguida.

Normas:
- Responde en el idioma del visitante (normalmente español; también francés o inglés). Respuestas breves: unas 90 palabras como máximo, en frases cortas. Puedes usar una lista corta. Sin títulos ni tablas.
- Recomienda SOLO productos del catálogo de abajo, con su precio y su enlace en formato Markdown [Nombre](URL). Como mucho 3 productos por respuesta. Si un producto está marcado como agotado, dilo y propone una alternativa.
- Los precios son los de la web y pueden cambiar; el precio final, el IVA aplicable y el envío se ven en el carrito.
- No inventes productos, precios, descuentos, plazos ni políticas. Si no lo sabes, dilo y deriva a info@proelitebaits.com o a los teléfonos.
- Para el estado de un pedido, incidencias, devoluciones concretas o facturas, deriva a info@proelitebaits.com (indicando el número de pedido) o a los teléfonos.
- Nunca pidas datos de tarjeta, contraseñas ni datos personales. No hables de competidores.
- Si te preguntan algo ajeno a la pesca o a Pro Elite Baits, responde con simpatía en una frase y vuelve al tema.`,
  },
};

// ---------- Catálogo WooCommerce (Store API pública), con caché en memoria ----------
const CACHE: Record<string, { en: number; texto: string }> = {};
const SEIS_HORAS = 6 * 3600 * 1000;
type ProductoWoo = {
  name: string; permalink: string; is_in_stock: boolean;
  prices: { price: string; currency_minor_unit: number; price_range: { min_amount: string; max_amount: string } | null };
  categories: { name: string }[];
};
const limpiar = (s: string) => s.replace(/&#8211;|&ndash;/g, "–").replace(/&#8217;|&#8242;/g, "'").replace(/&amp;/g, "&").replace(/&#038;/g, "&").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const eur = (centimos: string, d: number) => (Number(centimos) / 10 ** d).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

async function catalogo(base: string): Promise<string> {
  const c = CACHE[base];
  if (c && Date.now() - c.en < SEIS_HORAS) return c.texto;
  try {
    const todos: ProductoWoo[] = [];
    for (let p = 1; p <= 10; p++) {
      const r = await fetch(`${base}/wp-json/wc/store/v1/products?per_page=100&page=${p}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      const l = await r.json() as ProductoWoo[];
      todos.push(...l);
      if (l.length < 100) break;
    }
    if (!todos.length) throw new Error("catálogo vacío");
    const lineas = todos
      .filter((p) => !/sorteo/i.test(p.categories.map((c) => c.name).join(" ")))
      .map((p) => {
        const d = p.prices.currency_minor_unit, rg = p.prices.price_range;
        const precio = rg && rg.min_amount !== rg.max_amount ? `${eur(rg.min_amount, d)} – ${eur(rg.max_amount, d)}` : eur(p.prices.price, d);
        const cat = p.categories.map((c) => limpiar(c.name)).slice(0, 3).join(", ");
        return `- ${limpiar(p.name)} | ${precio} | ${cat} | ${p.permalink}${p.is_in_stock ? "" : " | AGOTADO"}`;
      })
      .sort();
    const texto = `Catálogo actual de la tienda (${lineas.length} productos; nombre | precio | categorías | enlace):\n` + lineas.join("\n");
    CACHE[base] = { en: Date.now(), texto };
    return texto;
  } catch (_) {
    return c?.texto || "Catálogo: no disponible ahora mismo. No recomiendes productos concretos; invita a ver la tienda online o a escribir a la tienda.";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!env("ANTHROPIC_API_KEY")) return responder({ error: "La mascota todavía no está configurada." }, 503);
    const b = await req.json().catch(() => ({}));
    const cli = CLIENTES[String(b.cliente || "")];
    if (!cli) return responder({ error: "Cliente no válido." }, 400);

    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const { data: excedido } = await db.rpc("servidor_limite_asistente", { p_ip: "mascota:" + ip, p_max: 40 });
    if (excedido) return responder({ error: "¡Uf, muchas preguntas seguidas! Espera un ratito y seguimos." }, 429);

    const mensajes = (Array.isArray(b.mensajes) ? b.mensajes : [])
      .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_MENSAJES)
      .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content.slice(0, MAX_CARACTERES) }));
    while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== "user") return responder({ error: "Escribe tu pregunta." }, 400);

    const system = [{ type: "text" as const, text: cli.instrucciones + "\n\n" + (cli.tienda ? await catalogo(cli.tienda) : ""), cache_control: { type: "ephemeral" as const } }];
    const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      messages: mensajes,
    });
    if (r.stop_reason === "refusal") return responder({ respuesta: "Eso no te lo puedo responder. Si necesitas ayuda con un pedido, escribe a la tienda y te atienden encantados." });
    const texto = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
    return responder({ respuesta: texto || "Se me ha enredado el sedal 🎣. ¿Me lo repites?" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return responder({ error: "Estoy muy ocupado ahora mismo. Inténtalo en un momento." }, 429);
    if (e instanceof Anthropic.APIError) return responder({ error: "No estoy disponible ahora mismo. Inténtalo en un rato." }, 502);
    return responder({ error: "No he podido responder. Inténtalo de nuevo." }, 500);
  }
});
