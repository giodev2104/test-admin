// Edge Function "gestionar-staff": la usa el panel para añadir y quitar administradores y para nombrar propietarios.
//   · crear {usuario, correo, password, propietario?} · borrar {usuario} · propietario {usuario} (no se puede deshacer desde el panel)
// Solo un propietario (staff.es_dueno = true) puede usarla.
// Despliegue: Supabase > Edge Functions > Deploy a new function > Via Editor,
// nombre exacto "gestionar-staff", pega este archivo y despliega.
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya los pone Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Cada administrador entra con SU correo real (nunca uno inventado: el dueño de ese buzón
// podría pedir un enlace para cambiar la contraseña y entrar en el panel).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ¿Quién llama? Debe ser un propietario
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user?.email) return responder({ error: "Sesión no válida." }, 401);
    const { data: yo } = await admin.from("staff").select("usuario,es_dueno").eq("email", user.email.toLowerCase()).maybeSingle();
    if (!yo?.es_dueno) return responder({ error: "Solo los propietarios pueden gestionar administradores." }, 403);

    const { accion, usuario, password, correo, propietario } = await req.json();
    if (!/^[a-z0-9_.-]{3,30}$/.test(usuario || "")) return responder({ error: "Usuario no válido." }, 400);

    if (accion === "crear") {
      const email = String(correo || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder({ error: "Escribe el correo real de la persona." }, 400);
      if (typeof password !== "string" || password.length < 12)
        return responder({ error: "La contraseña debe tener al menos 12 caracteres." }, 400);
      const { data: nuevo, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return responder({ error: error.message }, 400);
      const { error: e2 } = await admin.from("staff").insert({ usuario, email, creado_por: yo.usuario, es_dueno: propietario === true });
      if (e2) { await admin.auth.admin.deleteUser(nuevo.user.id); return responder({ error: e2.message }, 400); }
      return responder({ ok: true });
    }

    if (accion === "propietario") {
      const { data: obj } = await admin.from("staff").select("usuario,es_dueno").eq("usuario", usuario).maybeSingle();
      if (!obj) return responder({ error: "Ese administrador no existe." }, 404);
      if (obj.es_dueno) return responder({ ok: true });
      const { error } = await admin.from("staff").update({ es_dueno: true }).eq("usuario", usuario);
      if (error) return responder({ error: error.message }, 400);
      console.log(`Propietario: ${yo.usuario} nombró propietario a ${usuario}`);
      return responder({ ok: true });
    }

    if (accion === "borrar") {
      const { data: obj } = await admin.from("staff").select("usuario,email,es_dueno").eq("usuario", usuario).maybeSingle();
      if (!obj) return responder({ error: "Ese administrador no existe." }, 404);
      if (obj.es_dueno || usuario === yo.usuario) return responder({ error: "No se puede quitar a un propietario." }, 400);
      await admin.from("staff").delete().eq("usuario", usuario);
      const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const u = lista?.users.find((x) => x.email?.toLowerCase() === String(obj.email).toLowerCase());
      if (u) await admin.auth.admin.deleteUser(u.id);
      return responder({ ok: true });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return responder({ error: String(e?.message || e) }, 500);
  }
});
