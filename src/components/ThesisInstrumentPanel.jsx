import React from "react";
import { summarizeThesisInstrument } from "../lib/thesisInstrument.js";

const fmt = (value, digits = 3) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function ThesisInstrumentPanel({ measurements = [] }) {
  const { pre, post, rows, verifiedWorkbookRows, verifiedGroups, groupCount } = summarizeThesisInstrument(measurements);
  if (!rows.length) return null;
  const metrics = [
    ["Mano de obra", "kg/h", "labor", 3],
    ["Materiales", "kg/S/", "materials", 4],
    ["Multifactorial", "veces", "multifactor", 3]
  ];
  return <section className="panel thesis-instrument-panel">
    <div className="section-header"><div><p className="eyebrow">Instrumento de tesis · CECO</p><h2>Productividad antes y después</h2><p>Serie completa del Excel: promedio de cocientes por carrocería.</p></div><span className="coverage-chip">{pre.count} antes · {post.count} después</span></div>
    <div className="thesis-instrument-metrics">{metrics.map(([label, unit, key, digits]) => <article key={key}>
      <span>{label}</span><strong>{fmt(post[key], digits)} <small>{unit}</small></strong>
      <p>Antes {fmt(pre[key], digits)} · Después {fmt(post[key], digits)}</p>
    </article>)}</div>
    <div className="thesis-method-note"><strong>Fórmulas:</strong> H = D ÷ F (kg/h); L = D ÷ (I + J) (kg/S/); P del Excel = M ÷ (F × G + N + O). En el libro, O = I + J y N en blanco cuenta como cero. El indicador multifactorial vigente usa M ÷ (F × G + I + J). <b>{verifiedWorkbookRows}/{rows.length} filas verificadas</b>.</div>
    <div className="table-scroll thesis-instrument-scroll"><table><thead><tr><th>Grupo / fecha</th><th>CECO · carrocería</th><th>Peso kg</th><th>Horas</th><th>Trab.</th><th>Materia prima S/</th><th>Insumos S/</th><th>Valor S/</th><th>kg/h</th><th>kg/S/</th><th>Multi. vigente</th><th>Multi. Excel</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.phase}-${row.ceco}`}>
      <td><span className={`thesis-phase ${row.phase}`}>{row.phase === "pre" ? "Antes" : "Después"}</span><small>{row.date}</small></td>
      <td><strong>{row.ceco}</strong><small>{row.product}</small></td>
      <td>{fmt(row.weightKg, 2)}</td><td>{fmt(row.laborHours, 2)}</td><td>{row.workers}</td><td>{fmt(row.rawMaterialCost, 2)}</td><td>{fmt(row.suppliesCost, 2)}</td><td>{fmt(row.outputValue, 2)}</td>
      <td><strong>{fmt(row.laborProductivity)}</strong></td><td><strong>{fmt(row.materialProductivity, 4)}</strong></td><td>{fmt(row.thesisMultifactor)}</td><td>{fmt(row.workbookMultifactor)}</td>
    </tr>)}</tbody></table></div>
    <div className="thesis-extra-header"><h3>Otros valores del Excel</h3><span>A y G son entradas; N y O intervienen en P. Q–S suman bloques ({verifiedGroups}/{groupCount} verificados).</span></div>
    <div className="table-scroll thesis-extra-scroll"><table><thead><tr><th>Grupo</th><th>CECO</th><th>A · base h</th><th>G · S/h</th><th>N · energía S/</th><th>O · capital S/</th><th>Q · Σ multi</th><th>R · Σ kg/h</th><th>S · Σ kg/S/</th><th>CECO incluidos en Q–S</th></tr></thead><tbody>{rows.map((row) => <tr key={`extra-${row.phase}-${row.ceco}`}>
      <td>{row.phase === "pre" ? "Antes" : "Después"}</td><td><strong>{row.ceco}</strong></td><td>{fmt(row.baseHours, 2)}</td><td>{fmt(row.hourlyCost, 4)}</td><td>{fmt(row.energyCost, 2)}</td><td>{fmt(row.capitalCost, 2)}</td><td>{fmt(row.groupMultifactorSum)}</td><td>{fmt(row.groupLaborSum)}</td><td>{fmt(row.groupMaterialSum, 4)}</td><td>{row.groupCecos ?? "—"}</td>
    </tr>)}</tbody></table></div>
    <p className="thesis-source">Fuente: INSTRUMENTOS DE TESIS.xlsx · hojas «Pre MO y MAT» y «Post MO y MAT». Las cifras del instrumento se conservan separadas del Kardex y de las estimaciones operativas.</p>
  </section>;
}
