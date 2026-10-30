import React from "react";
import { summarizeThesisInstrument } from "../lib/thesisInstrument.js";

const fmt = (value, digits = 3) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("es-PE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function ThesisInstrumentPanel({ measurements = [] }) {
  const { pre, post, rows } = summarizeThesisInstrument(measurements);
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
    <div className="thesis-method-note"><strong>Cómo se lee:</strong> Mano de obra = kg ÷ horas; materiales = kg ÷ (materia prima + insumos). Multifactorial vigente = valor producido ÷ (horas × costo/hora + materiales). El Excel incluye además energía en esta última razón: promedio después {fmt(post.workbookMultifactor)}.</div>
    <div className="table-scroll thesis-instrument-scroll"><table><thead><tr><th>Grupo / fecha</th><th>CECO · carrocería</th><th>Peso kg</th><th>Horas</th><th>Trab.</th><th>Materia prima S/</th><th>Insumos S/</th><th>Valor S/</th><th>kg/h</th><th>kg/S/</th><th>Multi. vigente</th><th>Multi. Excel</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.phase}-${row.ceco}`}>
      <td><span className={`thesis-phase ${row.phase}`}>{row.phase === "pre" ? "Antes" : "Después"}</span><small>{row.date}</small></td>
      <td><strong>{row.ceco}</strong><small>{row.product}</small></td>
      <td>{fmt(row.weightKg, 2)}</td><td>{fmt(row.laborHours, 2)}</td><td>{row.workers}</td><td>{fmt(row.rawMaterialCost, 2)}</td><td>{fmt(row.suppliesCost, 2)}</td><td>{fmt(row.outputValue, 2)}</td>
      <td><strong>{fmt(row.laborProductivity)}</strong></td><td><strong>{fmt(row.materialProductivity, 4)}</strong></td><td>{fmt(row.thesisMultifactor)}</td><td>{fmt(row.workbookMultifactor)}</td>
    </tr>)}</tbody></table></div>
    <p className="thesis-source">Fuente: INSTRUMENTOS DE TESIS.xlsx · hojas «Pre MO y MAT» y «Post MO y MAT». Las cifras del instrumento se conservan separadas del Kardex y de las estimaciones operativas.</p>
  </section>;
}
