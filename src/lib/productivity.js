import { calculateSafetyStock } from "./mrp.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function dayNumber(value) {
  const normalized = dateOnly(value);
  return normalized ? Date.parse(`${normalized}T12:00:00Z`) / DAY_MS : null;
}

function inRange(value, start, end) {
  const date = dateOnly(value);
  return Boolean(date && date >= start && date <= end);
}

function percent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function materialConsumptionCost(dataset, ceco, start, end) {
  const reservations = (dataset.orderMaterialReservations ?? []).filter((row) => row.ceco === ceco && Number(row.consumedQuantity) > 0);
  const movements = (dataset.inventoryMovements ?? []).filter((row) => row.ceco === ceco && row.type === "salida" && inRange(row.timestamp, start, end));
  const warehouse = (dataset.warehouse ?? []).filter((row) => row.ceco === ceco && inRange(row.timestamp ?? row.date, start, end));
  const rows = reservations.length
    ? reservations.map((row) => ({ code: row.materialCode, quantity: row.consumedQuantity }))
    : movements.length
      ? movements.map((row) => ({ code: row.code, quantity: row.quantity }))
      : warehouse.map((row) => ({ code: row.materialCode, quantity: row.quantity }));
  if (!rows.length) return { cost: null, source: "Sin consumo documentado" };
  const inventory = new Map((dataset.inventory ?? []).map((item) => [item.code, item]));
  const costs = rows.map((row) => inventory.get(row.code)?.unitCost);
  if (costs.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)))) {
    return { cost: null, source: "Falta costo unitario de materiales" };
  }
  return {
    cost: rows.reduce((sum, row, index) => sum + Number(row.quantity) * Number(costs[index]), 0),
    source: reservations.length ? "Reservas consumidas" : movements.length ? "Salidas por CECO" : "Salidas de almacén por CECO"
  };
}

function latest(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function earliest(values) {
  return values.filter(Boolean).sort()[0] ?? null;
}

function orderCompletion(dataset, order) {
  const explicit = dateOnly(order.actualDeliveryDate || order.completedAt || order.deliveryDate);
  if (explicit) return { date: explicit, estimated: false };

  const closingOperations = (dataset.operations ?? [])
    .filter((item) => item.ceco === order.ceco && /entrega|cierre|liberaci[oó]n/i.test(item.activity || ""))
    .map((item) => dateOnly(item.date));
  const documented = latest(closingOperations);
  if (documented) return { date: documented, estimated: false };

  if (Number(order.progress) >= 100 && order.dueDate) {
    return { date: dateOnly(order.dueDate), estimated: true };
  }
  return { date: null, estimated: false };
}

function orderStart(dataset, order) {
  const explicit = dateOnly(order.orderDate || order.requestDate || order.createdAt || order.plannedStartDate);
  if (explicit) return explicit;
  const candidates = [
    ...(dataset.operations ?? []).filter((item) => item.ceco === order.ceco).map((item) => item.date),
    ...(dataset.activityProgress ?? []).filter((item) => item.ceco === order.ceco).flatMap((item) => [item.startedAt, item.finishedAt]),
    ...(dataset.inventoryMovements ?? []).filter((item) => item.ceco === order.ceco).map((item) => item.timestamp),
    ...(dataset.warehouse ?? []).filter((item) => item.ceco === order.ceco).map((item) => item.timestamp)
  ].map(dateOnly);
  return earliest(candidates);
}

function previousRange(start, end) {
  const startDay = dayNumber(start);
  const endDay = dayNumber(end);
  const length = endDay - startDay + 1;
  const previousEnd = new Date((startDay - 1) * DAY_MS).toISOString().slice(0, 10);
  const previousStart = new Date((startDay - length) * DAY_MS).toISOString().slice(0, 10);
  return { start: previousStart, end: previousEnd };
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calculatePeriod(dataset, start, end) {
  const orders = dataset.orders ?? [];
  const completions = orders.map((order) => ({ order, ...orderCompletion(dataset, order) }));
  const completed = completions.filter((item) => inRange(item.date, start, end));
  const planned = orders.filter((order) => inRange(order.dueDate, start, end));
  const operations = (dataset.operations ?? []).filter((item) => inRange(item.date, start, end));
  const progressRows = (dataset.activityProgress ?? []).filter((item) => inRange(item.startedAt || item.finishedAt, start, end));
  const executedActivities = progressRows.filter((item) => item.status === "completed" || Number(item.progress) >= 100).length;
  const reportedHours = operations.reduce((sum, item) => sum + Number(item.totalHours || 0), 0);

  const leadTimes = completed.map(({ order, date, estimated }) => {
    if (estimated) return null;
    const dueDate = dateOnly(order.dueDate);
    return dueDate && date ? dayNumber(date) - dayNumber(dueDate) : null;
  }).filter((value) => value != null);

  const inventory = dataset.inventory ?? [];
  const safetyCovered = inventory.filter((item) => {
    const available = Number(item.physical || 0) - Number(item.committed || 0);
    return available >= calculateSafetyStock(item);
  }).length;

  const completedCecos = new Set(completed.map((item) => item.order.ceco));
  const costsByCeco = [...completedCecos].map((ceco) => materialConsumptionCost(dataset, ceco, start, end).cost);
  const materialCost = costsByCeco.length && costsByCeco.every((cost) => cost !== null)
    ? costsByCeco.reduce((sum, cost) => sum + cost, 0) : null;

  const hourlyRates = operations.map((item) => item.hourlyCost ?? item.laborCostPerHour);
  const laborCost = operations.length && hourlyRates.every((rate) => rate !== null && rate !== undefined && rate !== "" && Number.isFinite(Number(rate)))
    ? operations.reduce((sum, item, index) => sum + Number(item.totalHours || 0) * Number(hourlyRates[index]), 0) : null;
  const outputValues = completed.map((item) => item.order.outputValue);
  const outputValue = completed.length && outputValues.every((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    ? outputValues.reduce((sum, value) => sum + Number(value), 0) : null;
  const factorCosts = completed.flatMap((item) => [item.order.energyCost, item.order.capitalCost]);
  const otherCosts = completed.length && factorCosts.every((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    ? factorCosts.reduce((sum, value) => sum + Number(value), 0) : null;

  return {
    start,
    end,
    plannedUnits: planned.length,
    producedUnits: completed.length,
    estimatedProducedUnits: completed.filter((item) => item.estimated).length,
    pmpCompliance: round(percent(completed.length, planned.length), 1),
    executedActivities,
    programmedActivities: progressRows.length,
    progressRate: round(percent(executedActivities, progressRows.length), 1),
    averageLeadTime: leadTimes.length ? round(leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length, 1) : null,
    leadTimeSamples: leadTimes.length,
    safetyCoverage: round(percent(safetyCovered, inventory.length), 1),
    safetyCovered,
    safetyTotal: inventory.length,
    reportedHours: round(reportedHours, 1),
    laborProductivity: reportedHours > 0 ? round(completed.length / reportedHours, 3) : null,
    materialProductivity: materialCost > 0 ? round(completed.length / materialCost, 4) : null,
    materialCost: round(materialCost, 2),
    multifactorProductivity: materialCost !== null && laborCost !== null && otherCosts !== null && outputValue !== null && (materialCost + laborCost + otherCosts) > 0
      ? round(outputValue / (materialCost + laborCost + otherCosts), 3)
      : null,
    outputValue: round(outputValue, 2),
    completedOrders: completed.map((item) => ({
      ceco: item.order.ceco,
      customer: item.order.customer,
      dueDate: dateOnly(item.order.dueDate),
      completionDate: item.date,
      estimated: item.estimated
    })),
    operations
  };
}

export function availableDateRange(dataset) {
  const values = [
    ...(dataset.orders ?? []).flatMap((item) => [item.dueDate, item.orderDate, item.requestDate, item.createdAt, item.actualDeliveryDate, item.completedAt, item.deliveryDate]),
    ...(dataset.operations ?? []).map((item) => item.date),
    ...(dataset.activityProgress ?? []).flatMap((item) => [item.startedAt, item.finishedAt]),
    ...(dataset.inventoryMovements ?? []).map((item) => item.timestamp),
    ...(dataset.warehouse ?? []).map((item) => item.timestamp)
  ].map(dateOnly).filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  return { start: values[0] ?? today, end: values.at(-1) ?? today };
}

export function calculateProductivityReport(dataset, start, end) {
  const validStart = dateOnly(start);
  const validEnd = dateOnly(end);
  if (!validStart || !validEnd || validStart > validEnd) throw new Error("El rango de fechas no es válido.");
  const previous = previousRange(validStart, validEnd);
  return {
    current: calculatePeriod(dataset, validStart, validEnd),
    previous: calculatePeriod(dataset, previous.start, previous.end)
  };
}

export function buildIndicatorSeries(dataset, start, end, grouping = "month") {
  const validStart = dateOnly(start);
  const validEnd = dateOnly(end);
  if (!validStart || !validEnd || validStart > validEnd) return [];
  const buckets = [];
  let cursor = validStart;
  while (cursor <= validEnd) {
    let bucketEnd;
    if (grouping === "week") {
      bucketEnd = addUtcDays(cursor, 6);
    } else {
      const date = new Date(`${cursor}T12:00:00Z`);
      bucketEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    }
    if (bucketEnd > validEnd) bucketEnd = validEnd;
    const report = calculateProductivityReport(dataset, cursor, bucketEnd).current;
    buckets.push({
      label: grouping === "month"
        ? new Intl.DateTimeFormat("es-PE", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${cursor}T12:00:00Z`))
        : `${cursor.slice(5)}–${bucketEnd.slice(5)}`,
      ...report
    });
    cursor = addUtcDays(bucketEnd, 1);
  }
  return buckets;
}

function xmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function excelCell(value, type = "String", style = "") {
  const styleAttr = style ? ` ss:StyleID="${style}"` : "";
  return `<Cell${styleAttr}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function worksheet(name, rows) {
  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map((row) => `<Row>${row.join("")}</Row>`).join("")}</Table></Worksheet>`;
}

export function buildExcelReport(report) {
  const { current, previous } = report;
  const metrics = [
    ["Cumplimiento PMP", current.pmpCompliance, previous.pmpCompliance, "%", "Unidades producidas / unidades planificadas x 100"],
    ["Nivel de avance", current.progressRate, previous.progressRate, "%", "Actividades ejecutadas / actividades programadas x 100"],
    ["Retraso promedio de entrega", current.averageLeadTime, previous.averageLeadTime, "días", "Fecha real de entrega - fecha pactada"],
    ["Cobertura de stock de seguridad", current.safetyCoverage, previous.safetyCoverage, "%", "Materiales con disponible mayor o igual al SS"],
    ["Productividad de mano de obra", current.laborProductivity, previous.laborProductivity, "unidades/HH", "Unidades producidas / horas-hombre"],
    ["Productividad de materiales", current.materialProductivity, previous.materialProductivity, "unidades/S/", "Unidades producidas / costo de materiales e insumos"],
    ["Productividad multifactorial", current.multifactorProductivity, previous.multifactorProductivity, "ratio", "Valor de salida / factores de producción" ]
  ];
  const summaryRows = [
    [excelCell("REPORTE DE INDICADORES PRODUCTIVOS", "String", "Title")],
    [excelCell("Periodo"), excelCell(`${current.start} a ${current.end}`)],
    [excelCell("Indicador", "String", "Header"), excelCell("Periodo actual", "String", "Header"), excelCell("Periodo anterior", "String", "Header"), excelCell("Unidad", "String", "Header"), excelCell("Fórmula / criterio", "String", "Header")],
    ...metrics.map(([name, value, prior, unit, formula]) => [excelCell(name), excelCell(value ?? "Sin datos", value == null ? "String" : "Number"), excelCell(prior ?? "Sin datos", prior == null ? "String" : "Number"), excelCell(unit), excelCell(formula)])
  ];
  const orderRows = [
    [excelCell("CECO", "String", "Header"), excelCell("Cliente", "String", "Header"), excelCell("Fecha pactada", "String", "Header"), excelCell("Fecha final", "String", "Header"), excelCell("Calidad del dato", "String", "Header")],
    ...current.completedOrders.map((item) => [excelCell(item.ceco), excelCell(item.customer), excelCell(item.dueDate), excelCell(item.completionDate), excelCell(item.estimated ? "Inferida por fecha pactada" : "Documentada")])
  ];
  const operationRows = [
    [excelCell("Fecha", "String", "Header"), excelCell("CECO", "String", "Header"), excelCell("Trabajador", "String", "Header"), excelCell("Actividad", "String", "Header"), excelCell("Horas", "String", "Header")],
    ...current.operations.map((item) => [excelCell(item.date), excelCell(item.ceco), excelCell(item.worker), excelCell(item.activity), excelCell(Number(item.totalHours || 0), "Number")])
  ];
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14" ss:Color="#F36B21"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#172033" ss:Pattern="Solid"/></Style></Styles>${worksheet("Indicadores", summaryRows)}${worksheet("Órdenes terminadas", orderRows)}${worksheet("Horas reportadas", operationRows)}</Workbook>`;
}
