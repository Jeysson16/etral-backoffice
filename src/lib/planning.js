import { calculateSafetyStock } from "./mrp.js";
import { pendingMaterialQuantity } from "./pendingMaterials.js";

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
      const quantity = pendingMaterialQuantity(dataset, order, piece);
      if (!quantity) continue;
      const rows = result.get(piece.materialCode) || new Map();
      const current = rows.get(order.ceco) || { ceco: order.ceco, product: product?.name || "Producto", quantity: 0, needed: orderStart(order, product) || order.dueDate };
      current.quantity += quantity;
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
  const overdue = rows.filter((row) => row.delivery && row.delivery < today);
  const outside = rows.filter((row) => row.week === null);
  const capacity = weeks.map((week, index) => {
    const scheduled = rows.filter((row) => row.week === index);
    const required = scheduled.reduce((sum, row) => sum + (row.product?.route || []).reduce((hours, stageId) => hours + Number(dataset.flowStages?.find((stage) => stage.id === stageId)?.standardHours || 0), 0), 0);
    const available = (dataset.flowStages || []).reduce((sum, stage) => sum + Number(stage.capacityHours || 0), 0);
    return { required, available, utilization: available ? Math.round(required / available * 100) : 0 };
  });
  return { weeks, rows, overdue, outside, capacity };
}

export function buildPmpPeriod(dataset, startMonth, endMonth, dateBasis = "start") {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth) || startMonth > endMonth) {
    return { months: [], products: dataset.bodyTypes || [], orders: [], overlapping: [], totals: [] };
  }
  const months = [];
  const start = new Date(`${startMonth}-01T12:00:00Z`);
  const end = new Date(`${endMonth}-01T12:00:00Z`);
  for (let date = start; date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) months.push(date.toISOString().slice(0, 7));
  const products = dataset.bodyTypes || [];
  const byProduct = new Map(products.map((product) => [product.id, product]));
  const all = (dataset.orders || []).map((order) => {
    const product = byProduct.get(order.bodyTypeId);
    const plannedStart = orderStart(order, product);
    const date = dateBasis === "due" ? order.dueDate : plannedStart;
    return { order, product, plannedStart, month: date?.slice(0, 7) || null };
  });
  const orders = all.filter((row) => row.month && row.month >= startMonth && row.month <= endMonth);
  const periodStart = `${startMonth}-01`;
  const periodEnd = shiftDate(`${endMonth}-01`, new Date(Date.UTC(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)), 0)).getUTCDate() - 1);
  const overlapping = all.filter((row) => row.plannedStart && row.plannedStart <= periodEnd && (!row.order.dueDate || row.order.dueDate >= periodStart))
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart) || a.order.ceco.localeCompare(b.order.ceco));
  return { months, products, orders, overlapping, totals: months.map((month) => orders.filter((row) => row.month === month).length) };
}

export function buildPmpCalendar(rows, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const first = `${month}-01`;
  const firstDay = parseDate(first);
  if (!firstDay) return [];
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = shiftDate(first, index - offset);
    const inMonth = date.slice(0, 7) === month;
    return { date, inMonth, rows: inMonth ? rows.filter((row) => row.plannedStart <= date && (!row.order.dueDate || row.order.dueDate >= date)) : [] };
  });
}

export function buildMaterialPlan(dataset, today, count = 8) {
  const weeks = planningWeeks(today, count);
  const products = new Map((dataset.bodyTypes || []).map((product) => [product.id, product]));
  const demand = new Map();
  const requirements = new Map();
  for (const order of dataset.orders || []) {
    if (order.active === false || Number(order.progress) >= 100) continue;
    const originalNeeded = orderStart(order, products.get(order.bodyTypeId)) || order.dueDate || null;
    const needed = originalNeeded && originalNeeded > today ? originalNeeded : today;
    const index = weekIndex(needed, weeks);
    if (index === null) continue;
    for (const piece of dataset.bom || []) {
      if (piece.bodyTypeId !== order.bodyTypeId) continue;
      const quantity = pendingMaterialQuantity(dataset, order, piece);
      if (!quantity) continue;
      const key = `${piece.materialCode}:${index}`;
      const entry = demand.get(key) || { quantity: 0, cecos: new Set(), overdue: false, needed: null, originalNeeded: null };
      entry.quantity += quantity;
      entry.cecos.add(order.ceco);
      entry.overdue ||= Boolean(originalNeeded && originalNeeded < today);
      if (!entry.needed || needed < entry.needed) entry.needed = needed;
      if (originalNeeded && (!entry.originalNeeded || originalNeeded < entry.originalNeeded)) entry.originalNeeded = originalNeeded;
      demand.set(key, entry);
      const orderKey = `${piece.materialCode}:${order.ceco}`;
      const requirement = requirements.get(orderKey) || { code: piece.materialCode, ceco: order.ceco, product: products.get(order.bodyTypeId)?.name || "Producto", quantity: 0, needed, originalNeeded, overdue: Boolean(originalNeeded && originalNeeded < today), progress: Number(order.progress || 0), week: weeks[index] };
      requirement.quantity += quantity;
      requirements.set(orderKey, requirement);
    }
  }
  const rows = (dataset.inventory || []).map((material) => {
    const safety = calculateSafetyStock(material);
    const enteredLeadTime = Number(material.leadTimeDays);
    const leadTime = material.leadTimeDays != null && Number.isFinite(enteredLeadTime) && enteredLeadTime > 0 ? enteredLeadTime : null;
    let balance = Number(material.physical || 0);
    const scheduled = new Map();
    let beyondHorizon = 0;
    const pendingRequests = (dataset.purchaseRequests || []).filter((request) => request.material_code === material.code && ["requested", "ordered"].includes(request.status));
    for (const request of pendingRequests) {
      const remaining = Math.max(0, Number(request.quantity) - Number(request.received_quantity || 0));
      const arrivalIndex = request.status === "ordered" && request.expected_date >= today ? weekIndex(request.expected_date, weeks) : null;
      if (arrivalIndex === null) beyondHorizon += remaining;
      else scheduled.set(arrivalIndex, (scheduled.get(arrivalIndex) || 0) + remaining);
    }
    const suggestions = [];
    const cells = weeks.map((week, index) => {
      const needed = demand.get(`${material.code}:${index}`) || { quantity: 0, cecos: new Set(), overdue: false, needed: null, originalNeeded: null };
      const opening = balance;
      const afterDemand = opening - needed.quantity;
      let receipt = scheduled.get(index) || 0;
      const outstanding = beyondHorizon + [...scheduled].reduce((sum, [weekIndex, quantity]) => sum + (weekIndex > index ? quantity : 0), 0);
      const net = Math.max(0, safety - afterDemand - receipt - outstanding);
      const suggestedOrder = net ? Math.ceil(net) : 0;
      const targetDate = needed.needed || (index === 0 ? today : week.start);
      const plannedOrderDate = leadTime == null ? null : shiftDate(targetDate, -leadTime);
      const orderBy = suggestedOrder ? (plannedOrderDate && plannedOrderDate > today ? plannedOrderDate : today) : null;
      const arrivalDate = suggestedOrder && leadTime != null ? shiftDate(orderBy, leadTime) : null;
      if (suggestedOrder) {
        const arrivalWeek = arrivalDate ? weekIndex(arrivalDate, weeks) : null;
        if (arrivalWeek === index) receipt += suggestedOrder;
        else if (arrivalWeek !== null) scheduled.set(arrivalWeek, (scheduled.get(arrivalWeek) || 0) + suggestedOrder);
        else beyondHorizon += suggestedOrder;
        suggestions.push({ code: material.code, material, quantity: suggestedOrder, unit: material.unit,
          orderBy, needed: targetDate, originalNeeded: needed.originalNeeded, arrivalDate, leadTime,
          cecos: [...needed.cecos], gross: needed.quantity, opening, safety, afterDemand,
          overdue: needed.overdue, cannotMeetNeed: arrivalDate == null || arrivalDate > targetDate });
      }
      balance = afterDemand + receipt;
      return { week, opening, gross: needed.quantity, afterDemand, net, suggestedOrder, receipt, closing: balance,
        cecos: [...needed.cecos], overdue: needed.overdue, needed: targetDate, originalNeeded: needed.originalNeeded, orderBy, arrivalDate };
    });
    return { material, safety, leadTime, cells, suggestions, pendingSupply: pendingRequests.reduce((sum, request) => sum + Math.max(0, Number(request.quantity) - Number(request.received_quantity || 0)), 0),
      orders: [...requirements.values()].filter((item) => item.code === material.code).sort((a, b) => a.needed.localeCompare(b.needed) || a.ceco.localeCompare(b.ceco)),
      totalGross: cells.reduce((sum, cell) => sum + cell.gross, 0), totalSuggested: suggestions.reduce((sum, item) => sum + item.quantity, 0) };
  });
  const purchases = rows.flatMap((row) => row.suggestions)
    .sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.code.localeCompare(b.code));
  return { weeks, rows, purchases };
}
