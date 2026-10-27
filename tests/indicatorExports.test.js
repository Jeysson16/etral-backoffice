import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { calculateProductivityReport } from "../src/lib/productivity.js";
import { buildIndicatorsWorkbook } from "../src/lib/indicatorExports.js";

const range = { start: "2026-10-01", end: "2026-10-31" };

function fixture() {
  return {
    orders: [{ ceco: "CECO-1", bodyTypeId: "body-1", customer: "Cliente", dueDate: "2026-10-20", actualDeliveryDate: "2026-10-22", progress: 100, outputValue: 1000, energyCost: 50, capitalCost: 30 }],
    bodyTypes: [{ id: "body-1", name: "Furgón" }],
    operations: [{ ceco: "CECO-1", date: "2026-10-21", worker: "Ana", totalHours: 8, hourlyCost: 10 }],
    activityProgress: [{ ceco: "CECO-1", startedAt: "2026-10-21", status: "completed", progress: 100 }],
    inventoryMovements: [],
    inventory: [{ code: "MAT-1", description: "Plancha", unit: "und", physical: 20, committed: 2, safety: 5, serviceFactor: 1.65, demandStdDev: 2, leadTimeDays: 4, averageDemand: 3, leadTimeStdDev: 1, serviceLevel: 0.95, unitCost: 5 }],
    orderMaterialReservations: [{ ceco: "CECO-1", materialCode: "MAT-1", consumedQuantity: 4 }],
    stageActivities: []
  };
}

test("libro de tesis expone valores por ficha y distingue SS de tesis del operativo", () => {
  const dataset = fixture();
  const report = calculateProductivityReport(dataset, range.start, range.end);
  const workbook = XLSX.read(XLSX.write(buildIndicatorsWorkbook(dataset, report, range), { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const plan = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha plan maestro"], { header: 1 });
  const productivity = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  const stock = XLSX.utils.sheet_to_json(workbook.Sheets["Stock seguridad"], { header: 1 });
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets["Resumen"], { header: 1 });
  assert.equal(plan[4][6], 2);
  assert.equal(plan[4][9], 100);
  assert.equal(plan[4][12], 100);
  assert.equal(productivity[4][5], 8);
  assert.equal(productivity[4][10], 20);
  assert.equal(productivity[4][15], 1000 / (20 + 80 + 50 + 30));
  assert.equal(stock[4][3], 3);
  assert.equal(stock[4][6], 1);
  assert.equal(stock[4][9], Math.ceil(1.65 * Math.sqrt(2 ** 2 * 4 + 1 ** 2 * 3 ** 2)));
  assert.equal(stock[4][10], stock[4][9]);
  assert.equal(summary.find((row) => row[0] === "average_delivery_delay")[2], 2);
});

test("la ficha de stock deja sin valor el SS de tesis si faltan dp o s2", () => {
  const dataset = fixture();
  delete dataset.inventory[0].averageDemand;
  delete dataset.inventory[0].leadTimeStdDev;
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const stock = XLSX.utils.sheet_to_json(workbook.Sheets["Stock seguridad"], { header: 1 });
  assert.equal(stock[4][9], "");
  assert.match(stock[4][11], /falta dp, s2/);
  assert.equal(stock[4][10], 5);
});

test("la ficha estima dp y s1 desde CECO/BOM y muestra su procedencia", () => {
  const dataset = fixture();
  delete dataset.inventory[0].averageDemand;
  delete dataset.inventory[0].demandStdDev;
  dataset.bom = [{ bodyTypeId: "body-1", materialCode: "MAT-1", quantity: 31 }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const stock = XLSX.utils.sheet_to_json(workbook.Sheets["Stock seguridad"], { header: 1 });
  assert.equal(stock[4][3], 1);
  assert.equal(stock[4][4], 5.5678);
  assert.match(stock[4][11], /demanda planificada CECO\/BOM/);
  assert.notEqual(stock[4][9], "");
  assert.equal(stock[4][10], 5);
});

test("la ficha de productividad toma salidas por CECO sin duplicar reservas", () => {
  const dataset = fixture();
  dataset.orderMaterialReservations[0].consumedQuantity = 0;
  dataset.inventoryMovements = [{ ceco: "CECO-1", type: "salida", code: "MAT-1", quantity: 4, timestamp: "2026-10-21" }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][10], 20);
  assert.match(rows[4][16], /Salidas por CECO/);
});

test("la ficha de productividad usa la tarifa registrada del trabajador", () => {
  const dataset = fixture();
  delete dataset.operations[0].hourlyCost;
  dataset.personnel = [{ name: "Ana", hourlyCost: 10 }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][6], 10);
  assert.equal(rows[4][15], 1000 / (20 + 80 + 50 + 30));
});

test("la ficha reconoce material imputado por avance del CECO", () => {
  const dataset = fixture();
  dataset.orderMaterialReservations[0].consumedQuantity = 0;
  dataset.orderMaterialReservations[0].requiredQuantity = 4;
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][10], 20);
  assert.match(rows[4][16], /Avance de fase\/BOM/);
});

test("la ficha y el microdato de avance usan el fin de una actividad terminada", () => {
  const dataset = fixture();
  dataset.activityProgress[0].startedAt = "2026-09-29";
  dataset.activityProgress[0].finishedAt = "2026-10-21";
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const plan = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha plan maestro"], { header: 1 });
  const progress = XLSX.utils.sheet_to_json(workbook.Sheets["Avance actividades"], { header: 1 });
  assert.equal(plan[4][10], 1);
  assert.equal(progress.length, 5);
  assert.equal(progress[4][5], "2026-10-21");
});
