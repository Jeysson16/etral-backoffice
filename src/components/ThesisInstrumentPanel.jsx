import React, { useState } from "react";
import { summarizeThesisInstrument } from "../lib/thesisInstrument.js";

const fmt = (value, digits = 2) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function ThesisInstrumentPanel({ measurements = [] }) {
  const { pre, post, rows, verifiedWorkbookRows, verifiedGroups, groupCount } = summarizeThesisInstrument(measurements);
  const [phase, setPhase] = useState("post");
  if (!rows.length) return null;
  const selected = phase === "post" ? post : pre;
  const visibleRows = rows.filter((row) => row.phase === phase);
  const metrics = [
    ["Mano de obra", "kg/h", "labor", 2],
    ["Materiales", "kg/S/", "materials", 3],
    ["Multifactorial · Excel", "veces", "workbookMultifactor", 2]
  ];
  return <section className="panel thesis-instrument-panel">
    <div className="section-header"><div><p className="eyebrow">Ficha de recolección de datos y cálculo</p><h2>Productividad por CECO</h2><p>Valores de «INSTRUMENTOS DE TESIS.xlsx», con sus campos y fórmulas originales.</p></div><span className="coverage-chip">{pre.count} antes · {post.count} después</span></div>
    <div className="thesis-instrument-metrics">{metrics.map(([label, unit, key, digits]) => <article key={key}>
      <span>{label}</span><strong>{fmt(post[key], digits)} <small>{unit}</small></strong>
      <p>Antes {fmt(pre[key], digits)} · Después {fmt(post[key], digits)}</p>
    </article>)}</div>
    <div className="thesis-method-note"><b>Fórmulas de la ficha:</b> mano de obra H = D ÷ F; materiales L = D ÷ (I + J); multifactorial P = M ÷ (F × G + N + O). En este libro O = K = I + J y N vacío equivale a cero. El indicador operativo de la página aplica el criterio del Word: M ÷ (F × G + I + J).</div>
    <div className="thesis-phase-tabs" role="tablist" aria-label="Periodo de la ficha">
      <button type="button" role="tab" aria-selected={phase === "post"} className={phase === "post" ? "active" : ""} onClick={() => setPhase("post")}>Después · {post.count} CECO</button>
      <button type="button" role="tab" aria-selected={phase === "pre"} className={phase === "pre" ? "active" : ""} onClick={() => setPhase("pre")}>Antes · {pre.count} CECO</button>
    </div>
    <div className="table-scroll thesis-instrument-scroll"><table><thead>
      <tr className="thesis-column-groups"><th colSpan="3">Registro</th><th colSpan="5">Mano de obra</th><th colSpan="4">Materiales</th><th colSpan="4">Multifactorial</th><th colSpan="3">Sumas de bloques</th></tr>
      <tr><th>A · h base</th><th>B · Fecha</th><th>C · CECO y carrocería</th><th>D · Peso kg</th><th>E · Trab.</th><th>F · Horas</th><th>G · S/ hora</th><th>H · kg/h</th><th>I · Materia prima S/</th><th>J · Insumos S/</th><th>K · Total S/</th><th>L · kg/S/</th><th>M · Producto S/</th><th>N · Energía S/</th><th>O · Capital S/</th><th>P · Multi. Excel</th><th>Q · Σ multi.</th><th>R · Σ kg/h</th><th>S · Σ kg/S/</th></tr>
    </thead><tbody>{visibleRows.map((row) => <tr key={`${row.phase}-${row.ceco}`}>
      <td>{fmt(row.baseHours)}</td><td>{row.date}</td><td><strong>{row.ceco}</strong><small>{row.product}</small></td>
      <td>{fmt(row.weightKg)}</td><td>{row.workers}</td><td>{fmt(row.laborHours)}</td><td>{fmt(row.hourlyCost, 4)}</td><td className="thesis-result-cell">{fmt(row.laborProductivity, 3)}</td>
      <td>{fmt(row.rawMaterialCost)}</td><td>{fmt(row.suppliesCost)}</td><td>{fmt(row.materials)}</td><td className="thesis-result-cell">{fmt(row.materialProductivity, 3)}</td>
      <td>{fmt(row.outputValue)}</td><td>{fmt(row.energyCost)}</td><td>{fmt(row.capitalCost)}</td><td className="thesis-result-cell">{fmt(row.workbookMultifactor, 3)}</td>
      <td>{fmt(row.groupMultifactorSum, 3)}</td><td>{fmt(row.groupLaborSum, 3)}</td><td>{fmt(row.groupMaterialSum, 3)}</td>
    </tr>)}<tr className="thesis-average-row"><td colSpan="7">PROMEDIO · {phase === "post" ? "DESPUÉS" : "ANTES"} · {selected.count} CECO</td><td>{fmt(selected.labor, 3)}</td><td colSpan="3"></td><td>{fmt(selected.materials, 3)}</td><td colSpan="3"></td><td>{fmt(selected.workbookMultifactor, 3)}</td><td colSpan="3"></td></tr></tbody></table></div>
    <p className="thesis-source">Fuente: hojas «Pre MO y MAT» y «Post MO y MAT». P coincide con el Excel en {verifiedWorkbookRows}/{rows.length} filas; Q–S en {verifiedGroups}/{groupCount} bloques. Las cifras de la ficha se conservan separadas del Kardex.</p>
  </section>;
}
