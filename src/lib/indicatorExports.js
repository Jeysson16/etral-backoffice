import * as XLSX from "xlsx";
import { buildIndicatorSeries } from "./productivity.js";
import { addExportTitle, styleWorkbookSheet } from "./excelWorkbookStyle.js";

function inRange(value, start, end) {
  const date = String(value ?? "").slice(0, 10);
  return Boolean(date && date >= start && date <= end);
}

function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}

function titleRow(title, range) {
  return [[title], ["Periodo", `${range.start} a ${range.end}`], []];
}

function appendSheet(workbook, name, rows, { preserveLayout = false, headerRow, numberFormats = {} } = {}) {
  const content = preserveLayout ? rows : addExportTitle(rows, name.toUpperCase(), "Exportado desde ETRAL");
  const resolvedHeaderRow = headerRow ?? (preserveLayout ? 3 : 3);
  const sheet = XLSX.utils.aoa_to_sheet(content);
  XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(sheet, {
    title: content[0]?.[0] || name,
    subtitle: content[1]?.[0] || "Exportado desde ETRAL",
    headerRow: resolvedHeaderRow,
    titleRow: 0,
    numberFormats
  }), name);
}

const definitions = [
  ["pmp_compliance", "Cumplimiento PMP", "%", "Unidades producidas / unidades planificadas × 100", "Resultado", "Escala"],
  ["progress_rate", "Nivel de avance", "%", "Actividades ejecutadas / actividades programadas × 100", "Resultado", "Escala"],
  ["average_lead_time", "Lead time promedio", "días", "Fecha de entrega − fecha de pedido", "Resultado", "Escala"],
  ["safety_coverage", "Cobertura de stock de seguridad", "%", "Materiales con disponible ≥ stock de seguridad / total materiales × 100", "Resultado", "Escala"],
  ["labor_productivity", "Productividad mano de obra", "und/HH", "Unidades producidas / horas-hombre", "Resultado", "Escala"],
  ["material_productivity", "Productividad materiales", "und/S/", "Unidades producidas / costo de materiales", "Resultado", "Escala"],
  ["multifactor_productivity", "Productividad multifactorial", "ratio", "Valor de salida / (materiales + mano de obra + otros factores)", "Resultado", "Escala"]
];

export function exportIndicatorsWorkbook(dataset, report, range, grouping = "month") {
  const workbook = XLSX.utils.book_new();
  const { current, previous } = report;
  const series = buildIndicatorSeries(dataset, range.start, range.end, grouping);
  const metricValues = [
    ["pmp_compliance", current.pmpCompliance, previous.pmpCompliance],
    ["progress_rate", current.progressRate, previous.progressRate],
    ["average_lead_time", current.averageLeadTime, previous.averageLeadTime],
    ["safety_coverage", current.safetyCoverage, previous.safetyCoverage],
    ["labor_productivity", current.laborProductivity, previous.laborProductivity],
    ["material_productivity", current.materialProductivity, previous.materialProductivity],
    ["multifactor_productivity", current.multifactorProductivity, previous.multifactorProductivity]
  ];
  const metricMap = new Map(metricValues.map((row) => [row[0], row]));
  appendSheet(workbook, "Resumen", [
    ...titleRow("INDICADORES PRODUCTIVOS ETRAL", range),
    ["Variable SPSS", "Indicador", "Actual", "Periodo anterior", "Unidad", "Ecuación", "Rol", "Nivel de medición"],
    ...definitions.map(([variable, label, unit, equation, role, level]) => {
      const values = metricMap.get(variable);
      return [variable, label, values?.[1] ?? null, values?.[2] ?? null, unit, equation, role, level];
    })
  ], { preserveLayout: true, numberFormats: { 2: "0.00", 3: "0.00" } });
  appendSheet(workbook, "Serie temporal", [
    ["periodo", "fecha_inicio", "fecha_fin", "unidades_planificadas", "unidades_producidas", "horas_reportadas", "pmp_compliance", "progress_rate", "average_lead_time", "safety_coverage", "labor_productivity", "material_productivity", "multifactor_productivity"],
    ...series.map((row) => [row.label, row.start, row.end, row.plannedUnits, row.producedUnits, row.reportedHours, row.pmpCompliance, row.progressRate, row.averageLeadTime, row.safetyCoverage, row.laborProductivity, row.materialProductivity, row.multifactorProductivity])
  ], { numberFormats: { 3: "#,##0", 4: "#,##0", 5: "#,##0.00", 6: "0.00", 7: "0.00", 8: "0.00", 9: "0.00", 10: "0.000", 11: "0.0000", 12: "0.000" } });
  const relevantCecos = new Set([
    ...dataset.orders.filter((item) => inRange(item.dueDate, range.start, range.end)).map((item) => item.ceco),
    ...current.completedOrders.map((item) => item.ceco),
    ...(dataset.operations ?? []).filter((item) => inRange(item.date, range.start, range.end)).map((item) => item.ceco)
  ]);
  appendSheet(workbook, "Registros CECO", [
    ["ceco", "cliente", "producto", "linea", "estado", "avance_pct", "fecha_pactada", "fecha_inicio_plan", "fecha_final", "calidad_fecha_final"],
    ...dataset.orders.filter((item) => relevantCecos.has(item.ceco)).map((order) => {
      const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
      const completed = current.completedOrders.find((item) => item.ceco === order.ceco);
      return [order.ceco, order.customer, product?.name ?? "", order.line, order.plantState ?? order.status, Number(order.progress ?? 0), order.dueDate ?? "", order.plannedStartDate ?? "", completed?.completionDate ?? "", completed ? (completed.estimated ? "inferida" : "documentada") : "sin cierre"];
    })
  ], { numberFormats: { 5: "0.00" } });
  appendSheet(workbook, "Partes operacion", [
    ["fecha", "ceco", "trabajador", "actividad", "horas_hombre"],
    ...(dataset.operations ?? []).filter((item) => inRange(item.date, range.start, range.end)).map((item) => [item.date, item.ceco, item.worker, item.activity, Number(item.totalHours ?? 0)])
  ], { numberFormats: { 4: "#,##0.00" } });
  appendSheet(workbook, "Avance actividades", [
    ["ceco", "actividad", "estado", "avance_pct", "inicio", "fin"],
    ...(dataset.activityProgress ?? []).filter((item) => inRange(item.startedAt ?? item.finishedAt, range.start, range.end)).map((item) => [item.ceco, dataset.stageActivities.find((activity) => activity.id === item.activityId)?.name ?? item.activityId, item.status, Number(item.progress ?? 0), item.startedAt ?? "", item.finishedAt ?? ""])
  ], { numberFormats: { 3: "0.00" } });
  appendSheet(workbook, "Movimientos materiales", [
    ["fecha", "tipo", "material", "ceco", "cantidad", "nota"],
    ...(dataset.inventoryMovements ?? []).filter((item) => inRange(item.timestamp, range.start, range.end)).map((item) => [item.timestamp, item.type, item.code, item.ceco ?? "", Number(item.quantity ?? 0), item.note ?? ""])
  ], { numberFormats: { 4: "#,##0.00" } });
  appendSheet(workbook, "Diccionario SPSS", [
    ["variable", "etiqueta", "tipo", "nivel", "valores / criterio"],
    ...definitions.map(([variable, label, _unit, equation, _role, level]) => [variable, label, "Numérico", level, equation]),
    ["ceco", "Código de orden de producción", "Texto", "Nominal", "Identificador único"],
    ["horas_hombre", "Horas reportadas en parte diario", "Numérico", "Escala", "≥ 0"],
    ["avance_pct", "Avance de actividad u orden", "Numérico", "Escala", "0 a 100"]
  ]);
  downloadWorkbook(workbook, `ETRAL_indicadores_${range.start}_${range.end}.xlsx`);
}

export function exportPeriodRecords(dataset, range) {
  const workbook = XLSX.utils.book_new();
  appendSheet(workbook, "Partes operacion", [["fecha", "ceco", "trabajador", "actividad", "horas_hombre"], ...(dataset.operations ?? []).filter((item) => inRange(item.date, range.start, range.end)).map((item) => [item.date, item.ceco, item.worker, item.activity, Number(item.totalHours ?? 0)])], { numberFormats: { 4: "#,##0.00" } });
  appendSheet(workbook, "Avance actividades", [["ceco", "actividad_id", "estado", "avance_pct", "inicio", "fin"], ...(dataset.activityProgress ?? []).filter((item) => inRange(item.startedAt ?? item.finishedAt, range.start, range.end)).map((item) => [item.ceco, item.activityId, item.status, Number(item.progress ?? 0), item.startedAt ?? "", item.finishedAt ?? ""])], { numberFormats: { 3: "0.00" } });
  appendSheet(workbook, "Movimientos materiales", [["fecha", "tipo", "material", "ceco", "cantidad", "nota"], ...(dataset.inventoryMovements ?? []).filter((item) => inRange(item.timestamp, range.start, range.end)).map((item) => [item.timestamp, item.type, item.code, item.ceco ?? "", Number(item.quantity ?? 0), item.note ?? ""])], { numberFormats: { 4: "#,##0.00" } });
  downloadWorkbook(workbook, `ETRAL_registros_${range.start}_${range.end}.xlsx`);
}
