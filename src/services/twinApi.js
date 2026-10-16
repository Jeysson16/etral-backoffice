import { runDigitalTwin } from "../lib/simulator.js";
import { supabase } from "../supabase/client.js";

const configuredApiUrl = import.meta.env.VITE_TWIN_API_URL;
const baseUrl = (configuredApiUrl || (import.meta.env.DEV ? "http://127.0.0.1:8000" : "")).replace(/\/$/, "");
const twinEngine = import.meta.env.VITE_TWIN_ENGINE || "browser";
// Monte Carlo on the free App Service can take longer than an ordinary request.
// Keep the browser patient before using the local continuity calculation.
const API_TIMEOUT_MS = 90_000;

function positiveNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pmpSummaryFromSchedule(scenario) {
  const schedule = scenario?.cecoSchedule ?? [];
  if (!schedule.length) return null;
  const evaluable = schedule.filter((row) => row.dueDate);
  const onTime = evaluable.filter((row) => row.endDate && row.endDate <= row.dueDate).length;
  return {
    evaluable: evaluable.length,
    onTime,
    withoutDueDate: schedule.length - evaluable.length
  };
}

function normalizePythonResult(result) {
  const pmpSummary = result?.scenario?.pmpSummary ?? pmpSummaryFromSchedule(result?.scenario);
  const scenario = pmpSummary && !result?.scenario?.pmpSummary
    ? { ...result.scenario, pmpSummary, pmpCompliance: pmpSummary.evaluable ? Math.round((pmpSummary.onTime / pmpSummary.evaluable) * 100) : 100 }
    : result.scenario;

  // Older API deployments returned the calculation but not its execution metadata.
  // Keep their results interpretable while the server catches up with the current contract.
  return {
    ...result,
    scenario,
    execution: result.execution ?? {
      engine: "python",
      label: "Motor Python avanzado",
      fallback: false,
      model: result.confidenceIntervals ? "Monte Carlo" : "Determinista",
      runs: result.confidenceIntervals?.runs ?? 1
    }
  };
}

export function getTwinEngine() {
  return twinEngine;
}

function snapshotFromDataset(dataset) {
  const activityIdByName = new Map((dataset.stageActivities ?? []).map((item) => [item.name, item.id]));
  const workerIdByName = new Map((dataset.personnel ?? []).map((item) => [item.name, item.id]));
  return {
    materials: dataset.inventory.map((item) => ({
      code: item.code, description: item.description, physical: Number(item.physical), committed: Number(item.committed || 0),
      safety: Number(item.safety || 0), service_factor: positiveNumberOrNull(item.serviceFactor), demand_std_dev: item.demandStdDev == null ? null : Number(item.demandStdDev),
      lead_time_days: positiveNumberOrNull(item.leadTimeDays), unit: item.unit
    })),
    bom: dataset.bom.map((item) => ({ body_type_id: item.bodyTypeId, stage_id: item.stageId, material_code: item.materialCode, quantity: Number(item.quantity) })),
    orders: dataset.orders.map((item) => ({ ceco: item.ceco, body_type_id: item.bodyTypeId, stage_id: item.stageId, priority: Number(item.priority), progress: Number(item.progress), planned_start_date: item.plannedStartDate || null, due_date: item.dueDate || null })),
    stages: dataset.flowStages.map((item, index) => ({ id: item.id, name: item.name, capacity_hours: Number(item.capacityHours), standard_hours: Number(item.standardHours), sequence: index + 1, color: item.color })),
    routes: Object.fromEntries(dataset.bodyTypes.map((item) => [item.id, item.route])),
    body_types: dataset.bodyTypes.map((item) => ({ id: item.id, name: item.name, route: item.route, target_days: Number(item.targetDays) || null })),
    order_material_reservations: (dataset.orderMaterialReservations ?? []).map((item) => ({ ceco: item.ceco, material_code: item.materialCode, stage_id: item.stageId, required_quantity: Number(item.requiredQuantity), consumed_quantity: Number(item.consumedQuantity || 0) })),
    inventory_movements: (dataset.inventoryMovements ?? []).map((item) => ({ code: item.code, type: item.type, quantity: Number(item.quantity), timestamp: item.timestamp || null })),
    personnel: (dataset.personnel ?? []).map((item) => ({ id: item.id, status: item.status, efficiency: Number(item.efficiency), weekly_hours: Number(item.weeklyHours), shift_id: item.shiftId })),
    shifts: (dataset.shifts ?? []).map((item) => ({ id: item.id, start_time: item.startTime, end_time: item.endTime, break_minutes: Number(item.breakMinutes), active: item.active })),
    equipment: (dataset.equipment ?? []).map((item) => ({ id: item.id, stage_id: item.stageId, status: item.status, capacity_hours: Number(item.capacityHours) })),
    calendar: (dataset.workCalendar ?? []).map((item) => ({ date: item.date, day_type: item.dayType, available_hours: Number(item.availableHours) })),
    assignments: (dataset.assignments ?? []).map((item) => ({ personnel_id: item.personnelId, ceco: item.ceco, activity_id: item.activityId, planned_hours: Number(item.plannedHours), status: item.status })),
    incidents: (dataset.incidents ?? []).map((item) => ({ stage_id: item.stageId, downtime_hours: Number(item.downtimeHours), status: item.status, severity: item.severity })),
    stage_activities: (dataset.stageActivities ?? []).map((item) => ({ id: item.id, stage_id: item.stageId, standard_minutes: Number(item.standardMinutes), active: item.active !== false })),
    activity_progress: (dataset.activityProgress ?? []).map((item) => ({ ceco: item.ceco, activity_id: item.activityId, status: item.status, progress: Number(item.progress ?? 0), started_at: item.startedAt ?? null, finished_at: item.finishedAt ?? null })),
    operation_logs: (dataset.operations ?? []).map((item) => ({ ceco: item.ceco, activity_id: activityIdByName.get(item.activity) ?? null, worker_id: workerIdByName.get(item.worker) ?? null, total_hours: Number(item.totalHours), date: item.date ?? null }))
  };
}

export async function runTwinSimulation(dataset, draft) {
  const simulationDraft = {
    ...draft,
    laborAvailability: draft.workerInconsistencyMode === "stochastic" ? 100 : Number(draft.laborAvailability)
  };
  if (twinEngine !== "python") return runDigitalTwin(dataset, simulationDraft);

  const material_adjustments = Object.fromEntries(
    (simulationDraft.materialAdjustments ?? []).map((item) => [item.materialCode, Number(item.stockAdjustment ?? 0)])
  );
  const priority_overrides = Object.fromEntries((simulationDraft.priorityCecos ?? []).map((ceco, index) => [ceco, Number(simulationDraft.orderPriorityOverrides?.[ceco] ?? index + 1)]));
  const { data: { session } = {} } = supabase ? await supabase.auth.getSession() : {};
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/api/v1/simulations`, {
      method: "POST", headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      signal: controller.signal,
      body: JSON.stringify({ name: "Simulación desde interfaz", input: {
        snapshot: snapshotFromDataset(dataset), horizon_days: Number(simulationDraft.horizonDays),
        labor_availability: Number(simulationDraft.laborAvailability), shifts_per_day: Number(simulationDraft.shiftsPerDay),
        demand_percent: Number(simulationDraft.demandPercent), material_adjustments, priority_overrides,
        order_complexity_map: simulationDraft.orderComplexityMap ?? {},
        order_worker_assignments: simulationDraft.orderWorkerAssignments ?? {},
        worker_inconsistency_mode: simulationDraft.workerInconsistencyMode ?? "stochastic",
        inconsistency_std_dev: Number(simulationDraft.inconsistencyStdDev ?? 10),
        absenteeism_rate: Number(simulationDraft.absenteeismRate ?? 5),
        monte_carlo_runs: Number(simulationDraft.monteCarloRuns ?? 250),
        random_seed: Number(simulationDraft.randomSeed ?? 42)
      } })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "No fue posible ejecutar el gemelo digital.");
    }
    const payload = await response.json();
    return normalizePythonResult(payload.result);
  } catch (error) {
    console.warn("La API Python no respondió; se usa el motor JS de respaldo.", error);
    const fallback = runDigitalTwin(dataset, simulationDraft);
    return {
      ...fallback,
      execution: {
        ...fallback.execution,
        engine: "javascript_fallback",
        label: "Motor JavaScript de respaldo",
        fallback: true,
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}
