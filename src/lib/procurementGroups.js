export function groupProcurementRows(dataset, rows) {
  const orders = new Map((dataset.orders || []).map((order) => [order.ceco, order]));
  const products = new Map((dataset.bodyTypes || []).map((product) => [product.id, product]));
  const stages = new Map((dataset.flowStages || []).map((stage) => [stage.id, stage]));
  const groups = new Map();
  for (const row of rows) {
    const ceco = row.cecos?.[0] || "Sin CECO";
    const order = orders.get(ceco);
    const product = products.get(order?.bodyTypeId);
    const route = product?.route || [];
    const pieces = (dataset.bom || []).filter((piece) => piece.bodyTypeId === order?.bodyTypeId && piece.materialCode === row.material_code);
    const notedStage = route.find((stageId) => row.note?.includes(`${ceco}:${stageId}`));
    const stageId = notedStage || pieces.map((piece) => piece.stageId).sort((a, b) => route.indexOf(a) - route.indexOf(b))[0] || null;
    const phaseOrder = route.indexOf(stageId);
    const phaseName = stages.get(stageId)?.name || "Sin fase asignada";
    const key = `${ceco}:${stageId || "none"}`;
    const group = groups.get(key) || { key, ceco, product: product?.name || "Producto", phaseName,
      phaseOrder: phaseOrder < 0 ? Number.MAX_SAFE_INTEGER : phaseOrder,
      open: order?.active !== false && Number(order?.progress) < 100, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, rows: group.rows.sort((a, b) => a.material_code.localeCompare(b.material_code) || Number(b.request_number || 0) - Number(a.request_number || 0)) }))
    .sort((a, b) => Number(b.open) - Number(a.open) || a.ceco.localeCompare(b.ceco) || a.phaseOrder - b.phaseOrder || a.phaseName.localeCompare(b.phaseName));
}
