import { calculateSafetyStock } from "./mrp.js";

const DAY = 86400000;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateId(date) {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(value, days) {
  const date = parseDate(value);
  return date ? dateId(new Date(date.getTime() + days * DAY)) : null;
}

export function weekStart(value) {
  const date = parseDate(value);
  if (!date) return null;
  return dateId(new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY));
}

export function planningWeeks(today, count = 8) {
  const first = weekStart(today);
  return Array.from({ length: count }, (_, index) => {
    const start = shiftDate(first, index * 7);
    return { start, end: shiftDate(start, 6) };
  });
}

export function orderStart(order, product) {
  return order.plannedStartDate || shiftDate(order.dueDate, -Math.max(0, Number(product?.targetDays || 1) - 1));
}

export function materialOrderLinks(dataset) {
  const result = new Map();
  const products = new Map((dataset.bodyTypes || []).map((product) => [product.id, product]));
  for (const order of dataset.orders || []) {
    if (order.active === false || Number(order.progress) >= 100) continue;
    const product = products.get(order.bodyTypeId);
    for (const piece of dataset.bom || []) {
      if (piece.bodyTypeId !== order.bodyTypeId) continue;
      const rows = result.get(piece.materialCode) || new Map();
      const current = rows.get(order.ceco) || { ceco: order.ceco, product: product?.name || "Producto", quantity: 0, needed: orderStart(order, product) || order.dueDate };
      current.quantity += Number(piece.quantity || 0);
      rows.set(order.ceco, current);
      result.set(piece.materialCode, rows);
    }
  }
  return new Map([...result].map(([code, rows]) => [code, [...rows.values()].sort((a, b) => String(a.needed || "").localeCompare(String(b.needed || "")))]));
}

function weekIndex(date, weeks) {
  if (!date) return null;
  const first = weeks[0]?.start;
  if (date < first) return 0;
  const index = Math.floor((parseDate(date) - parseDate(first)) / (7 * DAY));
  return index < weeks.length ? index : null;
}

export function buildProductionPlan(dataset, today, count = 8) {
  const weeks = planningWeeks(today, count);
  const orders = (dataset.orders || []).filter((order) => order.active !== false && Number(order.progress) < 100);
  const products = new Map((dataset.bodyTypes || []).map((product) => [product.id, product]));
  const rows = orders.map((order) => {
    const product = products.get(order.bodyTypeId);
    return { order, product, start: orderStart(order, product), delivery: order.dueDate, week: weekIndex(order.dueDate, weeks) };
  });
  const overdue = rows.filter((row) => row.delivery && row.delivery < weeks[0].start);
  const outside = rows.filter((row) => row.week === null);
  const capacity = weeks.map((week, index) => {
    const scheduled = rows.filter((row) => row.week === index);
    const required = scheduled.reduce((sum, row) => sum + (row.product?.route || []).reduce((hours, stageId) => hours + Number(dataset.flowStages?.find((stage) => stage.id === stageId)?.standardHours || 0), 0), 0);
    const available = (dataset.flowStages || []).reduce((sum, stage) => sum + Number(stage.capacityHours || 0), 0);
    return { required, available, utilization: available ? Math.round(required / available * 100) : 0 };
  });
  return { weeks, rows, overdue, outside, capacity };
}

export function buildMaterialPlan(dataset, today, count = 8) {
  const weeks = planningWeeks(today, count);
  const products = new Map((dataset.bodyTypes || []).map((product) => [product.id, product]));
  const demand = new Map();
  const requirements = new Map();
  for (const order of dataset.orders || []) {
    if (order.active === false || Number(order.progress) >= 100) continue;
    const needed = orderStart(order, products.get(order.bodyTypeId)) || order.dueDate;
    const index = weekIndex(needed, weeks);
    if (index === null) continue;
    for (const piece of dataset.bom || []) {
      if (piece.bodyTypeId !== order.bodyTypeId) continue;
      const key = `${piece.materialCode}:${index}`;
      const entry = demand.get(key) || { quantity: 0, cecos: new Set(), overdue: false, needed: null };
      entry.quantity += Number(piece.quantity || 0);
      entry.cecos.add(order.ceco);
      entry.overdue ||= needed < weeks[0].start;
      if (!entry.needed || needed < entry.needed) entry.needed = needed;
      demand.set(key, entry);
      const orderKey = `${piece.materialCode}:${order.ceco}`;
      const requirement = requirements.get(orderKey) || { code: piece.materialCode, ceco: order.ceco, product: products.get(order.bodyTypeId)?.name || "Producto", quantity: 0, needed, week: weeks[index] };
      requirement.quantity += Number(piece.quantity || 0);
      requirements.set(orderKey, requirement);
    }
  }
  const rows = (dataset.inventory || []).map((material) => {
    const safety = calculateSafetyStock(material);
    const leadTime = Math.max(0, Number(material.leadTimeDays || 0));
    let balance = Number(material.physical || 0);
    const cells = weeks.map((week, index) => {
      const needed = demand.get(`${material.code}:${index}`) || { quantity: 0, cecos: new Set(), overdue: false, needed: null };
      const opening = balance;
      const afterDemand = opening - needed.quantity;
      const net = Math.max(0, safety - afterDemand);
      const receipt = net ? Math.ceil(net) : 0;
      balance = afterDemand + receipt;
      return { week, opening, gross: needed.quantity, afterDemand, net, receipt, closing: balance, cecos: [...needed.cecos], overdue: needed.overdue,
        needed: needed.needed || week.start, orderBy: receipt ? shiftDate(needed.needed || week.start, -leadTime) : null };
    });
    return { material, safety, leadTime, cells, orders: [...requirements.values()].filter((item) => item.code === material.code).sort((a, b) => a.needed.localeCompare(b.needed) || a.ceco.localeCompare(b.ceco)), totalGross: cells.reduce((sum, cell) => sum + cell.gross, 0), totalSuggested: cells.reduce((sum, cell) => sum + cell.receipt, 0) };
  });
  const purchases = rows.flatMap((row) => row.cells.filter((cell) => cell.receipt > 0).map((cell) => ({
    code: row.material.code, material: row.material, quantity: cell.receipt, unit: row.material.unit,
    orderBy: cell.orderBy, needed: cell.needed, leadTime: row.leadTime, cecos: cell.cecos,
    gross: cell.gross, opening: cell.opening, safety: row.safety, afterDemand: cell.afterDemand
  }))).sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.code.localeCompare(b.code));
  return { weeks, rows, purchases };
}
