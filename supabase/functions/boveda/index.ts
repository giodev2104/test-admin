// Edge Function "boveda": guarda los accesos (usuario y contraseña) que el cliente comparte con el equipo.
// Las contraseñas se cifran aquí con AES-256-GCM antes de llegar a la base de datos: la clave (secreto BOVEDA_CLAVE)
// vive solo en Supabase > Edge Functions > Secrets, así que ni una copia de la base de datos permite leerlas.
// Cada vez que alguien ve, crea o borra un acceso queda apuntado, y el cliente lo ve en su portal.
//   · Portal (token del cliente):   listar, guardar, ver, borrar
//     También con el token de una persona invitada por el cliente (supabase_boveda_invitados.sql): solo ve esta bóveda
//     y lo que hace queda apuntado con su nombre.
//   · Panel (sesión del staff):     s_listar, s_guardar, s_ver, s_borrar   (con cliente_id / id)
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "boveda", y DESACTIVA «Verify JWT».
// Secreto obligatorio: BOVEDA_CLAVE (una frase larga y aleatoria; si la cambias, las contraseñas guardadas dejan de poder leerse).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const MAX_POR_CLIENTE = 40;
const COLS = "id,servicio,url,usuario,notas,creado_por,creado_en,actualizado_en";

// ---------- Cifrado ----------
let claveCache: CryptoKey | null = null;
async function clave() {
  if (claveCache) return claveCache;
  const frase = env("BOVEDA_CLAVE");
  if (frase.length < 16) throw new Error("SIN_CONFIGURAR");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frase));
  claveCache = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
  return claveCache;
}
const aB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function cifrar(texto: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await clave(), new TextEncoder().encode(texto)));
  return "v1:" + aB64(iv) + ":" + aB64(c);
}
async function descifrar(s: string) {
  const [v, iv, c] = s.split(":");
  if (v !== "v1") throw new Error("Formato desconocido.");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await clave(), deB64(c)));
}

const txt = (v: unknown, max: number) => { const s = String(v ?? "").trim(); return s ? s.slice(0, max) : null; };
async function apuntar(db: SupabaseClient, cliente_id: string, cred: { id?: number; servicio?: string } | null, quien: string, quien_tipo: string, accion: string) {
  await db.from("credenciales_accesos").insert({ cliente_id, credencial_id: cred?.id ?? null, servicio: cred?.servicio ?? null, quien, quien_tipo, accion });
}
async function listar(db: SupabaseClient, cliente_id: string) {
  const [{ data: lista }, { data: accesos }] = await Promise.all([
    db.from("credenciales").select(COLS).eq("cliente_id", cliente_id).order("servicio"),
    db.from("credenciales_accesos").select("servicio,quien,quien_tipo,accion,creado_en").eq("cliente_id", cliente_id).order("creado_en", { ascending: false }).limit(30),
  ]);
  return { ok: true, credenciales: lista || [], accesos: accesos || [] };
}
async function guardar(db: SupabaseClient, cliente_id: string, b: Record<string, unknown>, quien: string, tipo: string) {
  const servicio = txt(b.servicio, 80);
  if (!servicio) return responder({ error: "Indica de qué es el acceso (p. ej. «Hosting» o «WordPress»)." }, 400);
  const fila: Record<string, unknown> = { servicio, url: txt(b.url, 300), usuario: txt(b.usuario, 200), notas: txt(b.notas, 1000), actualizado_en: new Date().toISOString() };
  const clave_ = String(b.clave ?? "");
  if (clave_.length > 500) return responder({ error: "La contraseña es demasiado larga." }, 400);
  if (b.id) {
    const { data: actual } = await db.from("credenciales").select("id,servicio").eq("id", Number(b.id)).eq("cliente_id", cliente_id).maybeSingle();
    if (!actual) return responder({ error: "Ese acceso no existe." }, 404);
    if (clave_) fila.secreto = await cifrar(clave_);
    await db.from("credenciales").update(fila).eq("id", actual.id);
    await apuntar(db, cliente_id, { id: actual.id, servicio }, quien, tipo, "editar");
  } else {
    if (!clave_) return responder({ error: "Escribe la contraseña." }, 400);
    const { count } = await db.from("credenciales").select("id", { count: "exact", head: true }).eq("cliente_id", cliente_id);
    if ((count || 0) >= MAX_POR_CLIENTE) return responder({ error: "Has llegado al máximo de " + MAX_POR_CLIENTE + " accesos." }, 400);
    const { data: nueva, error } = await db.from("credenciales").insert({ ...fila, cliente_id, secreto: await cifrar(clave_), creado_por: quien }).select("id").single();
    if (error) throw error;
    await apuntar(db, cliente_id, { id: nueva.id, servicio }, quien, tipo, "crear");
  }
  return responder(await listar(db, cliente_id));
}
async function ver(db: SupabaseClient, cliente_id: string | null, id: number, quien: string, tipo: string) {
  let q = db.from("credenciales").select("id,cliente_id,servicio,secreto").eq("id", id);
  if (cliente_id) q = q.eq("cliente_id", cliente_id);
  const { data: c } = await q.maybeSingle();
  if (!c) return responder({ error: "Ese acceso no existe." }, 404);
  const valor = await descifrar(c.secreto);
  await apuntar(db, c.cliente_id, c, quien, tipo, "ver");
  return responder({ ok: true, clave: valor });
}
async function borrar(db: SupabaseClient, cliente_id: string | null, id: number, quien: string, tipo: string) {
  let q = db.from("credenciales").select("id,cliente_id,servicio").eq("id", id);
  if (cliente_id) q = q.eq("cliente_id", cliente_id);
  const { data: c } = await q.maybeSingle();
  if (!c) return responder({ error: "Ese acceso no existe." }, 404);
  await db.from("credenciales").delete().eq("id", c.id);
  await apuntar(db, c.cliente_id, c, quien, tipo, "borrar");
  return responder(await listar(db, c.cliente_id));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const b = await req.json().catch(() => ({}));
    const accion = String(b.accion || "");
    await clave();

    if (accion.startsWith("s_")) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await db.auth.getUser(token);
      const { data: s } = user?.email ? await db.from("staff").select("usuario").eq("email", user.email.toLowerCase()).maybeSingle() : { data: null };
      if (!s) return responder({ error: "Sesión no válida." }, 401);
      if (accion === "s_listar") return responder(await listar(db, String(b.cliente_id)));
      if (accion === "s_guardar") return await guardar(db, String(b.cliente_id), b, s.usuario, "staff");
      if (accion === "s_ver") return await ver(db, null, Number(b.id), s.usuario, "staff");
      if (accion === "s_borrar") return await borrar(db, null, Number(b.id), s.usuario, "staff");
      return responder({ error: "Acción desconocida." }, 400);
    }

    let { data: cid } = await db.rpc("servidor_cliente_de_token", { p_token: String(b.token || "") });
    let quien = "cliente";
    if (!cid) {
      const { data: inv } = await db.rpc("servidor_invitado_de_token", { p_token: String(b.token || "") });
      if (inv?.cliente_id) { cid = inv.cliente_id; quien = String(inv.nombre).slice(0, 80) + " (invitado)"; }
    }
    if (!cid) return responder({ error: "Tu sesión ha caducado. Vuelve a entrar." }, 401);
    if (accion === "listar") return responder(await listar(db, cid));
    if (accion === "guardar") return await guardar(db, cid, b, quien, "cliente");
    if (accion === "ver") return await ver(db, cid, Number(b.id), quien, "cliente");
    if (accion === "borrar") return await borrar(db, cid, Number(b.id), quien, "cliente");
    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (msg === "SIN_CONFIGURAR") return responder({ error: "La bóveda no está configurada todavía (falta el secreto BOVEDA_CLAVE)." }, 503);
    return responder({ error: msg }, 500);
  }
});
