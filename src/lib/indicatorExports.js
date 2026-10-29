import XLSX from "xlsx-js-style";
import { activityProgressDate, buildIndicatorSeries, materialConsumptionCost } from "./productivity.js";
import { addExportTitle, styleWorkbookSheet } from "./excelWorkbookStyle.js";
import { calculateSafetyStock, calculateThesisSafetyStock, hasSafetyStockParameters } from "./mrp.js";
import { deriveMaterialDemand } from "./materialDemand.js";

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

function recordedNumber(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  const first = Date.parse(`${String(start).slice(0, 10)}T12:00:00Z`);
  const last = Date.parse(`${String(end).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(first) && Number.isFinite(last) ? Math.round((last - first) / 86400000) : null;
}

function thesisRows(title, range, headers, rows, numberFormats = {}) {
  return { rows: [...titleRow(title, range), headers, ...rows], options: { preserveLayout: true, numberFormats } };
}

function appendSheet(workbook, name, rows, { preserveLayout = false, headerRow, numberFormats = {} } = {}) {
  const content = preserveLayout ? rows : addExportTitle(rows, name.toUpperCase(), "Exportado desde control de planta");
  const resolvedHeaderRow = headerRow ?? (preserveLayout ? 3 : 3);
  const sheet = XLSX.utils.aoa_to_sheet(content);
  XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(sheet, {
    title: content[0]?.[0] || name,
    subtitle: content[1]?.[0] || "Exportado desde control de planta",
    headerRow: resolvedHeaderRow,
    titleRow: 0,
    numberFormats
  }), name);
}

const definitions = [
  ["pmp_compliance", "Cumplimiento PMP", "%", "Unidades producidas / unidades planificadas × 100", "Resultado", "Escala"],
  ["progress_rate", "Nivel de avance", "%", "Actividades ejecutadas / actividades programadas × 100", "Resultado", "Escala"],
  ["average_delivery_delay", "Retraso promedio de entrega", "días", "Fecha real de entrega − fecha pactada", "Resultado", "Escala"],
  ["safety_coverage", "Cobertura de stock de seguridad", "%", "Materiales con disponible ≥ stock de seguridad / total materiales × 100", "Resultado", "Escala"],
  ["labor_productivity", "Productividad mano de obra", "und/HH", "Unidades producidas / horas-hombre", "Resultado", "Escala"],
  ["material_productivity", "Productividad materiales", "und/S/", "Unidades producidas / costo de materiales", "Resultado", "Escala"],
  ["multifactor_productivity", "Productividad multifactorial", "ratio", "Valor de salida / (materiales + mano de obra + otros factores)", "Resultado", "Escala"]
];

export function buildIndicatorsWorkbook(dataset, report, range, grouping = "month") {
  const workbook = XLSX.utils.book_new();
  const { current, previous } = report;
  const demandByCode = deriveMaterialDemand(dataset, range);
  const series = buildIndicatorSeries(dataset, range.start, range.end, grouping);
  const metricValues = [
    ["pmp_compliance", current.pmpCompliance, previous.pmpCompliance],
    ["progress_rate", current.progressRate, previous.progressRate],
    ["average_delivery_delay", current.averageLeadTime, previous.averageLeadTime],
    ["safety_coverage", current.safetyCoverage, previous.safetyCoverage],
    ["labor_productivity", current.laborProductivity, previous.laborProductivity],
    ["material_productivity", current.materialProductivity, previous.materialProductivity],
    ["multifactor_productivity", current.multifactorProductivity, previous.multifactorProductivity]
  ];
  const metricMap = new Map(metricValues.map((row) => [row[0], row]));
  appendSheet(workbook, "Resumen", [
    ...titleRow("INDICADORES PRODUCTIVOS", range),
    ["Variable SPSS", "Indicador", "Actual", "Periodo anterior", "Unidad", "Ecuación", "Rol", "Nivel de medición"],
    ...definitions.map(([variable, label, unit, equation, role, level]) => {
      const values = metricMap.get(variable);
      return [variable, label, values?.[1] ?? null, values?.[2] ?? null, unit, equation, role, level];
    })
  ], { preserveLayout: true, numberFormats: { 2: "0.00", 3: "0.00" } });
  appendSheet(workbook, "Serie temporal", [
    ["periodo", "fecha_inicio", "fecha_fin", "unidades_planificadas", "unidades_producidas", "horas_reportadas", "pmp_compliance", "progress_rate", "average_delivery_delay", "safety_coverage", "labor_productivity", "material_productivity", "multifactor_productivity"],
    ...series.map((row) => [row.label, row.start, row.end, row.plannedUnits, row.producedUnits, row.reportedHours, row.pmpCompliance, row.progressRate, row.averageLeadTime, row.safetyCoverage, row.laborProductivity, row.materialProductivity, row.multifactorProductivity])
  ], { numberFormats: { 3: "#,##0", 4: "#,##0", 5: "#,##0.00", 6: "0.00", 7: "0.00", 8: "0.00", 9: "0.00", 10: "0.000", 11: "0.0000", 12: "0.000" } });
  const relevantCecos = new Set([
    ...dataset.orders.filter((item) => inRange(item.dueDate, range.start, range.end)).map((item) => item.ceco),
    ...current.completedOrders.map((item) => item.ceco),
    ...(dataset.operations ?? []).filter((item) => inRange(item.date, range.start, range.end)).map((item) => item.ceco)
  ]);
  const completedByCeco = new Map(current.completedOrders.map((item) => [item.ceco, item]));
  const operations = dataset.operations ?? [];
  const activityProgress = dataset.activityProgress ?? [];
  const thesisPlan = thesisRows("FICHA DE RECOLECCIÓN Y CÁLCULO · PLAN MAESTRO, LEAD TIME Y AVANCE", range,
    ["Mes", "CECO", "Descripción de carrocería", "Cliente", "Fecha pactada de entrega (A)", "Fecha real de entrega (B)", "Días de retraso (B − A)", "Und. producidas", "Und. planificadas", "CPP (%)", "Actividades ejecutadas", "Actividades programadas", "Nivel de avance (%)", "Observaciones"],
    (dataset.orders ?? []).filter((item) => relevantCecos.has(item.ceco)).map((order) => {
      const completed = completedByCeco.get(order.ceco);
      const progress = activityProgress.filter((item) => item.ceco === order.ceco && inRange(activityProgressDate(item), range.start, range.end));
      const executed = progress.filter((item) => item.status === "completed" || Number(item.progress) >= 100).length;
      const product = (dataset.bodyTypes ?? []).find((item) => item.id === order.bodyTypeId);
      const due = order.dueDate?.slice(0, 10) ?? "";
      const actual = completed?.completionDate ?? "";
      const planned = inRange(due, range.start, range.end) ? 1 : 0;
      const produced = completed ? 1 : 0;
      return [due ? due.slice(0, 7) : (actual ? actual.slice(0, 7) : ""), order.ceco, product?.name ?? "", order.customer ?? "", due, actual,
        daysBetween(due, actual), produced, planned, planned ? produced / planned * 100 : null, executed, progress.length,
        progress.length ? executed / progress.length * 100 : null, completed?.estimated ? "Fecha real inferida; verificar" : ""];
    }), { 6: "0", 7: "0", 8: "0", 9: "0.00", 10: "0", 11: "0", 12: "0.00" });
  appendSheet(workbook, "Ficha plan maestro", thesisPlan.rows, thesisPlan.options);
  const thesisProductivity = thesisRows("FICHA DE RECOLECCIÓN Y CÁLCULO · PRODUCTIVIDAD", range,
    ["Fecha", "CECO", "Descripción de carrocería", "Unidades producidas", "N.º de trabajadores", "Tiempo real (horas-hombre)", "Costo por hora-hombre", "Productividad mano de obra (und/HH)", "Costo materia prima", "Costo insumos", "Costo total materiales", "Productividad materiales (und/S/)", "Producto total S/", "Energía S/", "Capital S/", "Productividad multifactorial", "Observaciones"],
    current.completedOrders.map((completed) => {
      const order = (dataset.orders ?? []).find((item) => item.ceco === completed.ceco);
      const product = (dataset.bodyTypes ?? []).find((item) => item.id === order?.bodyTypeId);
      const logs = operations.filter((item) => item.ceco === completed.ceco && inRange(item.date, range.start, range.end));
      const hours = logs.reduce((sum, item) => sum + Number(item.totalHours ?? 0), 0);
      const workers = new Set(logs.map((item) => item.worker).filter(Boolean)).size;
      const personnelRates = new Map((dataset.personnel ?? []).map((person) => [String(person.name ?? "").trim().toLocaleLowerCase("es"), person.hourlyCost]));
      const rates = logs.map((item) => recordedNumber(item.hourlyCost ?? item.laborCostPerHour ?? personnelRates.get(String(item.worker ?? "").trim().toLocaleLowerCase("es"))));
      const laborCost = logs.length && rates.every((item) => item !== null) ? logs.reduce((sum, item, index) => sum + Number(item.totalHours ?? 0) * rates[index], 0) : null;
      const { cost: materialCost, source: materialSource, estimatedPrices } = materialConsumptionCost(dataset, completed.ceco, range.start, range.end);
      const estimatedLabor = logs.some((item) => (dataset.personnel ?? []).some((person) => String(person.name ?? "").trim().toLocaleLowerCase("es") === String(item.worker ?? "").trim().toLocaleLowerCase("es") && String(person.hourlyCostBasis ?? "").startsWith("Estimado")));
      const output = recordedNumber(order?.outputValue);
      const energy = recordedNumber(order?.energyCost);
      const capital = recordedNumber(order?.capitalCost);
      const totalCost = materialCost !== null && laborCost !== null && energy !== null && capital !== null ? materialCost + laborCost + energy + capital : null;
      return [completed.completionDate, completed.ceco, product?.name ?? "", 1, workers || null, hours || null,
        laborCost !== null && hours > 0 ? laborCost / hours : null, hours > 0 ? 1 / hours : null,
        null, null, materialCost, materialCost > 0 ? 1 / materialCost : null, output, energy, capital,
        output !== null && totalCost > 0 ? output / totalCost : null,
        [completed.estimated ? "Fecha de cierre inferida" : "", materialSource, estimatedPrices ? "Precio de material estimado" : "", estimatedLabor ? "Tarifa laboral estimada" : "", [order?.outputValueBasis, order?.energyCostBasis, order?.capitalCostBasis].some((basis) => String(basis ?? "").startsWith("Estimado")) ? "Venta/energía/capital estimados" : "", materialCost !== null ? "Costo de materiales sin desglose de materia prima e insumos" : "Costo de materiales no disponible"].filter(Boolean).join("; ")];
    }), { 3: "0", 4: "0", 5: "0.00", 6: "0.00", 7: "0.000", 8: "0.00", 9: "0.00", 10: "0.00", 11: "0.0000", 12: "0.00", 13: "0.00", 14: "0.00", 15: "0.000" });
  appendSheet(workbook, "Ficha productividad", thesisProductivity.rows, thesisProductivity.options);
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
    ...(dataset.activityProgress ?? []).filter((item) => inRange(activityProgressDate(item), range.start, range.end)).map((item) => [item.ceco, dataset.stageActivities.find((activity) => activity.id === item.activityId)?.name ?? item.activityId, item.status, Number(item.progress ?? 0), item.startedAt ?? "", item.finishedAt ?? ""])
  ], { numberFormats: { 3: "0.00" } });
  appendSheet(workbook, "Movimientos materiales", [
    ["fecha", "tipo", "material", "ceco", "cantidad", "nota"],
    ...(dataset.inventoryMovements ?? []).filter((item) => inRange(item.timestamp, range.start, range.end)).map((item) => [item.timestamp, item.type, item.code, item.ceco ?? "", Number(item.quantity ?? 0), item.note ?? ""])
  ], { numberFormats: { 4: "#,##0.00" } });
  const thesisStock = thesisRows("FICHA DE RECOLECCIÓN DE DATOS Y CÁLCULO · STOCK DE SEGURIDAD", range,
    ["Fecha", "Material", "Unidad", "Costo unitario S/", "Origen del costo", "Demanda promedio (dp)", "Desviación estándar demanda (s1)", "Lead time proveedor (Lt) días", "Desv. est. lead time (s2)", "Nivel de servicio", "z", "SS según tesis", "SS operativo", "Observaciones", "Stock físico", "Comprometido", "Disponible", "Brecha vs. SS operativo"],
    (dataset.inventory ?? []).map((item) => {
      const estimatedDemand = demandByCode.get(item.code);
      const deviation = recordedNumber(item.demandStdDev) ?? recordedNumber(estimatedDemand?.demandStdDev);
      const leadTime = recordedNumber(item.leadTimeDays);
      const averageDemand = recordedNumber(item.averageDemand) ?? recordedNumber(estimatedDemand?.averageDemand);
      const leadTimeDeviation = recordedNumber(item.leadTimeStdDev);
      const safety = calculateSafetyStock(item);
      const available = Number(item.physical ?? 0) - Number(item.committed ?? 0);
      const estimatedInput = { ...item, averageDemand, demandStdDev: deviation };
      const thesisSafety = calculateThesisSafetyStock(estimatedInput);
      const missing = [["dp", averageDemand], ["s1", deviation], ["Lt", leadTime], ["s2", leadTimeDeviation], ["z", recordedNumber(item.serviceFactor)]]
        .filter(([, value]) => value === null).map(([label]) => label);
      const provenance = estimatedDemand && (recordedNumber(item.averageDemand) === null || recordedNumber(item.demandStdDev) === null)
        ? `dp/s1 estimados desde ${estimatedDemand.source} en ${estimatedDemand.days} días; ` : "";
      return [range.end, `${item.code} · ${item.description}`, item.unit, recordedNumber(item.unitCost), item.unitCostBasis ?? "Registrado", averageDemand, deviation, leadTime, leadTimeDeviation,
        recordedNumber(item.serviceLevel), recordedNumber(item.serviceFactor), thesisSafety, safety,
        missing.length ? `${provenance}Corte de inventario; SS de tesis no calculable: falta ${missing.join(", ")}. Se conserva el mínimo previo registrado.` : `${provenance}${item.safetyParametersBasis ?? ""}; SS aplicado = fórmula de tesis`,
        Number(item.physical ?? 0), Number(item.committed ?? 0), available, available - safety];
    }), { 3: "#,##0.00", 5: "0.00", 6: "0.00", 7: "0.00", 8: "0.00", 9: "0.00%", 10: "0.00", 11: "#,##0", 12: "#,##0", 14: "#,##0.00", 15: "#,##0.00", 16: "#,##0.00", 17: "#,##0.00" });
  appendSheet(workbook, "Stock seguridad", thesisStock.rows, thesisStock.options);
  appendSheet(workbook, "Diccionario SPSS", [
    ["variable", "etiqueta", "tipo", "nivel", "valores / criterio"],
    ...definitions.map(([variable, label, _unit, equation, _role, level]) => [variable, label, "Numérico", level, equation]),
    ["ceco", "Código de orden de producción", "Texto", "Nominal", "Identificador único"],
    ["horas_hombre", "Horas reportadas en parte diario", "Numérico", "Escala", "≥ 0"],
    ["avance_pct", "Avance de actividad u orden", "Numérico", "Escala", "0 a 100"]
  ]);
  return workbook;
}

export function exportIndicatorsWorkbook(dataset, report, range, grouping = "month") {
  downloadWorkbook(buildIndicatorsWorkbook(dataset, report, range, grouping), `indicadores_${range.start}_${range.end}.xlsx`);
}

export function exportPeriodRecords(dataset, range) {
  const workbook = XLSX.utils.book_new();

  // Función ayudante para exportar cualquier arreglo de objetos
  const exportTable = (sheetName, dataArray, dateField = null) => {
    if (!Array.isArray(dataArray) || dataArray.length === 0) return;
    
    // Filtrar por fecha si se especifica un campo de fecha
    const filteredData = dateField 
      ? dataArray.filter(item => inRange(item[dateField], range.start, range.end))
      : dataArray;
      
    if (filteredData.length === 0) return;

    const headers = Object.keys(filteredData[0]).filter(k => typeof filteredData[0][k] !== "object");
    const rows = [headers, ...filteredData.map(item => headers.map(h => {
      const val = item[h];
      return typeof val === "boolean" ? (val ? "Sí" : "No") : val;
    }))];
    
    appendSheet(workbook, sheetName.substring(0, 31), rows); // Nombres de hojas en Excel tienen límite de 31 caracteres
  };

  exportTable("Órdenes", dataset.orders, "createdAt");
  exportTable("Operaciones", dataset.operations, "date");
  exportTable("Avance actividades", dataset.activityProgress);
  exportTable("Movimientos materiales", dataset.inventoryMovements, "timestamp");
  exportTable("Inventario", (dataset.inventory ?? []).map((item) => ({
    ...item,
    safety: calculateSafetyStock(item),
    safetySource: hasSafetyStockParameters(item) ? "Fórmula de tesis" : "Mínimo previo registrado"
  })));
  exportTable("BOM", dataset.bom);
  exportTable("Salidas almacén", dataset.warehouse, "date");
  exportTable("Controles de calidad", dataset.quality, "date");
  exportTable("Clientes", dataset.customers);
  exportTable("Personal", dataset.personnel);
  exportTable("Tipos de carrocería", dataset.bodyTypes);
  exportTable("Fases de flujo", dataset.flowStages);
  exportTable("Actividades", dataset.stageActivities);
  exportTable("Reservas de material", dataset.orderMaterialReservations);
  exportTable("Turnos", dataset.shifts);
  exportTable("Asignaciones", dataset.assignments, "date");
  exportTable("Incidencias", dataset.incidents, "date");

  downloadWorkbook(workbook, `registros_${range.start}_${range.end}.xlsx`);
}
