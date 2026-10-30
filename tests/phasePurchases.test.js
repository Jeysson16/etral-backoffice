import test from "node:test";
import assert from "node:assert/strict";
import { buildMaterialPlan } from "../src/lib/planning.js";
import { buildPhasePurchaseBoard } from "../src/lib/phasePurchases.js";

const sample = {
  flowStages: [{ id: "cut", name: "Corte", code: "01" }, { id: "paint", name: "Pintura", code: "02" }],
  stageActivities: [{ id: "cut-1", stageId: "cut", active: true }, { id: "paint-1", stageId: "paint", active: true }],
  activityProgress: [
    { ceco: "260001", activityId: "cut-1", plannedStartDate: "2026-11-01", progress: 0 },
    { ceco: "260001", activityId: "paint-1", plannedStartDate: "2026-11-15", progress: 0 }
  ],
  bodyTypes: [{ id: "product", name: "Furgón", targetDays: 20, route: ["cut", "paint"] }],
  orders: [{ ceco: "260001", bodyTypeId: "product", plannedStartDate: "2026-11-01", dueDate: "2026-11-21", progress: 0, active: true }],
  bom: [
    { id: "cut-m", bodyTypeId: "product", stageId: "cut", materialCode: "MAT-1", quantity: 1 },
    { id: "paint-m", bodyTypeId: "product", stageId: "paint", materialCode: "MAT-1", quantity: 2 }
  ],
  inventory: [{ code: "MAT-1", description: "Material compartido", physical: 1, safety: 0, leadTimeDays: 2, unit: "und" }],
  purchaseRequests: []
};

test("necesidad y proyección se asignan a la fase programada sin duplicar el stock", () => {
  const plan = buildMaterialPlan(sample, "2026-10-30");
  const board = buildPhasePurchaseBoard(sample, plan, "2026-10-30");
  assert.deepEqual(board.groups.map((group) => [group.stageName, group.needed, group.rows[0].projected]),
    [["Corte", "2026-11-01", 0], ["Pintura", "2026-11-15", -2]]);
  assert.equal(board.suggestions.length, 1);
  assert.equal(board.suggestions[0].phaseKey, "260001:paint");
  assert.equal(board.suggestions[0].quantity, 2);
  assert.equal(board.groups[1].requestCount, 1);
  assert.equal(board.groups[1].rows[0].requestDate, "2026-11-13");
  assert.equal(board.groups[1].rows[0].plannedNeeded, "2026-11-15");
  assert.equal(board.groups[1].rows[0].requestOverdue, false);
});

test("una necesidad vencida conserva la fecha ideal de solicitud anterior a la fase", () => {
  const plan = buildMaterialPlan(sample, "2026-11-20");
  const board = buildPhasePurchaseBoard(sample, plan, "2026-11-20");
  const row = board.groups.find((group) => group.stageId === "paint").rows[0];
  assert.equal(row.requestDate, "2026-11-13");
  assert.equal(row.plannedNeeded, "2026-11-15");
  assert.equal(row.requestOverdue, true);
});

test("una fase cerrada deja de demandar su material", () => {
  const dataset = structuredClone(sample);
  dataset.activityProgress[0] = { ...dataset.activityProgress[0], status: "completed", progress: 100 };
  const plan = buildMaterialPlan(dataset, "2026-10-30");
  const board = buildPhasePurchaseBoard(dataset, plan, "2026-10-30");
  assert.deepEqual(board.groups.map((group) => group.stageName), ["Pintura"]);
  assert.equal(board.suggestions[0].quantity, 1);
});
