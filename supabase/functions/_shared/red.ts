// Comprobaciones de red compartidas por las funciones que visitan webs de clientes (medir, enlaces).
// El dominio lo escribe el propio cliente en su perfil: antes de visitarlo se comprueba que es un
// dominio público normal, para que nadie pueda usar el servidor para sondear direcciones internas.

const DOMINIO = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HOST_INTERNO = /(^|\.)(localhost|local|internal|intranet|lan|home|arpa|test|invalid|example)$/;

/** Devuelve el dominio limpio (sin https://, ruta ni barra final) o null si no es un dominio público válido. */
export function dominioLimpio(entrada: unknown): string | null {
  const d = String(entrada ?? "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!DOMINIO.test(d) || HOST_INTERNO.test(d)) return null;
  return d;
}

/** true si la URL es http(s) hacia un nombre de dominio público (no IP, no localhost, sin puerto raro). */
export function urlPublica(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  return dominioLimpio(u.hostname) !== null;
}

/** Escapa texto para meterlo en el HTML de un correo. */
export const escHTML = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** Compara dos textos secretos sin revelar por el tiempo de respuesta cuántos caracteres coinciden. */
export function igualSeguro(a: unknown, b: unknown): boolean {
  const x = new TextEncoder().encode(String(a ?? "")), y = new TextEncoder().encode(String(b ?? ""));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0 && x.length > 0;
}
