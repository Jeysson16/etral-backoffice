from pathlib import Path
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "ETRAL_datos_simulacion_y_gemelo_digital.docx"
ASSETS = ROOT / "docs" / "assets" / "simulacion-gemelo"


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def margins(cell, top=100, start=110, bottom=100, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for side, val in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tc_pr.append(mar)


def borders(table):
    tbl_pr = table._tbl.tblPr
    bd = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "5")
        el.set(qn("w:color"), "D9D9D9")
        bd.append(el)
    tbl_pr.append(bd)


def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for i, (header, width) in enumerate(zip(headers, widths)):
        t.columns[i].width = Inches(width)
        c = t.rows[0].cells[i]
        c.width = Inches(width)
        c.text = header
        shade(c, "E7E7E7")
        c.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        margins(c)
        for run in c.paragraphs[0].runs:
            run.font.bold = True
            run.font.name = "Arial"
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(0, 0, 0)
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for rowno, vals in enumerate(rows):
        cells = t.add_row().cells
        for i, (val, width) in enumerate(zip(vals, widths)):
            cells[i].width = Inches(width)
            cells[i].text = str(val)
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            margins(cells[i])
            if rowno % 2:
                shade(cells[i], "F1F5F8")
            for p in cells[i].paragraphs:
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.1
                for r in p.runs:
                    r.font.name = "Arial"
                    r.font.size = Pt(12)
                    r.font.color.rgb = RGBColor(0, 0, 0)
    borders(t)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return t


def p(text="", bold_lead=None):
    para = doc.add_paragraph(style="Normal")
    if bold_lead and text.startswith(bold_lead):
        para.add_run(bold_lead).bold = True
        para.add_run(text[len(bold_lead):])
    else:
        para.add_run(text)
    return para


def heading(text, level=1):
    doc.add_heading(text, level=level)


def bullet(text):
    doc.add_paragraph(text, style="List Bullet")


doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin = Inches(.8)
sec.bottom_margin = Inches(.72)
sec.left_margin = Inches(.82)
sec.right_margin = Inches(.82)
sec.header_distance = Inches(.35)
sec.footer_distance = Inches(.4)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = "Arial"
normal.font.size = Pt(12)
normal.font.color.rgb = RGBColor(0, 0, 0)
normal.paragraph_format.space_after = Pt(7)
normal.paragraph_format.line_spacing = 1.16
for name, before, after in (("Title", 0, 10), ("Heading 1", 15, 6), ("Heading 2", 10, 4)):
    style = styles[name]
    style.font.name = "Arial"
    style.font.size = Pt(14)
    style.font.bold = True
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.paragraph_format.space_before = Pt(before)
    style.paragraph_format.space_after = Pt(after)
    style.paragraph_format.keep_with_next = True
styles["List Bullet"].font.name = "Arial"
styles["List Bullet"].font.size = Pt(12)
styles["List Bullet"].font.color.rgb = RGBColor(0, 0, 0)
styles["List Bullet"].paragraph_format.space_after = Pt(4)

header = sec.header.paragraphs[0]
header.text = "ETRAL  |  Documento técnico de simulación"
header.style = "Normal"
header.runs[0].font.name = "Arial"
header.runs[0].font.size = Pt(12)
header.runs[0].font.color.rgb = RGBColor(0, 0, 0)
footer = sec.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
field = OxmlElement("w:fldSimple")
field.set(qn("w:instr"), "PAGE")
footer._p.append(field)
for r in footer.runs:
    r.font.name = "Arial"
    r.font.size = Pt(12)
    r.font.color.rgb = RGBColor(0, 0, 0)

doc.add_heading("Datos de la simulación y alcance del gemelo digital", 0)
p("ETRAL · Documento para revisión técnica", bold_lead="ETRAL")
p("Este documento precisa qué información real entra al simulador, qué modifica el usuario al crear un escenario y cómo se obtienen los resultados. La descripción corresponde a la implementación y a la pantalla de Simulación del sistema en producción.")

heading("1. Qué es el gemelo digital en ETRAL")
p("El gemelo digital es una representación calculable de la operación de planta. Integra los registros actuales —órdenes, materiales, rutas, recursos y avances— en una copia de trabajo, los combina con reglas de planificación y permite ensayar cambios antes de aplicarlos. Sus resultados son estimaciones para decidir y priorizar; se actualizan cuando cambian los registros de origen y se ejecuta de nuevo el cálculo.")
p("Flujo: registros operativos → copia del estado de planta → parámetros del escenario → cálculo MRP, capacidad y programación → indicadores y alertas. La ejecución de la simulación no modifica inventario, órdenes ni recursos reales. La acción separada «Guardar prioridades reales» sí persiste cambios de prioridad y debe distinguirse del ensayo.")

heading("2. Datos reales que entran automáticamente")
p("La interfaz arma una copia estructurada de los datos cargados en ETRAL. Estos grupos viajan en la solicitud del motor Python cuando ese motor está configurado:")
table(["Grupo", "Campos principales", "Papel en el cálculo"], [
    ("Órdenes y productos", "CECO, tipo de carrocería, fase actual, prioridad, avance, inicio y entrega prevista; ruta y plazo objetivo del producto.", "Define trabajos activos, secuencia pendiente, orden de atención y cumplimiento de fechas."),
    ("Materiales", "Código, existencia física, comprometido, reserva de seguridad, unidad, plazo de reposición y parámetros de demanda.", "Determina disponibilidad, faltantes y riesgos de inventario."),
    ("Lista de materiales y reservas", "Material y cantidad por tipo de carrocería y fase; requerido y consumido por CECO.", "Calcula necesidades pendientes y asignación de material a las órdenes."),
    ("Fases y actividades", "Orden de fases, capacidad y horas estándar; actividades y minutos estándar.", "Estima carga de trabajo, capacidad y tiempos por fase."),
    ("Personal, turnos y asignaciones", "Estado, eficiencia, horas semanales y turno del trabajador; horarios, pausas y tareas asignadas.", "Ajusta disponibilidad y rendimiento de recursos humanos."),
    ("Equipos, calendario e incidentes", "Equipo, fase, estado y horas de capacidad; horas disponibles por fecha; paradas abiertas.", "Limita la capacidad efectiva y descuenta indisponibilidad."),
    ("Histórico operativo", "Movimientos de inventario, horas reportadas por actividad/trabajador y progreso de actividades.", "Apoya proyección de consumo, calibración y validación histórica."),
], [1.28, 3.02, 2.54])
p("Nota de trazabilidad: el sistema transmite estos campos desde el conjunto de datos cargado en la interfaz. Un campo presente en la copia no necesariamente interviene en todas las fórmulas; su uso depende del cálculo específico.")

heading("3. Datos que se introducen para cada escenario")
p("El usuario ajusta supuestos sobre la copia de planta. Los valores iniciales indicados son los definidos en la interfaz; pueden cambiar antes de ejecutar.")
table(["Parámetro", "Valor inicial / opción", "Efecto implementado"], [
    ("Horizonte", "14 días; opciones 7, 14, 21 y 30.", "Acota la proyección y escala la capacidad disponible."),
    ("Personal disponible", "85 % inicial; visible solo en modo porcentual.", "Multiplica la capacidad laboral únicamente en el modo porcentual. En modo estocástico la base es 100 % y la disponibilidad se obtiene del ausentismo muestreado."),
    ("Turnos por día", "1, 2 o 3; inicial 1.", "Multiplica la capacidad estimada."),
    ("Demanda", "100 %; rango 50–180 %.", "Escala las horas requeridas por las órdenes."),
    ("Materiales", "Ajuste positivo o negativo de unidades por material.", "Cambia el inventario de la copia usado en el escenario."),
    ("Prioridades", "CECO seleccionados y orden relativo.", "Altera el orden de asignación de material y programación."),
    ("Por orden", "Complejidad 0,8–2,0 y trabajadores asignados.", "Ajusta horas requeridas según complejidad y factor del personal asignado."),
    ("Ausentismo", "5 % inicial; rango 0–25 %.", "Reduce el factor de personal disponible en el motor Python."),
    ("Modo «Monte Carlo» y σ", "Modo estocástico inicial; σ=10 %; 250 corridas.", "Muestrea rendimiento y ausentismo en cada corrida y devuelve intervalos de confianza al 95 %. La semilla permite repetir exactamente el escenario."),
], [1.32, 1.78, 3.74])

heading("4. Cómo se calculan las salidas")
bullet("Preparación: se copia el estado de planta y se aplican ajustes de material y prioridad solo en la copia. Las órdenes con avance menor al 100 % se consideran activas.")
bullet("Calibración: horas reportadas se relacionan con actividades terminadas y sus tiempos estándar. De allí sale un factor de sesgo del tiempo estándar y una medida de confiabilidad según la cobertura del histórico.")
bullet("MRP: la lista de materiales y las reservas pendientes se confrontan con existencias y stock de seguridad; el orden de prioridad influye en qué CECO recibe materiales primero.")
bullet("Carga y capacidad: las horas estándar restantes se ajustan por calibración, demanda, complejidad y trabajador. La capacidad por fase considera horizonte, turnos, disponibilidad, personal, calendario, equipos e incidentes abiertos.")
bullet("Programación finita: se asigna capacidad diaria a las órdenes según su prioridad y ruta. Se proyectan fechas de fin, bloqueos y cumplimiento de la fecha comprometida por CECO.")
p("Relaciones útiles para explicar el modelo: disponibilidad de material = existencia física − comprometido; utilización de fase = horas requeridas ÷ horas disponibles × 100; cumplimiento PMP = CECO proyectados a tiempo ÷ CECO con fecha evaluable × 100. Son relaciones de lectura, no sustituyen las reglas completas del motor.")

heading("5. Qué devuelve la simulación")
p("La pantalla resume órdenes terminables, cumplimiento PMP por CECO, tiempo de entrega estimado y posibles quiebres de stock. El detalle presenta capacidad y cuellos de botella por fase, impacto de materiales, demanda por producto, parámetros por orden, cronograma finito, calibración con registros de Supabase y supuestos. Un resultado favorable depende de que los datos de inventario, avance, capacidad y registros de operación estén actualizados.")

heading("6. Explicación breve para sustentación")
p("«La simulación toma los datos vigentes de órdenes, rutas, materiales, capacidad, personal, equipos y registros de operación. Con ellos construye una copia del estado de planta. Sobre esa copia cambiamos horizonte, turnos, demanda, materiales, prioridades y condiciones de personal para evaluar escenarios. El gemelo digital calcula necesidades de materiales, carga y capacidad por fase, fechas proyectadas y cumplimiento del plan maestro. En modo Monte Carlo repite el cálculo con variaciones de rendimiento y ausentismo y presenta intervalos al 95 %. Los resultados orientan decisiones; su calidad depende de la actualización y cobertura de los datos reales».")

doc.add_page_break()
heading("Anexo. Pantalla de configuración y resultados")
p("Capturas de la sección Simulación en el sistema ETRAL. Las dos primeras muestran las opciones de entrada y la tercera muestra una corrida terminada con el panel derecho completamente cargado.")
for filename, caption in [
    ("01_configuracion.jpg", "Figura 1. Horizonte, modo de inconsistencia, desviación y ausentismo."),
    ("02_parametros.jpg", "Figura 2. Turnos, demanda y selección de materiales y prioridades."),
    ("03_resultados.jpg", "Figura 3. Resultado de la simulación con indicadores, alertas y capacidad por fase cargados."),
]:
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para.paragraph_format.space_after = Pt(2)
    para.add_run().add_picture(str(ASSETS / filename), width=Inches(6.65))
    cap = doc.add_paragraph(caption)
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(12)
    for r in cap.runs:
        r.font.name = "Arial"
        r.font.size = Pt(12)
        r.font.color.rgb = RGBColor(0, 0, 0)
        r.font.italic = True

heading("Fuentes de implementación")
p("Interfaz: src/App.jsx (TwinView). Construcción de la copia y envío: src/services/twinApi.js. Contrato de datos: backend/app/schemas.py. Cálculos, calibración y comparación: backend/app/services.py. Pantalla de producción: etral-backoffice.vercel.app, sección Simulación.")

# Fuerza el formato solicitado en todos los elementos generados, incluidos los
# textos de tablas, encabezado, pie y pies de figura.
for style in styles:
    if style.type == 1:
        style.font.name = "Arial"
        style.font.color.rgb = RGBColor(0, 0, 0)
for paragraph in list(doc.paragraphs) + list(sec.header.paragraphs) + list(sec.footer.paragraphs):
    is_title = paragraph.style and paragraph.style.name in {"Title", "Heading 1", "Heading 2"}
    for run in paragraph.runs:
        run.font.name = "Arial"
        run.font.size = Pt(14 if is_title else 12)
        run.font.bold = True if is_title else run.font.bold
        run.font.color.rgb = RGBColor(0, 0, 0)
for tbl in doc.tables:
    for row in tbl.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.name = "Arial"
                    run.font.size = Pt(12)
                    run.font.color.rgb = RGBColor(0, 0, 0)

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print(OUT)
