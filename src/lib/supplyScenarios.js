export const SUPPLY_SCENARIO_KIND = 'material_supply_v1';

export function scenarioRecord(name, run) {
  if (!run?.baseline || !run?.scenario || !run?.options) throw new Error('Primero calcula el escenario.');
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 100) throw new Error('Escribe un nombre de hasta 100 caracteres.');
  return structuredClone({ name: cleanName, parameters: { kind: SUPPLY_SCENARIO_KIND, ...run.options },
    results: { baseline: run.baseline, scenario: run.scenario } });
}

export function reuseScenario(record, dataset, today) {
  const source = record.parameters;
  if (source?.kind !== SUPPLY_SCENARIO_KIND) throw new Error('Este escenario no corresponde a materiales.');
  const openIds = new Set((dataset.purchaseRequests || []).filter((row) => ['requested', 'ordered'].includes(row.status) && Number(row.quantity) > Number(row.received_quantity || 0)).map((row) => row.id));
  const materialIds = new Set(dataset.inventory.map((row) => row.code));
  const deliveries = Object.fromEntries(Object.entries(source.deliveries || {}).filter(([id]) => openIds.has(id)).map(([id, change]) => {
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${source.startDate}T12:00:00Z`)) / 86400000);
    const date = change.date ? new Date(Date.parse(`${change.date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10) : change.date;
    return [id, { ...change, ...(date !== undefined ? { date } : {}) }];
  }));
  const stockAdjustments = Object.fromEntries(Object.entries(source.stockAdjustments || {}).filter(([code]) => materialIds.has(code)));
  const omitted = Object.keys(source.deliveries || {}).length - Object.keys(deliveries).length + Object.keys(source.stockAdjustments || {}).length - Object.keys(stockAdjustments).length;
  return { options: { startDate: today, horizonDays: source.horizonDays, deliveries, stockAdjustments }, omitted };
}

export function changeSelectedDeliveries(current, ids, patch) {
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== '' && value != null));
  return { ...current, ...Object.fromEntries(ids.map((id) => [id, { ...current[id], ...changes, missed: false }])) };
}

export function reduceSelectedStock(current, materials, percent) {
  const amount = Number(percent);
  if (percent === '' || !Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error('La reducción debe estar entre 0 y 100%.');
  return { ...current, ...Object.fromEntries(materials.map((row) => [row.code, -Math.round(Number(row.physical) * amount / 100 * 1000) / 1000])) };
}
