import test from "node:test";
import assert from "node:assert/strict";
import { buildEstimatedHistoricalClosure, buildMaterialPlan, buildPmpCalendar, buildPmpPeriod, buildProductionPlan, materialOrderLinks } from "../src/lib/planning.js";

const dataset = {
  flowStages: [{ id: "cut", standardHours: 4, capacityHours: 10 }],
  bodyTypes: [{ id: "product", name: "Producto", targetDays: 2, route: ["cut"] }],
  orders: [{ ceco: "260001", bodyTypeId: "product", plannedStartDate: "2026-10-21", dueDate: "2026-10-22", progress: 0, active: true }],
  bom: [{ bodyTypeId: "product", materialCode: "MAT-1", quantity: 7 }],
  inventory: [{ code: "MAT-1", description: "Material", physical: 3, safety: 2, leadTimeDays: 7, unit: "und" }]
};

test("calendario PMP ubica la entrega y estima capacidad semanal", () => {
  const plan = buildProductionPlan(dataset, "2026-10-21");
  assert.equal(plan.rows[0].week, 0);
  assert.equal(plan.capacity[0].required, 4);
  assert.equal(plan.capacity[0].utilization, 40);
});

test("PMP por periodo cuenta CECO reales por inicio o fecha pactada y muestra los que cruzan meses", () => {
  const sample = { ...dataset, orders: [
    { ...dataset.orders[0], plannedStartDate: "2026-06-28", dueDate: "2026-07-15" },
    { ...dataset.orders[0], ceco: "260002", plannedStartDate: "2026-07-20", dueDate: "2026-08-08" }
  ] };
  const byStart = buildPmpPeriod(sample, "2026-06", "2026-07");
  assert.deepEqual(byStart.months, ["2026-06", "2026-07"]);
  assert.deepEqual(byStart.totals, [1, 1]);
  assert.equal(byStart.overlapping.length, 2);
  const byDue = buildPmpPeriod(sample, "2026-06", "2026-07", "due");
  assert.deepEqual(byDue.totals, [0, 1]);
  assert.equal(byDue.overlapping.length, 2);
});

test("calendario PMP ubica cada CECO en los días entre inicio y fecha pactada", () => {
  const sample = { ...dataset, orders: [{ ...dataset.orders[0], plannedStartDate: "2026-07-30", dueDate: "2026-08-02" }] };
  const period = buildPmpPeriod(sample, "2026-07", "2026-08");
  const july = buildPmpCalendar(period.overlapping, "2026-07");
  const august = buildPmpCalendar(period.overlapping, "2026-08");
  assert.equal(july.find((cell) => cell.date === "2026-07-29").rows.length, 0);
  assert.equal(july.find((cell) => cell.date === "2026-07-30").rows.length, 1);
  assert.equal(august.find((cell) => cell.date === "2026-08-02").rows.length, 1);
  assert.equal(august.find((cell) => cell.date === "2026-08-03").rows.length, 0);
});

test("escenario histórico usa fechas programadas y marca consumos como estimados", () => {
  const historical = { ...dataset,
    orders: [{ ...dataset.orders[0], dueDate: "2026-08-20" }],
    activityProgress: [{ ceco: "260001", activityId: "A1", status: "pending", progress: 0, plannedEndDate: "2026-08-18" }],
    orderMaterialReservations: [{ ceco: "260001", materialCode: "MAT-1", stageId: "cut", requiredQuantity: 7, consumedQuantity: 2, issuedQuantity: 0 }]
  };
  const scenario = buildEstimatedHistoricalClosure(historical, "2026-10-29");
  assert.equal(scenario.activities[0].proposedFinish, "2026-08-18");
  assert.equal(scenario.materials[0].proposedConsumption, 5);
  assert.equal(scenario.materials[0].proposedDate, "2026-08-20");
  assert.equal(scenario.activities[0].estimated, true);
  assert.equal(historical.orders[0].progress, 0);
});

test("MRP propone un pedido desde hoy y recepción según plazo real", () => {
  const plan = buildMaterialPlan(dataset, "2026-10-21");
  const cell = plan.rows[0].cells[0];
  assert.equal(cell.gross, 7);
  assert.equal(cell.afterDemand, -4);
  assert.equal(cell.suggestedOrder, 6);
  assert.equal(cell.receipt, 0);
  assert.equal(cell.closing, -4);
  assert.equal(plan.rows[0].cells[1].receipt, 6);
  assert.equal(plan.rows[0].cells[1].closing, 2);
  assert.deepEqual(cell.cecos, ["260001"]);
  assert.deepEqual(plan.rows[0].orders.map((order) => [order.ceco, order.product, order.quantity]), [["260001", "Producto", 7]]);
  assert.equal(plan.purchases[0].orderBy, "2026-10-21");
  assert.equal(plan.purchases[0].arrivalDate, "2026-10-28");
  assert.equal(plan.purchases[0].cannotMeetNeed, true);
});

test("MRP excluye la fase completada aunque el CECO siga abierto", () => {
  const historical = {
    ...dataset,
    orders: [{ ...dataset.orders[0], plannedStartDate: "2026-07-14", dueDate: "2026-08-10", progress: 55 }],
    bom: [{ ...dataset.bom[0], id: "bom-1", stageId: "cut", quantity: 3 }],
    stageActivities: [{ id: "cut-1", stageId: "cut", active: true }],
    activityProgress: [{ ceco: "260001", activityId: "cut-1", status: "completed", progress: 100 }]
  };
  const plan = buildMaterialPlan(historical, "2026-10-29");
  assert.equal(plan.rows[0].totalGross, 0);
  assert.equal(plan.rows[0].totalSuggested, 0);
  assert.equal(plan.rows[0].orders.length, 0);
  assert.equal(materialOrderLinks(historical).has("MAT-1"), false);
});

test("MRP marca necesidad vencida y fecha original si la fase sigue pendiente", () => {
  const historical = {
    ...dataset,
    orders: [{ ...dataset.orders[0], plannedStartDate: "2026-07-14", dueDate: "2026-08-10", progress: 55 }],
    bom: [{ ...dataset.bom[0], quantity: 3 }]
  };
  const plan = buildMaterialPlan(historical, "2026-10-29");
  assert.equal(plan.purchases[0].orderBy, "2026-10-29");
  assert.equal(plan.purchases[0].arrivalDate, "2026-11-05");
  assert.equal(plan.purchases[0].originalNeeded, "2026-07-14");
  assert.equal(plan.purchases[0].overdue, true);
  assert.equal(plan.rows[0].cells[0].receipt, 0);
});

test("inventario identifica el CECO y producto asociados a cada material", () => {
  const links = materialOrderLinks(dataset).get("MAT-1");
  assert.deepEqual(links.map((link) => [link.ceco, link.product, link.quantity]), [["260001", "Producto", 7]]);
});
