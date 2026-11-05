---
name: site-audit
description: "Auditoría de una web (SEO, accesibilidad, GEO / preparación para buscadores con IA y usabilidad) con informe PDF para el cliente: nota, puntuaciones y lista priorizada de mejoras. Úsala cuando se pida auditar, revisar, puntuar o valorar una web; comprobar su SEO, accesibilidad, datos estructurados, llms.txt o rastreadores de IA; hacer auditorías en lote de varias URLs; o preparar un informe de auditoría para un cliente o un posible cliente. Frases típicas: «audita esta web», «revisa su SEO», «qué le falta a esta web», «ponle nota a la web», «informe de auditoría», «audit this site»."
---

# Auditoría web (SEO · Accesibilidad · GEO · Usabilidad)

Basada en *claude-site-audit* de Rob Spence (licencia MIT), adaptada a Velority y a clientes en España: informe en español y marco legal español/europeo.

## Modos

- **Una web:** una URL → un PDF.
- **En lote:** lista de URLs (CSV, hoja de cálculo o texto) → un PDF por web y una hoja resumen (.xlsx).

## Pasos

### 1. Datos de entrada
Para cada web: **URL**, **nombre** del negocio u organización y **tipo**:
`publico` (ayuntamiento, organismo), `comercio` (tienda online o física), `restaurante`, `turismo`, `salud`, `profesional` (despacho, consultoría, servicios) o `general`.
Si el usuario no da el tipo, dedúcelo de la web y dilo.

### 2. Descarga y análisis
Descarga el HTML **real** de la portada (curl o la herramienta de lectura web), además de `/robots.txt`, `/sitemap.xml` y `/llms.txt`.
Si la web se pinta con JavaScript y el HTML llega casi vacío, ábrela también con Playwright (Chromium ya está instalado) y anótalo en las notas.
Evalúa el **código**, no lo que parece a simple vista.

### 3. Las 17 comprobaciones
Criterios exactos en `references/checks.md` (junto a este archivo). Cada una es `PASS`, `PARTIAL` o `FAIL`, con una nota breve y concreta (qué has visto: cuántas imágenes sin alt, el title exacto, etc.).

### 4. Puntuación y nota
Método en `references/scoring.md`. El script del paso 5 calcula las puntuaciones y la nota si no las pones en el JSON; si las pones, se usan las tuyas.

### 5. Informe PDF
Crea un JSON con los resultados (formato abajo) y ejecuta el script de la carpeta `scripts/` que está junto a este archivo (en el repositorio del panel: `.claude/skills/site-audit/`):

```bash
python3 <carpeta de esta skill>/scripts/generate_report.py \
  --name "Nombre del negocio" --url "https://ejemplo.es" --type comercio \
  --checks-json /ruta/resultado.json --output /ruta/Auditoria_Nombre.pdf
```

Opcional: `--marca "Velority · velority.es"` (pie del informe; es el valor por defecto) y `--fecha "5 de noviembre de 2026"`.

```json
{
  "checks": [
    {"id": "U1", "status": "PASS", "notes": "Certificado válido y redirección de http a https."},
    {"id": "S2", "status": "FAIL", "notes": "La portada no tiene meta description."}
  ],
  "key_issues": "Frases cortas con los 3-5 problemas más importantes.",
  "opportunities": "Frases cortas con las mejoras de más impacto.",
  "context_note": "Opcional: contexto del cliente (campaña, temporada, normativa que le afecta)."
}
```

Usa los `id` de `references/checks.md` (A1…A5, U1…U4, S1…S5, G1…G3); el script pone el nombre de cada comprobación y la recomendación de mejora.

### 6. Resumen en lote
Con varias webs, crea además un .xlsx (openpyxl) con: Organización, Tipo, URL, Nota, Accesibilidad, Usabilidad, SEO, GEO, Problemas clave, Mejor oportunidad.

### 7. Entrega
Guarda los PDF y el .xlsx en el directorio de trabajo (o en `/home/user/documentos/` si existe) y envíalos al usuario.

## Reglas
- No inventes datos: si algo no se puede comprobar (por ejemplo, la web bloquea el acceso), márcalo `PARTIAL` o `FAIL` y explícalo en la nota.
- Los avisos legales del informe son orientativos; no son asesoramiento jurídico.
- Una auditoría a un posible cliente es material comercial: no la publiques en los repositorios (son públicos).
