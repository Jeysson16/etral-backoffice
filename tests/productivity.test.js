import test from "node:test";
import assert from "node:assert/strict";
import { availableDateRange, buildExcelReport, buildLiveProductivity, calculateProductivityReport, materialConsumptionCost } from "../src/lib/productivity.js";

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

test("productividad por peso usa los campos del CECO y el promedio de razones del Excel", () => {
  const order = { ceco: "260350", progress: 100, dueDate: "2026-06-30", actualDeliveryDate: "2026-06-28",
    outputWeightKg: 624.29, reportedWorkerCount: 8, reportedLaborHours: 65.5, laborHourCostPen: 4.708333333333333,
    rawMaterialCostPen: 1992.12, suppliesCostPen: 1828.27, outputValue: 11500, energyCost: 1200, capitalCost: 3820.39 };
  const measured = calculateProductivityReport({ orders: [order], operations: [], activityProgress: [], inventory: [] }, "2026-06-01", "2026-06-30").current;
  assert.equal(measured.measurementMode, "weight");
  assert.equal(measured.reportedHours, 65.5);
  assert.equal(measured.laborProductivity, 9.531);
  assert.equal(measured.materialProductivity, 0.1634);
  assert.equal(measured.multifactorProductivity, 2.158);
  assert.equal(measured.cecoMeasurements[0].rawMaterialCost, 1992.12);
});

test("el avance de actividad actualiza la productividad parcial sin cambiar el promedio de CECO cerrados", () => {
  const reference = { ceco: "REF", bodyTypeId: "body", progress: 100, dueDate: "2026-10-10", actualDeliveryDate: "2026-10-10",
    outputWeightKg: 100, reportedLaborHours: 10, laborHourCostPen: 5, rawMaterialCostPen: 30, suppliesCostPen: 20,
    outputValue: 1000, energyCost: 40, capitalCost: 50 };
  const active = { ceco: "LIVE", bodyTypeId: "body", progress: 25, outputValue: 1000, energyCost: 40, active: true };
  const base = { orders: [reference, active], bodyTypes: [{ id: "body", route: ["stage"] }],
    stageActivities: [{ id: "a", stageId: "stage", active: true }, { id: "b", stageId: "stage", active: true }],
    activityProgress: [{ ceco: "LIVE", activityId: "a", progress: 50, status: "in_progress" }],
    orderMaterialReservations: [{ ceco: "LIVE", materialCode: "M", stageId: "stage", requiredQuantity: 8 }],
    inventory: [{ code: "M", unitCost: 10, physical: 20, committed: 8, safety: 1 }],
    operations: [{ ceco: "LIVE", date: "2026-10-20", totalHours: 2, worker: "Ana", hourlyCost: 5 }],
    inventoryMovements: [], warehouse: [] };
  const first = buildLiveProductivity(base, "2026-10-30")[0];
  assert.equal(first.progress, 25);
  assert.equal(first.equivalentWeightKg, 25);
  assert.equal(first.materialCost, 20);
  assert.equal(first.laborProductivity, 12.5);
  assert.equal(first.materialProductivity, 1.25);
  assert.equal(first.multifactorProductivity, 6.25);
  assert.equal(first.weightEstimated, true);
  const advanced = { ...base, orders: [reference, { ...active, progress: 50 }],
    activityProgress: [{ ceco: "LIVE", activityId: "a", progress: 100, status: "completed" }] };
  const next = buildLiveProductivity(advanced, "2026-10-30")[0];
  assert.equal(next.progress, 50);
  assert.equal(next.equivalentWeightKg, 50);
  assert.equal(next.materialCost, 40);
  assert.equal(next.laborProductivity, 25);
  assert.equal(next.materialProductivity, 1.25);
  const withRecordedInputs = { ...advanced,
    operations: [{ ceco: "LIVE", date: "2026-10-20", totalHours: 4, worker: "Ana", hourlyCost: 5 }],
    inventoryMovements: [{ ceco: "LIVE", timestamp: "2026-10-21", type: "salida", code: "M", quantity: 6 }] };
  const recorded = buildLiveProductivity(withRecordedInputs, "2026-10-30")[0];
  assert.equal(recorded.hours, 4);
  assert.equal(recorded.materialCost, 60);
  assert.equal(recorded.laborProductivity, 12.5);
  assert.equal(recorded.materialProductivity, 50 / 60);
  assert.equal(calculateProductivityReport(base, "2026-10-01", "2026-10-31").current.laborProductivity,
    calculateProductivityReport(advanced, "2026-10-01", "2026-10-31").current.laborProductivity);
});

test("cobertura usa el stock de seguridad calculado y el mínimo manual cuando faltan parámetros", () => {
  const inventory = [
    { code: "A", physical: 2, committed: 0, safety: 2, serviceFactor: 2, demandStdDev: 3, leadTimeDays: 4, averageDemand: 2, leadTimeStdDev: 1 },
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

test("productividad multifactorial no depende de energía ni capital", () => {
  const withoutEnergy = { ...dataset, orders: dataset.orders.map((order) => order.ceco === "1" ? { ...order, energyCost: null } : order) };
  const report = calculateProductivityReport(withoutEnergy, "2026-01-01", "2026-01-31");
  assert.equal(report.current.multifactorProductivity, 5);
  const withHighEnergy = { ...dataset, orders: dataset.orders.map((order) => order.ceco === "1" ? { ...order, energyCost: 500, capitalCost: 300 } : order) };
  assert.equal(calculateProductivityReport(withHighEnergy, "2026-01-01", "2026-01-31").current.multifactorProductivity, 5);
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

test("multifactorial usa horas de CECO terminados y normaliza el nombre del trabajador", () => {
  const withOpenWork = {
    ...dataset,
    personnel: [{ name: " Ana ", hourlyCost: 10, hourlyCostBasis: "Estimado: nómina" }],
    operations: [
      { ...dataset.operations[0], hourlyCost: null },
      { ceco: "2", date: "2026-01-10", totalHours: 20, worker: "Ana" }
    ]
  };
  const { current } = calculateProductivityReport(withOpenWork, "2026-01-01", "2026-01-31");
  assert.equal(current.reportedHours, 30);
  assert.equal(current.laborCost, 100);
  assert.equal(current.multifactorProductivity, 5);
  assert.equal(current.estimatedMonetaryInputs, true);
});

test("determina el rango disponible y genera un libro compatible con Excel", () => {
  assert.deepEqual(availableDateRange(dataset), { start: "2026-01-01", end: "2026-01-20" });
  const report = calculateProductivityReport(dataset, "2026-01-01", "2026-01-31");
  const xml = buildExcelReport(report);
  assert.match(xml, /Cumplimiento PMP/);
  assert.match(xml, /Órdenes terminadas/);
  assert.match(xml, /Horas reportadas/);
});
