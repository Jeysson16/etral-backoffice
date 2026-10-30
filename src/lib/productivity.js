import { calculateCecoProgress, calculateSafetyStock } from "./mrp.js";

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

export function activityProgressDate(row) {
  return row.status === "completed" || Number(row.progress) >= 100
    ? row.finishedAt || row.startedAt
    : row.startedAt || row.finishedAt;
}

function percent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const validNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function cecoProductivityInput(order) {
  if (![order?.outputWeightKg, order?.reportedLaborHours, order?.laborHourCostPen,
    order?.rawMaterialCostPen, order?.suppliesCostPen, order?.outputValue, order?.capitalCost].every(validNumber)) return null;
  const weightKg = Number(order.outputWeightKg);
  const hours = Number(order.reportedLaborHours);
  const hourlyCost = Number(order.laborHourCostPen);
  const rawMaterialCost = Number(order.rawMaterialCostPen);
  const suppliesCost = Number(order.suppliesCostPen);
  const materialCost = rawMaterialCost + suppliesCost;
  const laborCost = hours * hourlyCost;
  const energyCost = validNumber(order.energyCost) ? Number(order.energyCost) : 0;
  const capitalCost = Number(order.capitalCost);
  const denominator = laborCost + energyCost + capitalCost;
  if (weightKg <= 0 || hours <= 0 || materialCost <= 0 || denominator <= 0) return null;
  return { ceco: order.ceco, weightKg, workers: validNumber(order.reportedWorkerCount) ? Number(order.reportedWorkerCount) : null,
    hours, hourlyCost, rawMaterialCost, suppliesCost, materialCost, laborCost, energyCost, capitalCost,
    outputValue: Number(order.outputValue), laborProductivity: weightKg / hours,
    materialProductivity: weightKg / materialCost, multifactorProductivity: Number(order.outputValue) / denominator };
}

const workerKey = (value) => String(value ?? "").trim().toLocaleLowerCase("es");

export function materialConsumptionCost(dataset, ceco, start, end, { includePartialStages = false } = {}) {
  const reservations = (dataset.orderMaterialReservations ?? []).filter((row) => row.ceco === ceco && Number(row.consumedQuantity) > 0);
  const movements = (dataset.inventoryMovements ?? []).filter((row) => row.ceco === ceco && ["salida", "consumo"].includes(row.type) && inRange(row.timestamp, start, end));
  const warehouse = (dataset.warehouse ?? []).filter((row) => row.ceco === ceco && inRange(row.timestamp ?? row.date, start, end));
  const sources = [
    ["Reservas consumidas", reservations.map((row) => ({ code: row.materialCode, quantity: row.consumedQuantity }))],
    ["Salidas por CECO", movements.filter((row) => row.type === "salida").map((row) => ({ code: row.code, quantity: row.quantity }))],
    ["Consumos por CECO", movements.filter((row) => row.type === "consumo").map((row) => ({ code: row.code, quantity: row.quantity }))],
    ["Salidas de almacén por CECO", warehouse.map((row) => ({ code: row.materialCode, quantity: row.quantity }))]
  ];
  const selected = new Map();
  for (const [source, entries] of sources) {
    for (const row of entries) {
      if (!row.code || selected.has(row.code)) continue;
      selected.set(row.code, { source, rows: entries.filter((item) => item.code === row.code) });
    }
  }
  // Una fase cerrada acredita el requerimiento BOM de esa fase. Si además hay
  // salidas explícitas, solo se estima la cantidad restante para no duplicarla.
  const order = (dataset.orders ?? []).find((item) => item.ceco === ceco);
  const completedActivities = new Set((dataset.activityProgress ?? [])
    .filter((item) => item.ceco === ceco && (item.status === "completed" || Number(item.progress) >= 100))
    .map((item) => item.activityId));
  const stageShares = includePartialStages && order
    ? new Map(calculateCecoProgress(order, dataset.bodyTypes ?? [], dataset.stageActivities ?? [], dataset.activityProgress ?? [])
      .stages.map((item) => [item.stageId, Math.min(1, Math.max(0, item.progress / 100))]))
    : null;
  const stageCompleted = (stageId) => {
    if (order && orderCompletion(dataset, order).date) return true;
    const activities = (dataset.stageActivities ?? []).filter((item) => item.stageId === stageId && item.active !== false);
    return activities.length > 0 && activities.every((item) => completedActivities.has(item.id));
  };
  const requirements = new Map();
  for (const row of dataset.orderMaterialReservations ?? []) {
    if (row.ceco !== ceco || !row.materialCode) continue;
    const share = stageShares ? stageShares.get(row.stageId) ?? 0 : stageCompleted(row.stageId) ? 1 : 0;
    if (share <= 0) continue;
    requirements.set(row.materialCode, (requirements.get(row.materialCode) ?? 0) + Number(row.requiredQuantity || 0) * share);
  }
  let estimatedQuantity = 0;
  for (const [code, required] of requirements) {
    const recorded = selected.get(code)?.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0) ?? 0;
    const remainder = Math.max(0, required - recorded);
    if (remainder > 0) {
      selected.set(code, { source: selected.has(code) ? `${selected.get(code).source} + avance de fase/BOM` : "Avance de fase/BOM (estimado)", rows: [...(selected.get(code)?.rows ?? []), { code, quantity: remainder }] });
      estimatedQuantity += remainder;
    }
  }
  const rows = [...selected.values()].flatMap((item) => item.rows);
  const quantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  if (!rows.length) return { cost: null, quantity: 0, estimatedQuantity: 0, source: "Sin material vinculado al avance del CECO", reason: "missing_consumption" };
  const inventory = new Map((dataset.inventory ?? []).map((item) => [item.code, item]));
  const costs = rows.map((row) => inventory.get(row.code)?.unitCost);
  const source = [...new Set([...selected.values()].map((item) => item.source))].join(" + ");
  const estimatedPrices = rows.some((row) => String(inventory.get(row.code)?.unitCostBasis ?? "").toLowerCase().startsWith("estimado"));
  if (costs.some((value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) || Number(value) <= 0)) {
    return { cost: null, quantity, estimatedQuantity, source: `${source}; falta costo unitario`, reason: "missing_unit_cost" };
  }
  return {
    cost: rows.reduce((sum, row, index) => sum + Number(row.quantity) * Number(costs[index]), 0),
    quantity, estimatedQuantity, estimatedPrices, source,
    reason: null
  };
}

export function buildLiveProductivity(dataset, asOf) {
  const weightByProduct = new Map();
  for (const order of dataset.orders ?? []) {
    if (Number(order.progress) < 100 || !validNumber(order.outputWeightKg)) continue;
    const weights = weightByProduct.get(order.bodyTypeId) ?? [];
    weights.push(Number(order.outputWeightKg));
    weightByProduct.set(order.bodyTypeId, weights);
  }
  const personnelRates = new Map((dataset.personnel ?? []).map((person) => [workerKey(person.name), person.hourlyCost]));
  return (dataset.orders ?? []).filter((order) => order.active !== false && Number(order.progress) < 100)
    .map((order) => {
      const calculated = calculateCecoProgress(order, dataset.bodyTypes ?? [], dataset.stageActivities ?? [], dataset.activityProgress ?? []);
      const progress = calculated.stages.length ? calculated.progress : Number(order.progress || 0);
      if (progress <= 0) return null;
      const hasDirectWeight = validNumber(order.outputWeightKg) && Number(order.outputWeightKg) > 0;
      const referenceWeight = hasDirectWeight ? Number(order.outputWeightKg) : mean(weightByProduct.get(order.bodyTypeId) ?? []);
      const equivalentWeightKg = referenceWeight === null ? null : referenceWeight * progress / 100;
      const logs = (dataset.operations ?? []).filter((item) => item.ceco === order.ceco && dateOnly(item.date) <= asOf);
      const hours = logs.reduce((sum, item) => sum + Number(item.totalHours || 0), 0);
      const costs = logs.map((item) => item.hourlyCost ?? item.laborCostPerHour ?? personnelRates.get(workerKey(item.worker)) ?? order.laborHourCostPen);
      const laborCost = hours > 0 && costs.every(validNumber)
        ? logs.reduce((sum, item, index) => sum + Number(item.totalHours || 0) * Number(costs[index]), 0) : null;
      const material = materialConsumptionCost(dataset, order.ceco, "0001-01-01", asOf, { includePartialStages: true });
      const materialCost = material.cost;
      const valueShare = validNumber(order.outputValue) ? Number(order.outputValue) * progress / 100 : null;
      const energyShare = validNumber(order.energyCost) ? Number(order.energyCost) * progress / 100 : 0;
      const denominator = laborCost !== null && materialCost !== null ? laborCost + materialCost + energyShare : null;
      return {
        ceco: order.ceco, bodyTypeId: order.bodyTypeId, progress, equivalentWeightKg,
        weightEstimated: !hasDirectWeight, hours, laborCost,
        materialCost, materialQuantityEstimated: material.estimatedQuantity > 0,
        materialPricesEstimated: Boolean(material.estimatedPrices), materialSource: material.source,
        valueShare, laborProductivity: equivalentWeightKg !== null && hours > 0 ? equivalentWeightKg / hours : null,
        materialProductivity: equivalentWeightKg !== null && materialCost > 0 ? equivalentWeightKg / materialCost : null,
        multifactorProductivity: valueShare !== null && denominator > 0 ? valueShare / denominator : null
      };
    }).filter(Boolean);
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
  const progressRows = (dataset.activityProgress ?? []).filter((item) => inRange(activityProgressDate(item), start, end));
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
  const completedOperations = operations.filter((item) => completedCecos.has(item.ceco));
  const materialCostsByCeco = [...completedCecos].map((ceco) => materialConsumptionCost(dataset, ceco, start, end));
  const hasEstimatedMaterialUsage = materialCostsByCeco.some((item) => (item.estimatedQuantity ?? 0) > 0);
  const estimatedMaterialPrices = materialCostsByCeco.some((item) => item.estimatedPrices);
  const materialCost = materialCostsByCeco.length && materialCostsByCeco.every((item) => item.cost !== null)
    ? materialCostsByCeco.reduce((sum, item) => sum + item.cost, 0) : null;
  const materialCostReason = !completedCecos.size ? "no_completed_ceco"
    : materialCostsByCeco.some((item) => item.reason === "missing_consumption") ? "missing_consumption"
      : materialCostsByCeco.some((item) => item.reason === "missing_unit_cost") ? "missing_unit_cost" : null;

  const personnelRates = new Map((dataset.personnel ?? []).map((person) => [workerKey(person.name), person.hourlyCost]));
  const estimatedLaborRates = completedOperations.some((item) => String((dataset.personnel ?? []).find((person) => workerKey(person.name) === workerKey(item.worker))?.hourlyCostBasis ?? "").toLowerCase().startsWith("estimado"));
  const hourlyRates = completedOperations.map((item) => item.hourlyCost ?? item.laborCostPerHour ?? personnelRates.get(workerKey(item.worker)));
  const laborCost = completedOperations.length && hourlyRates.every((rate) => rate !== null && rate !== undefined && rate !== "" && Number.isFinite(Number(rate)))
    ? completedOperations.reduce((sum, item, index) => sum + Number(item.totalHours || 0) * Number(hourlyRates[index]), 0) : null;
  const outputValues = completed.map((item) => item.order.outputValue);
  const outputValue = completed.length && outputValues.every((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    ? outputValues.reduce((sum, value) => sum + Number(value), 0) : null;
  const factorCosts = completed.flatMap((item) => [item.order.energyCost, item.order.capitalCost]);
  const estimatedOrderValues = completed.some((item) => String(item.order.outputValueBasis ?? "").toLowerCase().startsWith("estimado"));
  const otherCosts = completed.length && factorCosts.every((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))
    ? factorCosts.reduce((sum, value) => sum + Number(value), 0) : null;

  const cecoMeasurements = completed.map(({ order }) => cecoProductivityInput(order));
  const thesisMode = completed.length > 0 && cecoMeasurements.every(Boolean);
  const measuredHours = thesisMode ? cecoMeasurements.reduce((sum, row) => sum + row.hours, 0) : reportedHours;
  const measuredMaterials = thesisMode ? cecoMeasurements.reduce((sum, row) => sum + row.materialCost, 0) : materialCost;
  const measuredLabor = thesisMode ? cecoMeasurements.reduce((sum, row) => sum + row.laborCost, 0) : laborCost;
  const measuredOutput = thesisMode ? cecoMeasurements.reduce((sum, row) => sum + row.outputValue, 0) : outputValue;
  const measuredOther = thesisMode ? cecoMeasurements.reduce((sum, row) => sum + row.energyCost + row.capitalCost, 0) : otherCosts;

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
    reportedHours: round(measuredHours, 2),
    producedWeightKg: thesisMode ? round(cecoMeasurements.reduce((sum, row) => sum + row.weightKg, 0), 2) : null,
    measurementMode: thesisMode ? "weight" : "units",
    cecoMeasurements: thesisMode ? cecoMeasurements : [],
    laborProductivity: thesisMode ? round(mean(cecoMeasurements.map((row) => row.laborProductivity)), 3) : reportedHours > 0 ? round(completed.length / reportedHours, 3) : null,
    materialProductivity: thesisMode ? round(mean(cecoMeasurements.map((row) => row.materialProductivity)), 4) : materialCost > 0 ? round(completed.length / materialCost, 4) : null,
    materialCost: round(measuredMaterials, 2),
    materialCostReason: thesisMode ? null : materialCostReason,
    hasEstimatedMaterialUsage: thesisMode ? false : hasEstimatedMaterialUsage,
    estimatedMaterialPrices: thesisMode ? false : estimatedMaterialPrices,
    estimatedMonetaryInputs: thesisMode ? false : estimatedMaterialPrices || estimatedLaborRates || estimatedOrderValues,
    completedCecoCount: completedCecos.size,
    laborCost: round(measuredLabor, 2),
    otherCosts: round(measuredOther, 2),
    multifactorProductivity: thesisMode ? round(mean(cecoMeasurements.map((row) => row.multifactorProductivity)), 3)
      : materialCost !== null && laborCost !== null && outputValue !== null && (materialCost + laborCost) > 0
      ? round(outputValue / (materialCost + laborCost), 3)
      : null,
    outputValue: round(measuredOutput, 2),
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
    ["Productividad multifactorial", current.multifactorProductivity, previous.multifactorProductivity, "ratio", "Valor producido / (mano de obra + materiales)" ]
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
