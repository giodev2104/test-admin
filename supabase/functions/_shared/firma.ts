// Firma y aviso legal (RGPD y LSSI-CE) de los correos de Velority. La usan «buzon», «correo» e «informe».
// Cada persona del equipo firma con lo suyo (clave = usuario del panel). Los correos automáticos (sin persona)
// llevan la firma de la empresa y el correo del responsable para ejercer los derechos.
// Para añadir a alguien nuevo del equipo: una línea más en FIRMAS y volver a desplegar esas tres funciones.
export type Firma = { nombre: string; cargo: string; email: string };
export const FIRMAS: Record<string, Firma> = {
  gio: { nombre: "Hugo Vázquez", cargo: "CEO Velority", email: "vaznichugo@gmail.com" },
  nixi: { nombre: "Alicia Santos", cargo: "Co-fundadora / Comercial Velority", email: "aliciasangal@gmail.com" },
};
const EMAIL_DERECHOS = FIRMAS.gio.email;
const LEMA = "Tu web profesional, a precio cerrado.", WEB = "https://velority.es";

const escF = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const firmaDe = (usuario?: string | null) => (usuario && FIRMAS[usuario]) || null;

function avisoLegal(email: string) {
  return [
    "De conformidad con el Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016, relativo a la protección de las personas físicas en lo que respecta al tratamiento de datos personales y a la libre circulación de estos datos (RGPD), le informamos que sus datos son objeto de tratamiento por parte de Velority. Estos datos son gestionados con la finalidad de informar y comunicar todo aquello relativo a la prestación de nuestros servicios profesionales y actividades relacionadas con la web https://velority.es.",
    `Recibes este correo porque nos has facilitado y/o cedido voluntariamente tu dirección electrónica. No obstante, puedes ejercer tus derechos de acceso, rectificación, limitación, supresión, portabilidad y oposición al tratamiento de tus datos enviando un email a ${email}.`,
    "Todos tus datos serán tratados con la máxima confidencialidad y conforme al RGPD y a la Ley 34/2002, de 11 de julio, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE).",
  ];
}

// Bloque HTML para el final del correo: firma (de la persona o de la empresa) + aviso legal en letra pequeña.
// centrado = para plantillas centradas (la propuesta con diseño)
export function firmaHTML(usuario?: string | null, centrado = false) {
  const f = firmaDe(usuario), email = f ? f.email : EMAIL_DERECHOS;
  const enlace = (u: string, t = u) => `<a href="${u}" style="color:#5b6cff;text-decoration:none">${escF(t)}</a>`;
  const firma = f
    ? `<p style="margin:0 0 2px;font-size:14px;color:#1f2433"><strong>${escF(f.nombre)}</strong> // ${escF(f.cargo)}</p>
       <p style="margin:0 0 6px;font-size:13px;color:#5b6170;font-style:italic">${LEMA}</p>
       <p style="margin:0;font-size:13px;color:#1f2433">Correo: ${enlace("mailto:" + f.email, f.email)}</p>
       <p style="margin:0;font-size:13px;color:#1f2433"><strong>Velority</strong> · ${enlace(WEB)}</p>`
    : `<p style="margin:0;font-size:13px;color:#1f2433"><strong>Velority</strong> · <span style="color:#5b6170;font-style:italic">${LEMA}</span> · ${enlace(WEB)}</p>`;
  const aviso = avisoLegal(email).map((p) => `<p style="margin:0 0 6px">${escF(p).replace(escF(email), enlace("mailto:" + email, email)).replace("https://velority.es.", enlace(WEB) + ".")}</p>`).join("");
  return `<div style="max-width:600px;margin:22px ${centrado ? "auto" : "0"} 0;padding:16px 4px 0;border-top:1px solid #dfe1ea;font-family:Arial,Helvetica,sans-serif;text-align:left">${firma}
    <div style="margin-top:14px;font-size:10.5px;line-height:1.5;color:#8a8fa0"><p style="margin:0 0 6px;font-weight:bold">Aviso Legal y Protección de Datos:</p>${aviso}</div></div>`;
}

// Lo mismo en texto plano (para la versión sin formato del correo)
export function firmaTexto(usuario?: string | null) {
  const f = firmaDe(usuario), email = f ? f.email : EMAIL_DERECHOS;
  const firma = f ? [`${f.nombre} // ${f.cargo}`, LEMA, `Correo: ${f.email}`, "Velority", WEB] : ["Velority", LEMA, WEB];
  return "\n\n--\n" + firma.join("\n") + "\n\nAviso Legal y Protección de Datos:\n" + avisoLegal(email).join("\n\n");
}
