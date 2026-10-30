import React, { useMemo, useState } from "react";
import { calculateSafetyStock } from "../lib/mrp.js";
import { activityProgressDate, materialConsumptionCost } from "../lib/productivity.js";

const inRange = (value, range) => {
  const date = String(value || "").slice(0, 10);
  return Boolean(date && date >= range.start && date <= range.end);
};
const number = (value, digits = 2) => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("es-PE", { maximumFractionDigits: digits });
const daysBetween = (a, b) => a && b ? Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000) : null;
const workerKey = (value) => String(value || "").trim().toLocaleLowerCase("es");

export function buildIndicatorDetails(dataset, report, range) {
  const completed = new Map(report.current.completedOrders.map((item) => [item.ceco, item]));
  const orders = dataset.orders || [];
  const operations = (dataset.operations || []).filter((item) => inRange(item.date, range));
  const progress = (dataset.activityProgress || []).filter((item) => inRange(activityProgressDate(item), range));
  const rates = new Map((dataset.personnel || []).map((person) => [workerKey(person.name), person.hourlyCost]));
  const completedRows = report.current.completedOrders.map((item) => ({ ...item, order: orders.find((order) => order.ceco === item.ceco) }));
  const materialRows = completedRows.map((item) => ({ ...item, material: materialConsumptionCost(dataset, item.ceco, range.start, range.end) }));
  const measured = report.current.measurementMode === "weight" ? report.current.cecoMeasurements : null;
  const laborCost = (ceco) => {
    const rows = operations.filter((item) => item.ceco === ceco);
    if (!rows.length) return null;
    const costs = rows.map((item) => item.hourlyCost ?? item.laborCostPerHour ?? rates.get(workerKey(item.worker)));
    return costs.every((value) => value != null && Number.isFinite(Number(value)))
      ? rows.reduce((sum, item, index) => sum + Number(item.totalHours || 0) * Number(costs[index]), 0) : null;
  };
  return [
    { key: "pmp", label: "Cumplimiento PMP", columns: ["CECO", "Carrocería", "Fin pactado", "Fin registrado", "En plan", "Producida", "Dato"], rows: orders.filter((order) => inRange(order.dueDate, range) || completed.has(order.ceco)).map((order) => {
      const done = completed.get(order.ceco);
      return [order.ceco, (dataset.bodyTypes || []).find((item) => item.id === order.bodyTypeId)?.name || "—", order.dueDate || "—", done?.completionDate || "—", inRange(order.dueDate, range) ? "Sí" : "No", done ? "Sí" : "No", done?.estimated ? "Fin inferido; falta fecha real" : done ? "Fin registrado" : "Pendiente"];
    }), note: "Denominador: CECO con fecha pactada en el periodo. Numerador: CECO terminados en el periodo; una fecha inferida se identifica." },
    { key: "progress", label: "Nivel de avance", columns: ["CECO", "Actividad", "Estado", "Avance", "Inicio", "Fin", "Cuenta como ejecutada"], rows: progress.map((item) => [item.ceco, (dataset.stageActivities || []).find((activity) => activity.id === item.activityId)?.name || item.activityId, item.status, `${number(item.progress)}%`, item.startedAt || "—", item.finishedAt || "—", item.status === "completed" || Number(item.progress) >= 100 ? "Sí" : "No"]), note: "Se cuentan las actividades con registro fechado en el periodo." },
    { key: "delivery", label: "Retraso de entrega", columns: ["CECO", "Fin pactado", "Fin registrado", "Diferencia", "Uso en promedio", "Calidad"], rows: completedRows.map((item) => [item.ceco, item.dueDate || "—", item.completionDate || "—", daysBetween(item.completionDate, item.dueDate) == null ? "—" : `${daysBetween(item.completionDate, item.dueDate)} días`, item.estimated ? "No" : "Sí", item.estimated ? "Fecha inferida" : "Fecha registrada"]), note: "El promedio solo usa fechas de fin reales; un valor negativo significa entrega anticipada." },
    { key: "safety", label: "Cobertura de seguridad", columns: ["Material", "Físico", "Comprometido", "Disponible", "SS", "Brecha", "Parámetros"], rows: (dataset.inventory || []).map((item) => {
      const available = Number(item.physical || 0) - Number(item.committed || 0);
      const safety = calculateSafetyStock(item);
      return [`${item.code} · ${item.description}`, `${number(item.physical)} ${item.unit}`, number(item.committed), number(available), number(safety), number(available - safety), item.safetyParametersBasis || "Registrados"];
    }), note: "Disponible = físico − comprometido. La tabla conserva los valores bajo el mínimo para su revisión." },
    { key: "labor", label: "Productividad laboral", columns: measured ? ["CECO", "Peso kg", "Horas", "Trabajadores", "S/ hora", "kg/h"] : ["Fecha", "CECO", "Trabajador", "Actividad", "Horas", "Tarifa S/ por hora"], rows: measured ? measured.map((row) => [row.ceco, number(row.weightKg), number(row.hours), row.workers, number(row.hourlyCost, 4), number(row.laborProductivity, 3)]) : operations.map((item) => [item.date, item.ceco, item.worker, item.activity, number(item.totalHours), number(item.hourlyCost ?? item.laborCostPerHour ?? rates.get(workerKey(item.worker)))]), note: measured ? "Promedio de peso ÷ horas por CECO terminado." : "Las horas se suman en el periodo; el numerador son los CECO terminados del mismo periodo." },
    { key: "materials", label: "Productividad de materiales", columns: measured ? ["CECO", "Peso kg", "Materia prima S/", "Insumos S/", "Total S/", "kg/S/"] : ["CECO terminado", "Fecha", "Cantidad acreditada", "Costo de materiales S/", "Procedencia"], rows: measured ? measured.map((row) => [row.ceco, number(row.weightKg), number(row.rawMaterialCost), number(row.suppliesCost), number(row.materialCost), number(row.materialProductivity, 4)]) : materialRows.map((item) => [item.ceco, item.completionDate, number(item.material.quantity), number(item.material.cost), `${item.material.source}${item.material.estimatedPrices ? "; precios estimados" : ""}`]), note: measured ? "Promedio de peso ÷ (materia prima + insumos) por CECO terminado." : "El avance de fases puede acreditar cantidades BOM estimadas; las salidas registradas tienen prioridad para evitar duplicaciones." },
    { key: "multifactor", label: "Productividad multifactorial", columns: measured ? ["CECO", "Producto S/", "Horas", "S/ hora", "Energía S/", "Capital S/", "Denominador S/", "Resultado"] : ["CECO terminado", "Valor producido S/", "Materiales S/", "Mano de obra S/", "Denominador S/", "Energía S/", "Capital S/", "Procedencia"], rows: measured ? measured.map((row) => [row.ceco, number(row.outputValue), number(row.hours), number(row.hourlyCost, 4), number(row.energyCost), number(row.capitalCost), number(row.laborCost + row.energyCost + row.capitalCost), number(row.multifactorProductivity, 3)]) : materialRows.map((item) => {
      const labor = laborCost(item.ceco);
      const energy = item.order?.energyCost;
      const capital = item.order?.capitalCost;
      const factors = [item.material.cost, labor].every((value) => value != null) ? Number(item.material.cost) + Number(labor) : null;
      return [item.ceco, number(item.order?.outputValue), number(item.material.cost), number(labor), number(factors), number(energy), number(capital), [item.order?.outputValueBasis, item.material.estimatedPrices ? "precio estimado" : null].filter(Boolean).join(" · ") || "Registrado"];
    }), note: measured ? "Promedio de producto ÷ (horas × tarifa + energía + capital) por CECO terminado." : "Valor producido ÷ (mano de obra + materiales)." }
  ];
}

export default function IndicatorDetails({ dataset, report, range }) {
  const [selected, setSelected] = useState("pmp");
  const details = useMemo(() => buildIndicatorDetails(dataset, report, range), [dataset, report, range]);
  const active = details.find((item) => item.key === selected) || details[0];
  return <section className="panel indicator-detail-panel">
    <div className="section-header"><div><p className="eyebrow">Respaldo por indicador</p><h2>Valores y registros del periodo</h2><p>Selecciona una tarjeta para revisar los registros que intervienen en su cálculo.</p></div></div>
    <div className="indicator-detail-tabs">{details.map((item) => <button key={item.key} type="button" className={selected === item.key ? "active" : ""} onClick={() => setSelected(item.key)}>{item.label}<b>{item.rows.length}</b></button>)}</div>
    <p className="indicator-detail-note">{active.note}</p>
    <div className="table-scroll indicator-detail-scroll"><table><thead><tr>{active.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{active.rows.map((row, index) => <tr key={`${active.key}-${index}`}>{row.map((value, cell) => <td key={cell}>{value ?? "—"}</td>)}</tr>)}</tbody></table></div>
    {!active.rows.length && <p className="planning-empty">No hay registros para este indicador en el periodo seleccionado.</p>}
  </section>;
}
