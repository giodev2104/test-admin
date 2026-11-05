#!/usr/bin/env python3
"""Genera el informe PDF de la auditoría web (skill site-audit).

Uso:
  python3 generate_report.py --name "Negocio" --url https://ejemplo.es --type comercio \
      --checks-json resultado.json --output Auditoria.pdf [--marca "..."] [--fecha "..."]
"""
import argparse, json, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                KeepTogether)
from reportlab.graphics.shapes import Drawing, Rect, String

CHECKS = {
 "A1": ("Accesibilidad", "Idioma de la página", "Declarar el idioma en la etiqueta <html lang=\"es\"> para que los lectores de pantalla pronuncien bien el texto."),
 "A2": ("Accesibilidad", "Texto alternativo en imágenes", "Añadir un texto alternativo descriptivo a cada imagen informativa y alt vacío a las decorativas."),
 "A3": ("Accesibilidad", "Estructura de encabezados", "Usar un solo título principal (H1) y ordenar los subtítulos (H2, H3) sin saltos."),
 "A4": ("Accesibilidad", "Formularios, botones y enlaces con nombre", "Poner etiqueta visible a cada campo y un nombre accesible a botones e iconos."),
 "A5": ("Accesibilidad", "Declaración y ayudas de accesibilidad", "Publicar una página de accesibilidad y marcar las zonas de la página (cabecera, menú, contenido, pie)."),
 "U1": ("Usabilidad", "Conexión segura (HTTPS)", "Activar el certificado SSL y redirigir siempre http a https."),
 "U2": ("Usabilidad", "Adaptada a móvil", "Revisar la versión móvil: sin desbordes, textos legibles y botones fáciles de pulsar."),
 "U3": ("Usabilidad", "Contacto visible", "Mostrar teléfono pulsable, email o formulario y, si hay local, dirección y horario."),
 "U4": ("Usabilidad", "Navegación y servicios online", "Simplificar el menú, corregir enlaces rotos y dejar la acción principal a un clic."),
 "S1": ("SEO", "Título de la página", "Escribir un título único de 30-65 caracteres con la actividad, la zona y la marca."),
 "S2": ("SEO", "Meta description", "Redactar una descripción de 70-160 caracteres que invite a hacer clic desde Google."),
 "S3": ("SEO", "Indexable y canonical", "Permitir la indexación y añadir la URL canónica de cada página."),
 "S4": ("SEO", "robots.txt y sitemap.xml", "Publicar robots.txt y un sitemap.xml enlazado y enviarlo a Google Search Console."),
 "S5": ("SEO", "Vista previa al compartir", "Añadir las etiquetas Open Graph (título, descripción e imagen) para WhatsApp y redes."),
 "G1": ("GEO", "Datos estructurados (JSON-LD)", "Añadir datos estructurados del negocio (nombre, dirección, teléfono, horario, productos)."),
 "G2": ("GEO", "Archivo llms.txt", "Publicar /llms.txt con un resumen del negocio y enlaces a las páginas clave."),
 "G3": ("GEO", "Rastreadores de IA", "Permitir a ChatGPT, Claude, Perplexity y Google IA leer la web y servir el contenido en el HTML."),
}
AREAS = [("Accesibilidad", .30), ("Usabilidad", .20), ("SEO", .30), ("GEO", .20)]
ALTA = {"A1", "A2", "A3", "A4", "U1", "U2", "S1", "S3"}
GRADES = [(9.0, "A"), (8.5, "A-"), (8.0, "B+"), (7.5, "B"), (7.0, "B-"), (6.5, "C+"),
          (6.0, "C"), (5.5, "C-"), (4.5, "D"), (-1, "F")]
TIPOS = {
 "publico": ("Las webs del sector público deben cumplir el Real Decreto 1112/2018 de accesibilidad y publicar una declaración de accesibilidad.",
             "Una web poco accesible deja fuera a vecinos con discapacidad o mayores y expone a reclamaciones ante el órgano de supervisión."),
 "comercio": ("Desde el 28 de junio de 2025, muchas tiendas online deben cumplir requisitos de accesibilidad (Ley 11/2023, que aplica el Acta Europea de Accesibilidad).",
              "Cada problema de SEO o de móvil es una venta que se va a la competencia; y los asistentes de IA ya recomiendan tiendas a partir de lo que pueden leer."),
 "restaurante": ("Cada vez más clientes eligen dónde comer preguntando a Google, Google Maps o a un asistente de IA.",
                 "Si la carta, el horario y el teléfono no se pueden leer bien, el restaurante no aparece en esas recomendaciones."),
 "turismo": ("Los viajeros planifican con buscadores y asistentes de IA, sobre todo desde el móvil.",
             "Una web lenta o poco visible pierde reservas en temporada alta y frente a las grandes plataformas."),
 "salud": ("Los pacientes buscan especialista y piden cita desde el móvil, y valoran la confianza que transmite la web.",
           "Sin datos claros (servicios, horario, contacto) y sin buena visibilidad, la cita se la lleva otra clínica."),
 "profesional": ("Los clientes comparan varios profesionales antes de llamar, y cada vez más lo hacen preguntando a la IA.",
                 "Una web que no aparece o no inspira confianza hace perder contactos y presupuestos cada semana."),
 "general": ("Google y los buscadores con IA deciden qué negocios ven los clientes, y la accesibilidad es cada vez más una obligación legal.",
             "Las carencias técnicas restan visitas y contactos frente a competidores mejor preparados."),
}
ST = {"PASS": ("Cumple", colors.HexColor("#2e7d4f"), colors.HexColor("#e6f2ea")),
      "PARTIAL": ("A medias", colors.HexColor("#a66a00"), colors.HexColor("#fff3dc")),
      "FAIL": ("No cumple", colors.HexColor("#b3261e"), colors.HexColor("#fbe7e5"))}
OSC, MU, BD, AC = colors.HexColor("#1d1d1f"), colors.HexColor("#666666"), colors.HexColor("#e2e2e2"), colors.HexColor("#3b5bdb")
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def esc(t):
    return str(t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def nota(media):
    return next(g for lim, g in GRADES if media >= lim)


def calcular(checks):
    pts = {"PASS": 1, "PARTIAL": .5, "FAIL": 0}
    sc = {}
    for area, _ in AREAS:
        cs = [c for c in checks if CHECKS[c["id"]][0] == area]
        sc[area] = round(sum(pts[c["status"]] for c in cs) / len(cs) * 10, 1) if cs else 0.0
    media = round(sum(sc[a] * w for a, w in AREAS), 1)
    return sc, media


def barra(valor, ancho=95 * mm, alto=4.2 * mm):
    d = Drawing(ancho, alto)
    d.add(Rect(0, 0, ancho, alto, rx=2, ry=2, fillColor=colors.HexColor("#eeeeee"), strokeColor=None))
    col = ST["PASS"][1] if valor >= 7.5 else ST["PARTIAL"][1] if valor >= 5 else ST["FAIL"][1]
    if valor > 0:
        d.add(Rect(0, 0, ancho * valor / 10, alto, rx=2, ry=2, fillColor=col, strokeColor=None))
    return d


def caja_nota(g, media):
    d = Drawing(38 * mm, 30 * mm)
    col = ST["PASS"][1] if g[0] in "AB" else ST["PARTIAL"][1] if g[0] == "C" else ST["FAIL"][1]
    d.add(Rect(0, 0, 38 * mm, 30 * mm, rx=6, ry=6, fillColor=col, strokeColor=None))
    d.add(String(19 * mm, 12 * mm, g, fontName="Helvetica-Bold", fontSize=34, fillColor=colors.white, textAnchor="middle"))
    d.add(String(19 * mm, 4.5 * mm, f"{media:.1f} / 10".replace(".", ","), fontName="Helvetica", fontSize=9, fillColor=colors.white, textAnchor="middle"))
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True); ap.add_argument("--url", required=True)
    ap.add_argument("--type", default="general"); ap.add_argument("--checks-json", required=True)
    ap.add_argument("--output", required=True); ap.add_argument("--marca", default="Velority · velority.es")
    ap.add_argument("--fecha")
    a = ap.parse_args()
    data = json.load(open(a.checks_json, encoding="utf-8"))
    checks = []
    for c in data["checks"]:
        cid = c.get("id") or next((k for k, v in CHECKS.items() if v[1].lower() == str(c.get("name", "")).lower()), None)
        if cid not in CHECKS:
            raise SystemExit(f"Comprobación desconocida: {c}")
        st = str(c["status"]).upper()
        if st not in ST:
            raise SystemExit(f"Estado no válido en {cid}: {st}")
        checks.append({"id": cid, "status": st, "notes": c.get("notes", "")})
    faltan = [k for k in CHECKS if k not in {c["id"] for c in checks}]
    if faltan:
        raise SystemExit("Faltan comprobaciones: " + ", ".join(faltan))
    checks.sort(key=lambda c: list(CHECKS).index(c["id"]))
    sc, media = calcular(checks)
    if data.get("scores"):
        m = {"accesibilidad": "Accesibilidad", "accessibility": "Accesibilidad", "usabilidad": "Usabilidad",
             "usability": "Usabilidad", "seo": "SEO", "geo": "GEO"}
        for k, v in data["scores"].items():
            if k.lower() in m:
                sc[m[k.lower()]] = float(v)
        media = round(sum(sc[ar] * w for ar, w in AREAS), 1)
    g = data.get("grade") or nota(media)
    hoy = datetime.date.today()
    fecha = a.fecha or f"{hoy.day} de {MESES[hoy.month - 1]} de {hoy.year}"
    tipo = TIPOS.get(a.type.lower(), TIPOS["general"])

    b = ParagraphStyle("b", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=OSC)
    pe = ParagraphStyle("pe", parent=b, fontSize=8.3, leading=11)
    mu = ParagraphStyle("mu", parent=b, textColor=MU, fontSize=9)
    h1 = ParagraphStyle("h1", parent=b, fontName="Helvetica-Bold", fontSize=20, leading=24)
    h2 = ParagraphStyle("h2", parent=b, fontName="Helvetica-Bold", fontSize=12.5, leading=16, spaceBefore=12, spaceAfter=6, textColor=AC)

    doc = SimpleDocTemplate(a.output, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm,
                            bottomMargin=18 * mm, title=f"Auditoría web · {a.name}", author=a.marca)
    def pie(cv, d):
        cv.saveState(); cv.setFont("Helvetica", 8); cv.setFillColor(MU)
        cv.drawString(16 * mm, 10 * mm, f"Auditoría web · {a.name} · {fecha}")
        cv.drawRightString(A4[0] - 16 * mm, 10 * mm, f"{a.marca} · pág. {d.page}"); cv.restoreState()

    el = []
    cab = Table([[[Paragraph("Auditoría web", h1), Spacer(1, 3),
                   Paragraph(f"<b>{esc(a.name)}</b>", ParagraphStyle("n", parent=b, fontSize=12, leading=15)),
                   Paragraph(esc(a.url), mu), Paragraph(fecha, mu)], caja_nota(g, media)]],
                colWidths=[None, 40 * mm])
    cab.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                             ("LINEBELOW", (0, 0), (-1, 0), 1.2, AC), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    el += [cab, Spacer(1, 8),
           Paragraph("Revisión de la web en cuatro áreas: <b>accesibilidad</b> (que todo el mundo pueda usarla), "
                     "<b>usabilidad</b>, <b>SEO</b> (aparecer en Google) y <b>GEO</b> (aparecer en las respuestas de "
                     "asistentes de IA como ChatGPT, Gemini o Perplexity). Se han revisado 17 puntos en el código de la web.", b)]

    el.append(Paragraph("Puntuación por área", h2))
    filas = [[Paragraph(f"<b>{ar}</b>", b), barra(sc[ar]), Paragraph(f"<b>{sc[ar]:.1f}</b> / 10".replace(".", ","), b)] for ar, _ in AREAS]
    t = Table(filas, colWidths=[34 * mm, 100 * mm, 24 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 5)]))
    el.append(t)

    if data.get("key_issues") or data.get("opportunities"):
        el.append(Paragraph("Resumen", h2))
        if data.get("key_issues"):
            el.append(Paragraph(f"<b>Problemas principales.</b> {esc(data['key_issues'])}", b)); el.append(Spacer(1, 4))
        if data.get("opportunities"):
            el.append(Paragraph(f"<b>Mayores oportunidades.</b> {esc(data['opportunities'])}", b))

    el.append(Paragraph("Por qué importa", h2))
    el.append(Paragraph(esc(tipo[0]) + " " + esc(tipo[1]), b))
    if data.get("context_note"):
        el.append(Spacer(1, 4)); el.append(Paragraph(esc(data["context_note"]), b))

    el.append(Paragraph("Resultado de las 17 comprobaciones", h2))
    filas = [[Paragraph("<b>Comprobación</b>", pe), Paragraph("<b>Resultado</b>", pe), Paragraph("<b>Detalle</b>", pe)]]
    estilos = [("GRID", (0, 0), (-1, -1), .5, BD), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f4")),
               ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    area = None
    for c in checks:
        ar, nom, _ = CHECKS[c["id"]]
        if ar != area:
            area = ar
            filas.append([Paragraph(f"<b>{ar}</b>", pe), "", ""])
            i = len(filas) - 1
            estilos += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafafa"))]
        lab, col, fondo = ST[c["status"]]
        filas.append([Paragraph(f"{c['id']} · {esc(nom)}", pe),
                      Paragraph(f"<font color='{col.hexval()}'><b>{lab}</b></font>", pe), Paragraph(esc(c["notes"]), pe)])
        estilos.append(("BACKGROUND", (1, len(filas) - 1), (1, len(filas) - 1), fondo))
    t = Table(filas, colWidths=[52 * mm, 22 * mm, None], repeatRows=1)
    t.setStyle(TableStyle(estilos)); el.append(t)

    pend = [c for c in checks if c["status"] != "PASS"]
    if pend:
        def prio(c):
            if c["status"] == "FAIL" and c["id"] in ALTA: return 0
            if c["status"] == "FAIL" or CHECKS[c["id"]][0] in ("Accesibilidad", "SEO"): return 1
            return 2
        pend.sort(key=lambda c: (prio(c), list(CHECKS).index(c["id"])))
        nombres = ["Alta", "Media", "Baja"]
        filas = [[Paragraph("<b>Prioridad</b>", pe), Paragraph("<b>Qué hacer</b>", pe)]]
        for c in pend:
            p = prio(c)
            colp = [ST["FAIL"][1], ST["PARTIAL"][1], MU][p]
            filas.append([Paragraph(f"<font color='{colp.hexval()}'><b>{nombres[p]}</b></font>", pe),
                          Paragraph(f"<b>{esc(CHECKS[c['id']][1])}.</b> {esc(CHECKS[c['id']][2])}", pe)])
        t = Table(filas, colWidths=[22 * mm, None], repeatRows=1)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), .5, BD), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f4")),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        el.append(KeepTogether([Paragraph("Plan de mejora", h2), t]) if len(filas) < 8 else Paragraph("Plan de mejora", h2))
        if len(filas) >= 8:
            el.append(t)
    else:
        el.append(Paragraph("Plan de mejora", h2)); el.append(Paragraph("La web cumple las 17 comprobaciones. Recomendamos repetir la revisión cada 6 meses.", b))

    el += [Spacer(1, 10), Paragraph("Revisión automática del código de la portada y de los archivos robots.txt, sitemap.xml y llms.txt. "
                                    "Las referencias legales son orientativas y no constituyen asesoramiento jurídico.", mu)]
    doc.build(el, onFirstPage=pie, onLaterPages=pie)
    print(json.dumps({"output": a.output, "grade": g, "media": media, "scores": sc}, ensure_ascii=False))


if __name__ == "__main__":
    main()
