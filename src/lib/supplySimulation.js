import { materialOrderLinks, shiftDate } from './planning.js';
import { calculateSafetyStock } from './mrp.js';

const round = (value) => Math.round(Math.max(0, value) * 1000) / 1000;
const dateValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
export const pendingPurchases = (dataset) => (dataset.purchaseRequests || []).filter((row) => ['requested', 'ordered'].includes(row.status) && Number(row.quantity) > Number(row.received_quantity || 0));

export function simulateSupply(dataset, { startDate, horizonDays = 30, deliveries = {}, stockAdjustments = {} } = {}) {
  if (!dateValid(startDate)) throw new Error('Selecciona una fecha válida de inicio.');
  if (!Number.isInteger(Number(horizonDays)) || horizonDays < 1 || horizonDays > 180) throw new Error('El horizonte debe ser de 1 a 180 días.');
  const endDate = shiftDate(startDate, Number(horizonDays) - 1);
  const links = materialOrderLinks(dataset);
  const purchases = pendingPurchases(dataset).map((purchase) => {
    const change = deliveries[purchase.id];
    const remaining = round(Number(purchase.quantity) - Number(purchase.received_quantity || 0));
    const percent = Number(change?.percent ?? 100);
    if (change?.quantity === '') throw new Error(`${purchase.material_code}: indica la cantidad que llega.`);
    const exactQuantity = change?.quantity == null ? null : Number(change.quantity);
    const delay = Number(change?.delayDays ?? 0);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isInteger(delay) || delay < 0) throw new Error('Usa una entrega de 0 a 100% y días de retraso enteros, desde cero.');
    if (exactQuantity !== null && (!Number.isFinite(exactQuantity) || exactQuantity < 0 || exactQuantity > remaining)) throw new Error(`${purchase.material_code}: la cantidad que llega debe estar entre 0 y ${remaining}.`);
    const expected = change && Object.hasOwn(change, 'date') ? change.date : (purchase.status === 'ordered' ? purchase.expected_date : null);
    if (expected && !dateValid(expected)) throw new Error('La fecha de ingreso no es válida.');
    const arrival = expected ? shiftDate(expected, delay) : null;
    const quantity = change?.missed ? 0 : exactQuantity === null ? round(remaining * percent / 100) : round(exactQuantity);
    const usable = !!arrival && arrival >= startDate && quantity > 0;
    return { ...purchase, remaining, arrival, quantity: usable ? quantity : 0,
      outcome: change?.missed || quantity === 0 ? 'No ingresa' : !arrival ? 'Sin fecha de ingreso' : arrival < startDate ? 'Fecha vencida sin recepción' : arrival > endDate ? 'Fuera del horizonte' : quantity < remaining ? 'Ingreso parcial' : delay > 0 ? 'Ingreso con retraso' : purchase.status === 'requested' ? 'Ingreso supuesto para la solicitud' : 'Ingreso previsto' };
  });
  const cecoMaterials = [];
  const inventory = (dataset.inventory || []).map((material) => {
    const adjustment = Number(stockAdjustments[material.code] || 0);
    if (!Number.isFinite(adjustment) || Number(material.physical) + adjustment < 0) throw new Error(`${material.code}: el ajuste no puede dejar un stock negativo.`);
    const physical = round(Number(material.physical) + adjustment);
    const allNeeds = links.get(material.code) || [];
    // Commitments already represented by the open CECO requirements are deducted only once.
    const externalCommitted = round(Number(material.committed || 0) - allNeeds.reduce((sum, need) => sum + need.quantity, 0));
    const needs = allNeeds.map((need) => ({ ...need, originalNeeded: need.needed, needed: !need.needed || need.needed < startDate ? startDate : need.needed }))
      .filter((need) => need.needed <= endDate).sort((a, b) => a.needed.localeCompare(b.needed) || a.ceco.localeCompare(b.ceco));
    const materialPurchases = purchases.filter((row) => row.material_code === material.code);
    const lots = [{ date: startDate, remaining: round(physical - externalCommitted), id: 'stock', cecos: [] },
      ...materialPurchases.filter((row) => row.quantity > 0).sort((a, b) => a.arrival.localeCompare(b.arrival) || String(a.id).localeCompare(String(b.id)))
        .map((row) => ({ date: row.arrival, remaining: row.quantity, id: row.id, cecos: row.cecos || [] }))];
    for (const need of needs) {
      let outstanding = need.quantity;
      let onTime = 0;
      let withinHorizon = 0;
      let coverageDate = startDate;
      const allocations = [];
      for (const lot of lots) {
        if (lot.cecos.length && !lot.cecos.includes(need.ceco)) continue;
        const amount = Math.min(outstanding, lot.remaining);
        if (amount <= 0) continue;
        lot.remaining = round(lot.remaining - amount);
        outstanding = round(outstanding - amount);
        if (lot.date <= need.needed) onTime += amount;
        if (lot.date <= endDate) withinHorizon += amount;
        if (lot.date > coverageDate) coverageDate = lot.date;
        allocations.push({ id: lot.id, quantity: round(amount), date: lot.date });
      }
      const missing = round(outstanding);
      const delayDays = !missing ? Math.max(0, Math.round((Date.parse(coverageDate) - Date.parse(need.needed)) / 86400000)) : null;
      cecoMaterials.push({ ...need, code: material.code, description: material.description, unit: material.unit,
        onTime: round(onTime), missingOnDate: round(need.quantity - onTime), missingInHorizon: round(need.quantity - withinHorizon), missing,
        coverageDate: missing ? null : coverageDate, delayDays, allocations,
        purchases: materialPurchases.filter((row) => !row.cecos?.length || row.cecos.includes(need.ceco)),
        state: missing ? 'Sin cobertura completa' : delayDays > 0 ? 'Material tardío' : 'A tiempo' });
    }
    const required = needs.reduce((sum, row) => sum + row.quantity, 0);
    const receipts = materialPurchases.filter((row) => row.arrival <= endDate).reduce((sum, row) => sum + row.quantity, 0);
    const closing = Math.round((physical - externalCommitted + receipts - required) * 1000) / 1000;
    const safety = calculateSafetyStock(material);
    return { ...material, physical, required: round(required), receipts: round(receipts), closing, safety,
      shortage: round(-closing), replenish: round(safety - closing), externalCommitted,
      missingOnDate: round(cecoMaterials.filter((row) => row.code === material.code).reduce((sum, row) => sum + row.missingOnDate, 0)) };
  });
  const cecos = [...new Set(cecoMaterials.map((row) => row.ceco))].map((ceco) => {
    const rows = cecoMaterials.filter((row) => row.ceco === ceco);
    return { ceco, product: rows[0].product, materials: rows.length, missing: rows.filter((row) => row.missing > 0).length,
      late: rows.filter((row) => row.delayDays > 0).length, readyDate: rows.some((row) => row.missing > 0) ? null : rows.reduce((date, row) => row.coverageDate > date ? row.coverageDate : date, startDate) };
  });
  return { startDate, endDate, purchases, inventory, cecoMaterials, cecos };
}

export function compareSupply(dataset, options) {
  return { baseline: simulateSupply(dataset, { startDate: options.startDate, horizonDays: options.horizonDays }), scenario: simulateSupply(dataset, options) };
}

// Keep quantities in their own units. Counts can be compared across materials,
// but adding gallons, rolls and pieces would make a misleading headline.
export function summarizeSupplyComparison(baseline, scenario, options = {}) {
  const basePurchases = new Map(baseline.purchases.map((row) => [row.id, row]));
  const baseInventory = new Map(baseline.inventory.map((row) => [row.code, row]));
  const baseNeeds = new Map(baseline.cecoMaterials.map((row) => [`${row.ceco}:${row.code}`, row]));
  const adjustedPurchases = scenario.purchases.filter((row) => Object.keys(options.deliveries?.[row.id] || {}).length > 0).map((row) => ({
    ...row,
    baseQuantity: basePurchases.get(row.id)?.quantity || 0,
    notArriving: round(row.remaining - row.quantity)
  }));
  const changedInventory = scenario.inventory.filter((row) => {
    const base = baseInventory.get(row.code);
    return base && (row.closing !== base.closing || row.receipts !== base.receipts || row.replenish !== base.replenish);
  });
  const changedNeeds = scenario.cecoMaterials.filter((row) => {
    const base = baseNeeds.get(`${row.ceco}:${row.code}`);
    return base && (row.onTime !== base.onTime || row.missing !== base.missing || row.coverageDate !== base.coverageDate);
  });
  const arrivingInPeriod = (value) => value.purchases.filter((row) => row.quantity > 0 && row.arrival && row.arrival <= value.endDate).length;
  return {
    adjustedPurchases, changedInventory, changedNeeds,
    baseArrivingOrders: arrivingInPeriod(baseline), scenarioArrivingOrders: arrivingInPeriod(scenario),
    baselineHasUndatedRequests: adjustedPurchases.some((row) => row.status === 'requested' && !basePurchases.get(row.id)?.arrival),
    hasOperatingChange: changedInventory.length > 0 || changedNeeds.length > 0
  };
}
