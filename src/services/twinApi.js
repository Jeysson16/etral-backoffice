import { runDigitalTwin } from "../lib/simulator.js";

const baseUrl = (import.meta.env.VITE_TWIN_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const twinEngine = import.meta.env.VITE_TWIN_ENGINE || "browser";

export function getTwinEngine() {
  return twinEngine;
}

function snapshotFromDataset(dataset) {
  return {
    materials: dataset.inventory.map((item) => ({
      code: item.code, description: item.description, physical: Number(item.physical), committed: Number(item.committed || 0),
      safety: Number(item.safety || 0), service_factor: item.serviceFactor ?? null, demand_std_dev: item.demandStdDev ?? null,
      lead_time_days: item.leadTimeDays ?? null, unit: item.unit
    })),
    bom: dataset.bom.map((item) => ({ body_type_id: item.bodyTypeId, stage_id: item.stageId, material_code: item.materialCode, quantity: Number(item.quantity) })),
    orders: dataset.orders.map((item) => ({ ceco: item.ceco, body_type_id: item.bodyTypeId, stage_id: item.stageId, priority: Number(item.priority), progress: Number(item.progress), due_date: item.dueDate || null })),
    stages: dataset.flowStages.map((item, index) => ({ id: item.id, name: item.name, capacity_hours: Number(item.capacityHours), standard_hours: Number(item.standardHours), sequence: index + 1, color: item.color })),
    routes: Object.fromEntries(dataset.bodyTypes.map((item) => [item.id, item.route]))
  };
}

export async function runTwinSimulation(dataset, draft) {
  if (twinEngine !== "python") {
    return runDigitalTwin(dataset, draft);
  }

  const material_adjustments = draft.stockAdjustment ? { [draft.materialCode]: Number(draft.stockAdjustment) } : {};
  const priority_overrides = draft.expediteCeco ? { [draft.expediteCeco]: 1 } : {};
  const response = await fetch(`${baseUrl}/api/v1/simulations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Simulación desde interfaz", input: {
      snapshot: snapshotFromDataset(dataset), horizon_days: Number(draft.horizonDays),
      labor_availability: Number(draft.laborAvailability), shifts_per_day: Number(draft.shiftsPerDay),
      demand_percent: Number(draft.demandPercent), material_adjustments, priority_overrides
    } })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "No fue posible ejecutar el gemelo digital.");
  }
  return (await response.json()).result;
}
