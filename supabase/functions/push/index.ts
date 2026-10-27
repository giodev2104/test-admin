// Edge Function "push": avisos al móvil del equipo cuando un cliente crea un caso o escribe en uno.
//   · clave               (panel)                     → clave pública VAPID para suscribirse
//   · alta / baja         (panel, sesión del staff)   → registra o quita este móvil
//   · estado              (panel, sesión del staff)   → si este móvil está registrado
//   · probar              (panel, sesión del staff)   → aviso de prueba a mis móviles
//   · caso / mensaje      (base de datos, x-secreto)  → lo lanzan los disparadores de «reportes» y «mensajes_caso»
//   · evento              (base de datos, x-secreto)  → todo lo demás que hace un cliente (supabase_push_todo.sql)
// Despliegue: nombre "push" y DESACTIVA «Verify JWT» (la función comprueba ella misma quién llama).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { avisarStaff, clavesVapid, enviarPush } from "../_shared/push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) || "";
const URL_PANEL = env("URL_PANEL") || "https://velority.info/";
const SEGUNDOS_ENTRE_MENSAJES = 120;   // varios mensajes seguidos del mismo caso = un solo aviso
const corta = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const cuerpo = await req.json().catch(() => ({}));
    const { accion } = cuerpo;

    if (accion === "clave") return responder({ clave: (await clavesVapid(admin)).publica });

    // ---------- Avisos que lanza la base de datos ----------
    if (accion === "caso" || accion === "mensaje" || accion === "evento") {
      const { data: aj } = await admin.from("ajustes").select("valor").eq("clave", "secreto_cron").maybeSingle();
      if (!aj?.valor || req.headers.get("x-secreto") !== aj.valor) return responder({ error: "No autorizado." }, 401);
      // Resto de cosas que hace un cliente (pedidos, pagos, catálogo, bóveda, correos, web caída…): el texto ya viene hecho
      if (accion === "evento") {
        const { data: equipo } = await admin.from("staff").select("usuario,es_dueno");
        const destinos = (equipo || []).filter((s: { es_dueno: boolean }) => cuerpo.todos || s.es_dueno).map((s: { usuario: string }) => s.usuario);
        const enlace = /^(caso=\d+|cliente=[0-9a-f-]{36}|correo)$/.test(String(cuerpo.enlace || "")) ? "#" + cuerpo.enlace : "";
        const enviados = await avisarStaff(admin, destinos, {
          titulo: corta(cuerpo.titulo, 120) || "Velority", texto: corta(cuerpo.texto, 200), url: URL_PANEL + enlace,
          etiqueta: cuerpo.etiqueta ? corta(cuerpo.etiqueta, 80) : undefined,
        });
        return responder({ ok: true, enviados });
      }
      const { data: r } = await admin.from("reportes")
        .select("id,titulo,descripcion,usuario_discord,responsable_usuario,origen,eliminado_en,aviso_push_en")
        .eq("id", Number(cuerpo.id)).maybeSingle();
      if (!r || r.eliminado_en) return responder({ ok: true, omitido: "Caso no encontrado." });
      if (accion === "mensaje" && r.aviso_push_en && Date.now() - new Date(r.aviso_push_en).getTime() < SEGUNDOS_ENTRE_MENSAJES * 1000) {
        return responder({ ok: true, omitido: "Ya se avisó hace un momento." });
      }
      const quien = r.usuario_discord || "Un cliente";
      const urgente = r.origen === "urgente";
      // Urgencias → todo el equipo; si no, el responsable del caso o, sin responsable, los propietarios
      const { data: equipo } = await admin.from("staff").select("usuario,es_dueno");
      const destinos = (equipo || []).filter((s: { usuario: string; es_dueno: boolean }) =>
        urgente || (r.responsable_usuario ? s.usuario === r.responsable_usuario : s.es_dueno)).map((s: { usuario: string }) => s.usuario);
      const texto = accion === "caso" ? corta(r.descripcion || r.titulo, 140) : corta(cuerpo.texto, 140) || "Ha escrito un mensaje nuevo.";
      const enviados = await avisarStaff(admin, destinos, {
        titulo: (urgente ? "🚨 URGENTE · " : "") + (accion === "caso" ? `Nuevo caso #${r.id} · ${corta(quien, 40)}` : `${corta(quien, 40)} ha respondido (#${r.id})`),
        texto: (accion === "caso" ? corta(r.titulo, 60) + (texto && texto !== corta(r.titulo, 60) ? " — " + texto : "") : texto),
        url: URL_PANEL + "#caso=" + r.id,
        etiqueta: "caso-" + r.id,
      });
      await admin.from("reportes").update({ aviso_push_en: new Date().toISOString() }).eq("id", r.id);
      return responder({ ok: true, enviados });
    }

    // ---------- Acciones del panel (solo el equipo) ----------
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    const { data: yo } = user?.email
      ? await admin.from("staff").select("usuario").eq("email", user.email.toLowerCase()).maybeSingle()
      : { data: null };
    if (!yo) return responder({ error: "Sesión no válida." }, 401);
    const endpoint = String(cuerpo.endpoint || "");

    if (accion === "alta") {
      const { p256dh, auth } = cuerpo;
      if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 100) {
        return responder({ error: "Datos del móvil no válidos." }, 400);
      }
      const { error } = await admin.from("push_suscripciones").upsert({
        usuario: yo.usuario, endpoint, p256dh, auth, dispositivo: corta(cuerpo.dispositivo, 120) || null,
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return responder({ ok: true });
    }
    if (accion === "baja") {
      await admin.from("push_suscripciones").delete().eq("endpoint", endpoint).eq("usuario", yo.usuario);
      return responder({ ok: true });
    }
    if (accion === "estado") {
      const { data } = await admin.from("push_suscripciones").select("id").eq("endpoint", endpoint).eq("usuario", yo.usuario).maybeSingle();
      return responder({ activo: !!data });
    }
    if (accion === "probar") {
      const q = admin.from("push_suscripciones").select("id,endpoint,p256dh,auth").eq("usuario", yo.usuario);
      const { data } = endpoint ? await q.eq("endpoint", endpoint) : await q;
      const enviados = await enviarPush(admin, data || [], {
        titulo: "🔔 Avisos activados", texto: "Te avisaremos de todo lo que hagan los clientes: casos, mensajes, pedidos, pagos, catálogo…", url: URL_PANEL, etiqueta: "prueba",
      });
      if (!enviados) return responder({ error: "No se ha podido enviar el aviso a este móvil. Vuelve a activarlos." }, 400);
      return responder({ ok: true, enviados });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    console.error(String((e as Error)?.message || e));
    return responder({ error: "Ahora mismo no se pueden gestionar los avisos. Inténtalo más tarde." }, 500);
  }
});
