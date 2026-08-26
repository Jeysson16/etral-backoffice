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
    routes: Object.fromEntries(dataset.bodyTypes.map((item) => [item.id, item.route])),
    personnel: (dataset.personnel ?? []).map((item) => ({ id: item.id, status: item.status, efficiency: Number(item.efficiency), weekly_hours: Number(item.weeklyHours), shift_id: item.shiftId })),
    shifts: (dataset.shifts ?? []).map((item) => ({ id: item.id, start_time: item.startTime, end_time: item.endTime, break_minutes: Number(item.breakMinutes), active: item.active })),
    equipment: (dataset.equipment ?? []).map((item) => ({ id: item.id, stage_id: item.stageId, status: item.status, capacity_hours: Number(item.capacityHours) })),
    calendar: (dataset.workCalendar ?? []).map((item) => ({ date: item.date, day_type: item.dayType, available_hours: Number(item.availableHours) })),
    assignments: (dataset.assignments ?? []).map((item) => ({ personnel_id: item.personnelId, ceco: item.ceco, activity_id: item.activityId, planned_hours: Number(item.plannedHours), status: item.status })),
    incidents: (dataset.incidents ?? []).map((item) => ({ stage_id: item.stageId, downtime_hours: Number(item.downtimeHours), status: item.status, severity: item.severity }))
  };
}

export async function runTwinSimulation(dataset, draft) {
  // El navegador conserva la traza completa que llega de Supabase (reservas y
  // movimientos incluidos). El contrato Python actual no recibe esos campos,
  // por lo que no puede producir alertas explicables sin inventar información.
  if (twinEngine !== "python") return runDigitalTwin(dataset, draft);

  const material_adjustments = Object.fromEntries(
    (draft.materialAdjustments ?? []).map((item) => [item.materialCode, Number(item.stockAdjustment ?? 0)])
  );
  const priority_overrides = Object.fromEntries((draft.priorityCecos ?? []).map((ceco, index) => [ceco, index + 1]));
  const response = await fetch(`${baseUrl}/api/v1/simulations`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Simulación desde interfaz", input: {
      snapshot: snapshotFromDataset(dataset), horizon_days: Number(draft.horizonDays),
      labor_availability: Number(draft.laborAvailability), shifts_per_day: Number(draft.shiftsPerDay),
      demand_percent: Number(draft.demandPercent), material_adjustments, priority_overrides,
      order_complexity_map: draft.orderComplexityMap ?? {},
      order_worker_assignments: draft.orderWorkerAssignments ?? {},
      worker_inconsistency_mode: draft.workerInconsistencyMode ?? "stochastic",
      inconsistency_std_dev: Number(draft.inconsistencyStdDev ?? 10),
      absenteeism_rate: Number(draft.absenteeismRate ?? 5)
    } })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "No fue posible ejecutar el gemelo digital.");
  }
  await response.json();
  return runDigitalTwin(dataset, draft);
}
