import test from "node:test";
import assert from "node:assert/strict";
import { availableDateRange, buildExcelReport, calculateProductivityReport } from "../src/lib/productivity.js";

const dataset = {
  orders: [
    { ceco: "1", customer: "A", progress: 100, dueDate: "2026-01-10", orderDate: "2026-01-01", actualDeliveryDate: "2026-01-09", outputValue: 1000 },
    { ceco: "2", customer: "B", progress: 50, dueDate: "2026-01-20", orderDate: "2026-01-05" }
  ],
  operations: [{ ceco: "1", date: "2026-01-09", totalHours: 10, hourlyCost: 10, worker: "Ana", activity: "Entrega" }],
  activityProgress: [
    { ceco: "1", startedAt: "2026-01-03", status: "completed", progress: 100 },
    { ceco: "2", startedAt: "2026-01-06", status: "in_progress", progress: 50 }
  ],
  inventory: [{ code: "M1", physical: 10, committed: 2, safety: 5, unitCost: 20 }],
  orderMaterialReservations: [{ ceco: "1", materialCode: "M1", consumedQuantity: 5 }],
  inventoryMovements: [],
  warehouse: []
};

test("calcula los indicadores definidos por la tesis", () => {
  const { current } = calculateProductivityReport(dataset, "2026-01-01", "2026-01-31");
  assert.equal(current.pmpCompliance, 50);
  assert.equal(current.progressRate, 50);
  assert.equal(current.averageLeadTime, 8);
  assert.equal(current.safetyCoverage, 100);
  assert.equal(current.laborProductivity, 0.1);
  assert.equal(current.materialProductivity, 0.01);
  assert.equal(current.multifactorProductivity, 5);
});

test("determina el rango disponible y genera un libro compatible con Excel", () => {
  assert.deepEqual(availableDateRange(dataset), { start: "2026-01-01", end: "2026-01-20" });
  const report = calculateProductivityReport(dataset, "2026-01-01", "2026-01-31");
  const xml = buildExcelReport(report);
  assert.match(xml, /Cumplimiento PMP/);
  assert.match(xml, /Órdenes terminadas/);
  assert.match(xml, /Horas reportadas/);
});
