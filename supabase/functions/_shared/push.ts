// Avisos push (Web Push) a los móviles del equipo, sin servicios externos: cifrado aes128gcm (RFC 8291)
// y firma VAPID (RFC 8292) hechos con WebCrypto. Las claves VAPID se crean solas la primera vez y se guardan
// en la tabla privada «ajustes» (vapid_publica / vapid_privada), que solo lee el servidor.

const te = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const unir = (...partes: Uint8Array[]) => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, k, bytes * 8));
}

// Claves VAPID del proyecto (se crean la primera vez)
// deno-lint-ignore no-explicit-any
export async function clavesVapid(admin: any) {
  const { data } = await admin.from("ajustes").select("clave,valor").in("clave", ["vapid_publica", "vapid_privada"]);
  const pub = data?.find((x: { clave: string }) => x.clave === "vapid_publica")?.valor;
  const priv = data?.find((x: { clave: string }) => x.clave === "vapid_privada")?.valor;
  if (pub && priv) return { publica: pub as string, privada: JSON.parse(priv) as JsonWebKey };
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publica = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey)));
  const privada = await crypto.subtle.exportKey("jwk", par.privateKey);
  // ignoreDuplicates: si dos peticiones las crean a la vez, se queda la primera y se vuelve a leer
  await admin.from("ajustes").upsert([{ clave: "vapid_publica", valor: publica }, { clave: "vapid_privada", valor: JSON.stringify(privada) }], { onConflict: "clave", ignoreDuplicates: true });
  const { data: otra } = await admin.from("ajustes").select("clave,valor").in("clave", ["vapid_publica", "vapid_privada"]);
  return {
    publica: otra.find((x: { clave: string }) => x.clave === "vapid_publica").valor as string,
    privada: JSON.parse(otra.find((x: { clave: string }) => x.clave === "vapid_privada").valor) as JsonWebKey,
  };
}

// Cifra el mensaje para una suscripción (formato aes128gcm, un solo bloque)
export async function cifrar(p256dh: string, auth: string, mensaje: Uint8Array) {
  const uaPublica = deB64u(p256dh), secreto = deB64u(auth);
  const efimera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublica = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const destino = await crypto.subtle.importKey("raw", uaPublica, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: destino }, efimera.privateKey, 256));
  const ikm = await hkdf(secreto, compartido, unir(te.encode("WebPush: info\0"), uaPublica, asPublica), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, k, unir(mensaje, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // tamaño de bloque 4096
  return unir(salt, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

export async function jwtVapid(endpoint: string, privada: JsonWebKey) {
  const k = await crypto.subtle.importKey("jwk", privada, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cab = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const datos = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:contact-velority@velority.es" })));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, te.encode(cab + "." + datos)));
  return cab + "." + datos + "." + b64u(firma);
}

export type Aviso = { titulo: string; texto: string; url?: string; etiqueta?: string };
type Suscripcion = { id: number; endpoint: string; p256dh: string; auth: string };

// Envía el aviso a varias suscripciones; borra las que el navegador ya no acepta (404/410). Devuelve cuántas llegaron.
// deno-lint-ignore no-explicit-any
export async function enviarPush(admin: any, subs: Suscripcion[], aviso: Aviso) {
  if (!subs.length) return 0;
  const { publica, privada } = await clavesVapid(admin);
  const cuerpo = te.encode(JSON.stringify(aviso));
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${await jwtVapid(s.endpoint, privada)}, k=${publica}`,
          "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high",
        },
        body: await cifrar(s.p256dh, s.auth, cuerpo),
      });
      if (r.ok) { ok++; await admin.from("push_suscripciones").update({ ultimo_envio_en: new Date().toISOString() }).eq("id", s.id); }
      else if (r.status === 404 || r.status === 410) await admin.from("push_suscripciones").delete().eq("id", s.id);
      else console.error("Push rechazado", r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.error("Push fallido", String(e)); }
  }));
  return ok;
}

// Avisa a unos usuarios del equipo (todos sus móviles)
// deno-lint-ignore no-explicit-any
export async function avisarStaff(admin: any, usuarios: string[], aviso: Aviso) {
  if (!usuarios.length) return 0;
  const { data } = await admin.from("push_suscripciones").select("id,endpoint,p256dh,auth").in("usuario", usuarios);
  return enviarPush(admin, data || [], aviso);
}
