import test from "node:test";
import assert from "node:assert/strict";
import { initialDataset } from "../src/data/seed.js";
import { buildMaterialExplosion, calculateSafetyStock, evaluateMrp, inventoryHeatmap, materialRequirementSummary } from "../src/lib/mrp.js";
import { calibrateDigitalTwin, runDigitalTwin } from "../src/lib/simulator.js";

test("explota BOM por carrocería y calcula faltantes", () => {
  const order = initialDataset.orders.find((item) => item.ceco === "260240");
  const explosion = buildMaterialExplosion(order, initialDataset.bodyTypes, initialDataset.bom, initialDataset.inventory);
  assert.ok(explosion.some((item) => item.materialCode === "MAT-0042"));
  assert.ok(explosion.every((item) => item.ceco === "260240"));
});

test("MRP genera alertas cuando disponibilidad queda bajo seguridad", () => {
  const mrp = evaluateMrp(initialDataset.orders, initialDataset.bodyTypes, initialDataset.bom, initialDataset.inventory);
  assert.ok(mrp.alerts.length > 0);
  assert.ok(mrp.alerts.some((alert) => alert.materialCode === "MAT-0042"));
});

test("mapa de calor clasifica stock disponible", () => {
  const heatmap = inventoryHeatmap(initialDataset.inventory, initialDataset.orders, initialDataset.bom);
  const paint = heatmap.find((item) => item.code === "MAT-0042");
  assert.equal(paint.available, 6);
  assert.ok(paint.required > 0);
  assert.equal(paint.projected, paint.physical - paint.required);
  assert.equal(paint.tone, "warning");
});

test("stock de seguridad usa Z por desviación de demanda y raíz del lead time", () => {
  const paint = initialDataset.inventory.find((item) => item.code === "MAT-0042");
  assert.equal(calculateSafetyStock(paint), Math.ceil(paint.serviceFactor * paint.demandStdDev * Math.sqrt(paint.leadTimeDays)));
  assert.equal(calculateSafetyStock(paint), 15);
});

test("requerimiento abierto se calcula desde órdenes activas y BOM", () => {
  const requirements = materialRequirementSummary(initialDataset.orders, initialDataset.bom);
  assert.equal(requirements["MAT-0042"], 24);
  assert.equal(requirements["MAT-0044"], 60);
  assert.equal(requirements["MAT-0126"], 480);
});

test("gemelo digital muestra el efecto de menor disponibilidad de personal", () => {
  const result = runDigitalTwin(initialDataset, { laborAvailability: 45, horizonDays: 7, shiftsPerDay: 1 });
  const baselineAssembly = result.baseline.stageCapacity.find((stage) => stage.stageId === "stage-assembly");
  const scenarioAssembly = result.scenario.stageCapacity.find((stage) => stage.stageId === "stage-assembly");
  assert.ok(scenarioAssembly.availableHours < baselineAssembly.availableHours);
  assert.ok(scenarioAssembly.utilization > baselineAssembly.utilization);
});

test("ajuste simulado de stock cambia la proyección del material elegido", () => {
  const result = runDigitalTwin(initialDataset, { materialCode: "MAT-0042", stockAdjustment: 40 });
  const baseline = result.baseline.materials.find((item) => item.code === "MAT-0042");
  const scenario = result.scenario.materials.find((item) => item.code === "MAT-0042");
  assert.equal(scenario.projected - baseline.projected, 40);
});

test("simulador genera alertas auditables desde indicadores", () => {
  const result = runDigitalTwin(initialDataset, { laborAvailability: 55, horizonDays: 7 });
  assert.ok(result.notifications.length > 0);
  assert.ok(result.notifications.some((item) => item.category === "PMP" && item.equation.includes("órdenes terminables")));
  assert.ok(result.notifications.some((item) => item.category === "Inventario" && item.equation.includes("SS = Z")));
});

test("personal, equipos e incidencias alimentan la capacidad real del gemelo", () => {
  const constrained = runDigitalTwin(initialDataset, { laborAvailability: 100, horizonDays: 14 });
  const unrestrictedDataset = structuredClone(initialDataset);
  unrestrictedDataset.personnel = unrestrictedDataset.personnel.map((item) => ({ ...item, status: "available", efficiency: 100 }));
  unrestrictedDataset.equipment = unrestrictedDataset.equipment.map((item) => ({ ...item, status: "operational" }));
  unrestrictedDataset.incidents = unrestrictedDataset.incidents.map((item) => ({ ...item, status: "resolved" }));
  const unrestricted = runDigitalTwin(unrestrictedDataset, { laborAvailability: 100, horizonDays: 14 });
  const constrainedAssembly = constrained.scenario.stageCapacity.find((item) => item.stageId === "stage-assembly");
  const unrestrictedAssembly = unrestricted.scenario.stageCapacity.find((item) => item.stageId === "stage-assembly");
  assert.ok(constrainedAssembly.availableHours < unrestrictedAssembly.availableHours);
  assert.equal(constrainedAssembly.incidentHours, 4);
});

test("entrenamiento del gemelo digital calcula métricas de calibración desde Supabase", () => {
  const calibration = calibrateDigitalTwin(initialDataset);
  assert.ok(calibration.reliabilityScore > 50);
  assert.ok(calibration.workerInconsistencyStdDev >= 4);
  assert.ok(calibration.sampleSizeOperations > 0);
});

test("parámetros específicos por orden incrementan la demanda en la fase correspondiente", () => {
  const normal = runDigitalTwin(initialDataset, { orderComplexityMap: { "260240": 1.0 } });
  const complex = runDigitalTwin(initialDataset, { orderComplexityMap: { "260240": 2.0 } });
  const normalPaint = normal.scenario.stageCapacity.find((s) => s.stageId === "stage-paint");
  const complexPaint = complex.scenario.stageCapacity.find((s) => s.stageId === "stage-paint");
  assert.ok(complexPaint.demandHours > normalPaint.demandHours);
});

