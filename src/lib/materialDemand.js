function dateOnly(value) {
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function dayNumber(value) {
  const date = dateOnly(value);
  if (!date) return null;
  const day = Date.parse(`${date}T12:00:00Z`) / 86400000;
  return Number.isFinite(day) ? day : null;
}

function addDaily(target, code, date, quantity, start, end) {
  const day = dayNumber(date);
  if (!code || day === null || day < start || day > end || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return;
  const daily = target.get(code) ?? new Map();
  daily.set(day, (daily.get(day) ?? 0) + Number(quantity));
  target.set(code, daily);
}

function summarize(daily, days, source) {
  const total = [...daily.values()].reduce((sum, value) => sum + value, 0);
  const averageDemand = total / days;
  const sumSquares = [...daily.values()].reduce((sum, value) => sum + (value - averageDemand) ** 2, 0)
    + (days - daily.size) * averageDemand ** 2;
  return {
    averageDemand: Number(averageDemand.toFixed(4)),
    demandStdDev: days > 1 ? Number(Math.sqrt(sumSquares / (days - 1)).toFixed(4)) : null,
    observations: daily.size,
    days,
    source
  };
}

export function deriveMaterialDemand(dataset, range) {
  const start = dayNumber(range.start);
  const end = dayNumber(range.end);
  if (start === null || end === null || end < start) return new Map();
  const days = end - start + 1;
  const fromMovements = new Map();
  for (const row of dataset.inventoryMovements ?? []) {
    if (row.type === "salida") addDaily(fromMovements, row.code, row.timestamp, row.quantity, start, end);
  }
  const withIssues = new Set(fromMovements.keys());
  for (const row of dataset.inventoryMovements ?? []) {
    if (row.type === "consumo" && !withIssues.has(row.code)) {
      addDaily(fromMovements, row.code, row.timestamp, row.quantity, start, end);
    }
  }
  const fromWarehouse = new Map();
  for (const row of dataset.warehouse ?? []) {
    addDaily(fromWarehouse, row.materialCode, row.timestamp, row.quantity, start, end);
  }
  const fromCecos = new Map();
  const bomByProduct = new Map();
  for (const row of dataset.bom ?? []) {
    const rows = bomByProduct.get(row.bodyTypeId) ?? [];
    rows.push(row);
    bomByProduct.set(row.bodyTypeId, rows);
  }
  for (const order of dataset.orders ?? []) {
    const date = order.plannedStartDate ?? order.dueDate;
    for (const piece of bomByProduct.get(order.bodyTypeId) ?? []) {
      addDaily(fromCecos, piece.materialCode, date, piece.quantity, start, end);
    }
  }
  const result = new Map();
  for (const code of new Set([...fromMovements.keys(), ...fromWarehouse.keys(), ...fromCecos.keys()])) {
    const daily = fromMovements.get(code) ?? fromWarehouse.get(code) ?? fromCecos.get(code);
    const source = fromMovements.has(code) ? "salidas/consumos registrados" : fromWarehouse.has(code) ? "salidas de almacén" : "demanda planificada CECO/BOM";
    result.set(code, summarize(daily, days, source));
  }
  return result;
}
