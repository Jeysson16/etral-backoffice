import { shiftDate } from "./planning.js";

export function buildPhasePurchaseBoard(dataset, plan, today) {
  const materials = new Map((dataset.inventory || []).map((item) => [item.code, item]));
  const rowsByCode = new Map(plan.rows.map((row) => [row.material.code, row]));
  const requirements = [...(plan.phaseRequirements || [])].sort((a, b) =>
    a.needed.localeCompare(b.needed) || a.ceco.localeCompare(b.ceco) || a.routeOrder - b.routeOrder || a.code.localeCompare(b.code));
  const projected = new Map();
  const balance = new Map((dataset.inventory || []).map((item) => [item.code, Number(item.physical || 0)]));
  const receipts = new Map();
  for (const request of dataset.purchaseRequests || []) {
    if (request.status !== "ordered" || !request.expected_date || request.expected_date < today) continue;
    const quantity = Math.max(0, Number(request.quantity || 0) - Number(request.received_quantity || 0));
    if (!quantity) continue;
    const list = receipts.get(request.material_code) || [];
    list.push({ date: request.expected_date, quantity });
    receipts.set(request.material_code, list);
  }
  for (const list of receipts.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  for (const requirement of requirements) {
    const list = receipts.get(requirement.code) || [];
    while (list.length && list[0].date <= requirement.needed) {
      balance.set(requirement.code, (balance.get(requirement.code) || 0) + list.shift().quantity);
    }
    const remaining = (balance.get(requirement.code) || 0) - requirement.quantity;
    balance.set(requirement.code, remaining);
    projected.set(`${requirement.phaseKey}:${requirement.code}`, remaining);
  }
  const suggestions = plan.purchases.map((item) => {
    const phase = requirements.find((requirement) => item.phases.includes(requirement.phaseKey) && requirement.code === item.code);
    return { ...item, phaseKey: phase?.phaseKey || "" };
  });
  const suggestionByPhaseMaterial = new Map(suggestions.map((item) => [`${item.phaseKey}:${item.code}`, item]));
  const groups = new Map();
  for (const requirement of requirements) {
    const material = materials.get(requirement.code);
    const planRow = rowsByCode.get(requirement.code);
    if (!material || !planRow) continue;
    const key = requirement.phaseKey;
    const group = groups.get(key) || { key, ceco: requirement.ceco, product: requirement.product, stageId: requirement.stageId,
      stageName: requirement.stageName, stageCode: requirement.stageCode, routeOrder: requirement.routeOrder,
      needed: requirement.needed, originalNeeded: requirement.originalNeeded, rows: [] };
    const suggestion = suggestionByPhaseMaterial.get(`${key}:${requirement.code}`) || null;
    const stockAfter = projected.get(`${key}:${requirement.code}`);
    const plannedNeeded = requirement.originalNeeded || requirement.needed;
    const leadDays = Math.max(1, Math.ceil(Number(material.leadTimeDays) || 0));
    const requestDate = shiftDate(plannedNeeded, -leadDays);
    group.rows.push({ ...requirement, material, plannedNeeded, requestDate, requestOverdue: requestDate < today,
      projected: stockAfter, safety: planRow.safety,
      pendingSupply: planRow.pendingSupply, suggestion,
      status: suggestion ? "request" : stockAfter < planRow.safety && planRow.pendingSupply ? "pending"
        : stockAfter < planRow.safety && planRow.totalSuggested ? "planned" : stockAfter < planRow.safety ? "short" : "covered" });
    if (requirement.needed < group.needed) group.needed = requirement.needed;
    groups.set(key, group);
  }
  return { suggestions, groups: [...groups.values()].map((group) => ({ ...group,
    requestCount: group.rows.filter((row) => row.status === "request").length,
    coveredCount: group.rows.filter((row) => row.status === "covered").length,
    pendingCount: group.rows.filter((row) => row.status === "pending").length
  })).sort((a, b) => a.ceco.localeCompare(b.ceco) || a.routeOrder - b.routeOrder || a.needed.localeCompare(b.needed)) };
}
