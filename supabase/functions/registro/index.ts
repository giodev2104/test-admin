// Edge Function "registro": crea la cuenta de un cliente desde el portal, protegida con Turnstile (Cloudflare).
//   {email, clave, nombre, dominio?, plan?, acepta, trampa?, turnstile} → sesión del cliente (como cliente_registrar)
// Comprueba el token de Turnstile en el servidor y después llama a servidor_registrar con la IP real del visitante
// (límite de cuentas por IP). Si falta el secreto TURNSTILE_SECRET, no comprueba Turnstile (para no bloquear el alta).
// Configuración (Supabase > Edge Functions > Secrets): TURNSTILE_SECRET = la «Secret Key» del widget de Turnstile.
// Despliegue: nombre "registro" y DESACTIVA «Verify JWT» (lo usan visitantes sin cuenta).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const ipDe = (req: Request) => (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const ip = ipDe(req);
    if (!(await turnstileValido(b.turnstile, ip))) {
      return responder({ error: "No hemos podido comprobar que no eres un robot. Recarga la página e inténtalo de nuevo." }, 400);
    }
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data, error } = await db.rpc("servidor_registrar", {
      p_ip: ip, p_email: String(b.email || ""), p_clave: String(b.clave || ""), p_nombre: String(b.nombre || ""),
      p_dominio: b.dominio ? String(b.dominio) : null, p_plan: b.plan ? String(b.plan) : null,
      p_acepta: b.acepta === true, p_trampa: String(b.trampa || ""),
    });
    if (error) return responder({ error: error.message }, 400);
    return responder(data);
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
