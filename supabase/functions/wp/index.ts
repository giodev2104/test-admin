// Edge Function "wp": recibe los datos que envía el plugin «Webcare Conector» desde la web WordPress del cliente.
//   · Cada día (y al pulsar «Probar conexión» en el plugin): actualizaciones del mes, ataques bloqueados
//     (Wordfence), amenazas activas (Wordfence), última copia y copias guardadas (UpdraftPlus) y datos técnicos.
//   · Se identifica con la clave de conexión que genera el panel (ficha del cliente > «Conectar WordPress»);
//     en la base de datos solo se guarda su huella (sha256).
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "wp", y DESACTIVA «Verify JWT».
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const entero = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : undefined);
const texto = (v: unknown, max = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function huella(clave: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clave));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ error: "Usa POST." }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const clave = String(b.clave || "");
    if (!/^wc_[0-9a-f]{48}$/.test(clave)) return responder({ error: "Clave de conexión no válida." }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: w } = await db.from("webs_cliente").select("cliente_id").eq("wp_clave_hash", await huella(clave)).maybeSingle();
    if (!w) return responder({ error: "Esta clave no corresponde a ningún cliente. Genera una nueva en el panel de Webcare." }, 401);

    const d = (b.datos && typeof b.datos === "object") ? b.datos : {};
    const cambios: Record<string, unknown> = { wp_visto_en: new Date().toISOString() };
    const pon = (campo: string, v: unknown) => { if (v !== undefined) cambios[campo] = v; };
    pon("mes_actualizaciones", entero(d.actualizaciones_mes));
    pon("mes_ataques", entero(d.ataques_mes));
    pon("amenazas", entero(d.amenazas));
    pon("copias_guardadas", entero(d.copias));
    if (typeof d.ultima_copia === "string" && !isNaN(Date.parse(d.ultima_copia))) cambios.ultima_copia = new Date(d.ultima_copia).toISOString();
    const pend = d.pendientes && typeof d.pendientes === "object" ? d.pendientes : {};
    cambios.wp_datos = {
      sitio: texto(d.sitio, 200), wp: texto(d.wp, 20), php: texto(d.php, 20), plugin: texto(b.version_plugin, 20),
      seguridad: texto(d.seguridad, 40), copias_con: texto(d.copias_con, 40),
      pendientes: { nucleo: entero(pend.nucleo) ?? 0, plugins: entero(pend.plugins) ?? 0, temas: entero(pend.temas) ?? 0 },
    };
    const { error } = await db.from("webs_cliente").update(cambios).eq("cliente_id", w.cliente_id);
    if (error) throw error;
    const { data: c } = await db.from("clientes").select("nombre").eq("id", w.cliente_id).maybeSingle();
    return responder({ ok: true, cliente: c?.nombre || null });
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
