// Edge Function "productos": catálogo de productos que gestiona el CLIENTE desde su portal y que enseña su web.
// Portal (POST, con el token de la sesión del titular o de una persona invitada con permiso «catalogo»):
//   · listar  {token}                     → {limite, clave, base, productos}
//   · subir   {token, tipo, tamano}       → URL firmada para subir una foto (5 min) a la carpeta del catálogo
//   · guardar {token, producto}           → crea o modifica un producto (borra las fotos que se hayan quitado).
//                                           Descuento: precio_oferta (menor que el precio) y oferta_hasta (opcional, incluido)
//   · borrar  {token, id}                 → borra el producto y sus fotos
//   · ordenar {token, ids}                → guarda el orden
// Web del cliente (GET ?c=CLAVE, sin sesión): productos visibles de un catálogo activo. Lo usa https://velority.es/catalogo.js
// Con una oferta vigente, «precio» es el rebajado y «precio_antes» el original.
// El catálogo solo funciona si el equipo lo ha activado en el panel (tabla «catalogos»).
// Despliegue: nombre "productos" y DESACTIVA «Verify JWT» (la función comprueba ella misma el token del cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const responder = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });

const BUCKET = "productos", MAX_BYTES = 3 * 1024 * 1024, MAX_FOTOS = 5;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png" };
const COLUMNAS = "id,nombre,descripcion,precio,precio_oferta,oferta_hasta,categoria,fotos,visible,destacado,orden";
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });   // AAAA-MM-DD en España
const texto = (v: unknown, max: number) => { const t = String(v ?? "").trim().slice(0, max); return t || null; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const base = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/" + BUCKET + "/";

    // ---------- Web del cliente: lectura pública ----------
    if (req.method === "GET") {
      const clave = new URL(req.url).searchParams.get("c") || "";
      if (!/^[0-9a-f]{16}$/.test(clave)) return responder({ error: "Catálogo no válido." }, 400);
      const { data: k } = await admin.from("catalogos").select("cliente_id").eq("clave", clave).eq("activo", true).maybeSingle();
      if (!k) return responder({ error: "Catálogo no disponible." }, 404, { "Cache-Control": "public, max-age=60" });
      const { data: l, error } = await admin.from("productos").select("id,nombre,descripcion,precio,precio_oferta,oferta_hasta,categoria,fotos,destacado")
        .eq("cliente_id", k.cliente_id).eq("visible", true).order("orden").order("id", { ascending: false });
      if (error) throw error;
      const h = hoy();
      const productos = (l || []).map(({ precio_oferta, oferta_hasta, ...p }) => {
        const oferta = precio_oferta !== null && p.precio !== null && (!oferta_hasta || oferta_hasta >= h);
        return { ...p, precio: p.precio === null ? null : Number(oferta ? precio_oferta : p.precio), precio_antes: oferta ? Number(p.precio) : null,
          oferta_hasta: oferta ? oferta_hasta : null, fotos: (p.fotos || []).map((f: string) => base + f) };
      });
      return responder({ productos }, 200, { "Cache-Control": "public, max-age=60" });
    }

    // ---------- Portal: titular o persona invitada con permiso ----------
    const { accion, token, tipo, tamano, producto, id, ids } = await req.json().catch(() => ({}));
    const { data: ses } = await admin.rpc("servidor_catalogo_de_token", { p_token: String(token || "") });
    const cid = ses?.cliente_id;
    if (!cid) return responder({ error: "Tu sesión ha caducado o tu usuario no puede gestionar el catálogo." }, 401);
    const { data: k } = await admin.from("catalogos").select("limite,clave").eq("cliente_id", cid).eq("activo", true).maybeSingle();
    if (!k) return responder({ error: "El catálogo no está activado en tu cuenta. Escríbenos por el chat si quieres usarlo." }, 403);
    // La vista «Ver como cliente» del equipo es de solo lectura
    if (accion !== "listar" && ses.solo_lectura) return responder({ error: "Vista del equipo: solo lectura." }, 403);
    const delCliente = () => admin.from("productos").select(COLUMNAS).eq("cliente_id", cid);
    const quitarFotos = async (rutas: string[]) => {
      const r = rutas.filter((f) => f.startsWith(k.clave + "/"));
      if (r.length) await admin.storage.from(BUCKET).remove(r);
    };

    if (accion === "listar") {
      const { data: l, error } = await delCliente().order("orden").order("id", { ascending: false });
      if (error) throw error;
      return responder({ limite: k.limite, clave: k.clave, base: base, productos: l || [] });
    }

    if (accion === "subir") {
      const ext = EXT[String(tipo)];
      if (!ext) return responder({ error: "Usa fotos JPG, PNG o WebP." }, 400);
      if (!(Number(tamano) > 0 && Number(tamano) <= MAX_BYTES)) return responder({ error: "La foto no puede pasar de 3 MB." }, 400);
      const ruta = `${k.clave}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(ruta);
      if (error) throw error;
      return responder({ ruta, token: data.token });
    }

    if (accion === "guardar") {
      const p = producto || {};
      const nombre = texto(p.nombre, 120);
      if (!nombre) return responder({ error: "Ponle un nombre al producto." }, 400);
      const precio = p.precio === null || p.precio === undefined || p.precio === "" ? null : Number(String(p.precio).replace(",", "."));
      if (precio !== null && !(precio >= 0 && precio < 1e8)) return responder({ error: "El precio no es válido." }, 400);
      let oferta = precio === null || p.precio_oferta === null || p.precio_oferta === undefined || p.precio_oferta === "" ? null
        : Number(String(p.precio_oferta).replace(",", "."));
      if (oferta !== null && !(oferta >= 0 && oferta < (precio as number))) return responder({ error: "El precio con descuento tiene que ser menor que el precio normal." }, 400);
      let hasta = oferta !== null && /^\d{4}-\d{2}-\d{2}$/.test(String(p.oferta_hasta || "")) ? String(p.oferta_hasta) : null;
      if (hasta && hasta < hoy()) { oferta = null; hasta = null; }   // oferta ya terminada: se quita
      const patron = new RegExp(`^${k.clave}/[0-9a-f-]{36}\\.(jpg|webp|png)$`);
      const fotos = (Array.isArray(p.fotos) ? p.fotos : []).map(String).filter((f: string) => patron.test(f)).slice(0, MAX_FOTOS);
      const fila = {
        nombre, descripcion: texto(p.descripcion, 2000), precio: precio === null ? null : Math.round(precio * 100) / 100,
        precio_oferta: oferta === null ? null : Math.round(oferta * 100) / 100, oferta_hasta: hasta,
        categoria: texto(p.categoria, 60), fotos, visible: p.visible !== false, destacado: p.destacado === true,
        actualizado_en: new Date().toISOString(),
      };
      if (p.id) {
        const { data: antes } = await admin.from("productos").select("fotos").eq("id", Number(p.id)).eq("cliente_id", cid).maybeSingle();
        if (!antes) return responder({ error: "No se encontró el producto." }, 404);
        const { data, error } = await admin.from("productos").update(fila).eq("id", Number(p.id)).eq("cliente_id", cid).select(COLUMNAS).single();
        if (error) throw error;
        await quitarFotos((antes.fotos || []).filter((f: string) => !fotos.includes(f)));
        return responder({ producto: data });
      }
      const { count } = await admin.from("productos").select("id", { count: "exact", head: true }).eq("cliente_id", cid);
      if ((count || 0) >= k.limite) return responder({ error: `Has llegado al máximo de ${k.limite} productos de tu plan. Escríbenos si necesitas más.` }, 400);
      const { data: pri } = await admin.from("productos").select("orden").eq("cliente_id", cid).order("orden").limit(1);
      const { data, error } = await admin.from("productos").insert({ ...fila, cliente_id: cid, orden: (pri?.[0]?.orden ?? 1) - 1 }).select(COLUMNAS).single();
      if (error) throw error;
      return responder({ producto: data });
    }

    if (accion === "borrar") {
      const { data: p } = await admin.from("productos").delete().eq("id", Number(id)).eq("cliente_id", cid).select("fotos").maybeSingle();
      if (!p) return responder({ error: "No se encontró el producto." }, 404);
      await quitarFotos(p.fotos || []);
      return responder({ ok: true });
    }

    if (accion === "ordenar") {
      const lista = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0).slice(0, 1000);
      for (let i = 0; i < lista.length; i++) await admin.from("productos").update({ orden: i }).eq("id", lista[i]).eq("cliente_id", cid);
      return responder({ ok: true });
    }

    return responder({ error: "Acción desconocida." }, 400);
  } catch (e) {
    return responder({ error: String((e as Error)?.message || e) }, 500);
  }
});
