import test from "node:test";
import assert from "node:assert/strict";
import { availableDateRange, buildExcelReport, calculateProductivityReport, materialConsumptionCost } from "../src/lib/productivity.js";

const dataset = {
  orders: [
    { ceco: "1", customer: "A", progress: 100, dueDate: "2026-01-10", orderDate: "2026-01-01", actualDeliveryDate: "2026-01-09", outputValue: 1000, energyCost: 0, capitalCost: 0 },
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
  assert.equal(current.averageLeadTime, -1);
  assert.equal(current.safetyCoverage, 100);
  assert.equal(current.laborProductivity, 0.1);
  assert.equal(current.materialProductivity, 0.01);
  assert.equal(current.multifactorProductivity, 5);
});

test("cobertura usa el stock de seguridad calculado y el mínimo manual cuando faltan parámetros", () => {
  const inventory = [
    { code: "A", physical: 8, committed: 0, safety: 2, serviceFactor: 2, demandStdDev: 3, leadTimeDays: 4, averageDemand: 2, leadTimeStdDev: 1 },
    { code: "B", physical: 5, committed: 1, safety: 5, serviceFactor: 1.65, demandStdDev: "", leadTimeDays: 3 }
  ];
  const report = calculateProductivityReport({ ...dataset, inventory }, "2026-01-01", "2026-01-31");
  assert.equal(report.current.safetyCoverage, 0);
});

test("productividad de materiales usa salidas por CECO cuando aún no hay reservas consumidas", () => {
  const withIssues = {
    ...dataset,
    orderMaterialReservations: [{ ceco: "1", materialCode: "M1", consumedQuantity: 0 }],
    inventoryMovements: [{ ceco: "1", type: "salida", code: "M1", quantity: 5, timestamp: "2026-01-08" }]
  };
  const report = calculateProductivityReport(withIssues, "2026-01-01", "2026-01-31");
  assert.equal(report.current.materialCost, 100);
  assert.equal(report.current.materialProductivity, 0.01);
  const missingPrice = calculateProductivityReport({ ...withIssues, inventory: [{ ...dataset.inventory[0], unitCost: null }] }, "2026-01-01", "2026-01-31");
  assert.equal(missingPrice.current.materialProductivity, null);
  assert.equal(missingPrice.current.materialCostReason, "missing_unit_cost");
});

test("el avance terminado cuenta en su fecha de fin aunque empezara antes", () => {
  const withLateFinish = {
    ...dataset,
    activityProgress: [{ ceco: "1", startedAt: "2026-01-03", finishedAt: "2026-02-05", status: "completed", progress: 100 }]
  };
  const january = calculateProductivityReport(withLateFinish, "2026-01-01", "2026-01-31").current;
  const february = calculateProductivityReport(withLateFinish, "2026-02-01", "2026-02-28").current;
  assert.equal(january.executedActivities, 0);
  assert.equal(february.executedActivities, 1);
  assert.equal(february.progressRate, 100);
});

test("el CECO terminado acredita materiales BOM de sus fases sin duplicar salidas", () => {
  const withoutUse = {
    ...dataset,
    orderMaterialReservations: [{ ceco: "1", materialCode: "M1", requiredQuantity: 5, reservedQuantity: 5, consumedQuantity: 0 }],
    inventoryMovements: [],
    warehouse: []
  };
  const { current } = calculateProductivityReport(withoutUse, "2026-01-01", "2026-01-31");
  assert.equal(current.progressRate, 50);
  assert.equal(current.materialProductivity, 0.01);
  assert.equal(current.materialCost, 100);
  assert.equal(current.hasEstimatedMaterialUsage, true);
  const unpriced = calculateProductivityReport({ ...withoutUse, inventory: [{ ...dataset.inventory[0], unitCost: null }] }, "2026-01-01", "2026-01-31").current;
  assert.equal(unpriced.materialCostReason, "missing_unit_cost");
});

test("una fase completada imputa solo sus materiales al CECO en curso", () => {
  const inProgress = {
    orders: [{ ceco: "3", progress: 50 }],
    stageActivities: [{ id: "A1", stageId: "S1", active: true }, { id: "A2", stageId: "S2", active: true }],
    activityProgress: [{ ceco: "3", activityId: "A1", status: "completed", progress: 100 }],
    orderMaterialReservations: [
      { ceco: "3", stageId: "S1", materialCode: "M1", requiredQuantity: 2 },
      { ceco: "3", stageId: "S2", materialCode: "M2", requiredQuantity: 9 }
    ],
    inventory: [{ code: "M1", unitCost: 5 }, { code: "M2", unitCost: 5 }]
  };
  const result = materialConsumptionCost(inProgress, "3", "2026-01-01", "2026-01-31");
  assert.equal(result.cost, 10);
  assert.equal(result.estimatedQuantity, 2);
  assert.match(result.source, /Avance de fase\/BOM/);
});

test("costo de materiales reúne fuentes por material sin duplicar salida y consumo", () => {
  const withTwoMaterials = {
    ...dataset,
    inventory: [...dataset.inventory, { code: "M2", unitCost: 10 }],
    orderMaterialReservations: [{ ceco: "1", materialCode: "M1", consumedQuantity: 3 }],
    inventoryMovements: [
      { ceco: "1", type: "salida", code: "M1", quantity: 3, timestamp: "2026-01-08" },
      { ceco: "1", type: "consumo", code: "M1", quantity: 3, timestamp: "2026-01-08" },
      { ceco: "1", type: "consumo", code: "M2", quantity: 4, timestamp: "2026-01-08" }
    ]
  };
  const { current } = calculateProductivityReport(withTwoMaterials, "2026-01-01", "2026-01-31");
  assert.equal(current.materialCost, 100);
  assert.equal(current.materialProductivity, 0.01);
});

test("productividad multifactorial queda pendiente si faltan costos de factores", () => {
  const withoutEnergy = { ...dataset, orders: dataset.orders.map((order) => order.ceco === "1" ? { ...order, energyCost: null } : order) };
  const report = calculateProductivityReport(withoutEnergy, "2026-01-01", "2026-01-31");
  assert.equal(report.current.multifactorProductivity, null);
});

test("costo de mano de obra usa la tarifa del trabajador cuando el parte solo registra horas", () => {
  const withPersonnelRate = {
    ...dataset,
    personnel: [{ name: "Ana", hourlyCost: 10 }],
    operations: dataset.operations.map(({ hourlyCost, ...operation }) => operation)
  };
  const { current } = calculateProductivityReport(withPersonnelRate, "2026-01-01", "2026-01-31");
  assert.equal(current.laborCost, 100);
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
