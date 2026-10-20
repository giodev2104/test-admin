// Edge Function "adjuntos": permite al CLIENTE del portal subir y ver archivos de SUS casos.
// (El equipo usa Storage directamente con su sesión; los clientes no tienen sesión de Supabase.)
//   · subir {token, caso_id, nombre, tipo, tamano} → URL firmada para subir el archivo (5 min)
//   · ver   {token, ruta}                          → URL firmada para verlo/descargarlo (10 min)
//   · entrega {token, id}                          → URL firmada para descargar un archivo de la entrega de un pedido
//                                                    (bucket «entregas»; solo si el pedido está marcado como pagado)
// Los archivos se guardan en el bucket privado «adjuntos», en la carpeta del nº de caso.
// Despliegue: Edge Functions > Deploy a new function > Via Editor, nombre "adjuntos",
// y DESACTIVA «Verify JWT» (la función comprueba ella misma el token del cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "application/zip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const sanear = (n: string) =>
  n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "archivo";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { accion, token, caso_id, nombre, tipo, tamano, ruta, id } = await req.json().catch(() => ({}));
    const esSuyo = async (caso: number) => {
      const { data } = await admin.rpc("servidor_caso_del_cliente", { p_token: String(token || ""), p_caso: caso });
      return data === true;
    };

    if (accion === "subir") {
      const caso = Number(caso_id);
      if (!(await esSuyo(caso))) return responder({ error: "Tu sesión ha caducado o el caso no es tuyo." }, 401);
      if (!TIPOS.has(String(tipo))) return responder({ error: "Tipo de archivo no permitido. Usa imágenes, PDF, Word, Excel, TXT o ZIP." }, 400);
      if (!(Number(tamano) > 0 && Number(tamano) <= MAX_BYTES)) return responder({ error: "El archivo no puede pasar de 10 MB." }, 400);
      const destino = `${caso}/${crypto.randomUUID()}-${sanear(String(nombre || "archivo"))}`;
      const { data, error } = await admin.storage.from("adjuntos").createSignedUploadUrl(destino);
      if (error) throw error;
      return responder({ ruta: destino, token: data.token });
    }

    if (accion === "ver") {
      const r = String(ruta || "");
      const caso = Number(r.split("/")[0]);
      if (!caso || !(await esSuyo(caso))) return responder({ error: "Tu sesión ha caducado o el archivo no es tuyo." }, 401);
      const { data: m } = await admin.from("mensajes_caso").select("id").eq("caso_id", caso).eq("adjunto_ruta", r).limit(1);
      if (!m || !m.length) return responder({ error: "No se encontró el archivo." }, 404);
      const { data, error } = await admin.storage.from("adjuntos").createSignedUrl(r, 600);
      if (error) throw error;
      return responder({ url: data.signedUrl });
    }

    if (accion === "entrega") {
      const { data: cid } = await admin.rpc("servidor_cliente_de_token", { p_token: String(token || "") });
      if (!cid) return responder({ error: "Tu sesión ha caducado. Vuelve a entrar." }, 401);
      const { data: e } = await admin.from("entregas").select("id,cliente_id,servicio_id,nombre,ruta,descargas").eq("id", Number(id)).eq("cliente_id", cid).maybeSingle();
      if (!e) return responder({ error: "No se encontró el archivo." }, 404);
      if (e.servicio_id) {
        const { data: s } = await admin.from("servicios_cliente").select("pagado_en").eq("id", e.servicio_id).maybeSingle();
        if (!s?.pagado_en) return responder({ error: "La entrega se desbloquea cuando completes el pago." }, 402);
      }
      const { data, error } = await admin.storage.from("entregas").createSignedUrl(e.ruta, 600, { download: e.nombre });
      if (error) throw error;
      await admin.from("entregas").update({ descargado_en: new Date().toISOString(), descargas: (e.descargas || 0) + 1 }).eq("id", e.id);
      return responder({ url: data.signedUrl });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
