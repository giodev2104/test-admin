// Configuración de Tailwind del panel (antes estaba dentro de index.html con el CDN).
// Regenerar panel.css a mano (desde la raíz del repositorio):
//   npx tailwindcss@3.4.17 -c .github/tailwind/tailwind.config.js -i .github/tailwind/entrada.css -o panel.css --minify
// Lo hace solo el workflow .github/workflows/panel-css.yml cada vez que cambia index.html.
module.exports = {
  content: ["./index.html"],
  theme: { extend: {
    fontFamily: { display: ["Inter", "system-ui", "sans-serif"], body: ["Inter", "system-ui", "sans-serif"] },
    colors: { base: "#0a0c11", panel: "#10131a", raised: "#171b24", line: "#232837", fx: "#f6a01a", fx2: "#ffb84d", ok: "#22c55e", wa: "#f59e0b" },
  } },
};
