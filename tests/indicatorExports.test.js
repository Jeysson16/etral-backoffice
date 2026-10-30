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

test("libro de indicadores exporta SS y ROP con la fórmula del Excel", () => {
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
  assert.equal(productivity[4][13], 80);
  assert.equal(productivity[4][14], 20);
  assert.equal(productivity[4][15], 100);
  assert.equal(productivity[4][18], 1000 / (20 + 80));
  assert.equal(stock[4][3], 5);
  assert.equal(stock[4][5], 3);
  assert.equal(stock[4][7], 1);
  assert.equal(stock[4][10], Math.ceil(1.65 * 3 * 1));
  assert.equal(stock[4][11], 3 * 4 + stock[4][10]);
  assert.equal(stock[4][12], stock[4][10]);
  assert.equal(summary.find((row) => row[0] === "average_delivery_delay")[2], 2);
});

test("el libro conserva las lecturas del instrumento y su promedio por CECO", () => {
  const dataset = fixture();
  dataset.thesisMeasurements = [{ phase: "post", ceco: "260350", date: "2026-06-08", product: "Baranda Mixta", weightKg: 624.29, workers: 8, laborHours: 65.5, hourlyCost: 4.708333333333333, rawMaterialCost: 1992.12, suppliesCost: 1828.27, outputValue: 11500, energyCost: 1200, workbookMultifactor: 2.158090109019519, sourceSheet: "Post MO y MAT ", sourceRow: 8 }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Instrumento tesis"], { header: 1 });
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Resumen, { header: 1 });
  const ceco = rows.find((row) => row[0] === "post" && row[1] === "260350");
  assert.equal(ceco[4], 624.29);
  assert.ok(Math.abs(rows.at(-1)[13] - 624.29 / 65.5) < 1e-10);
  assert.equal(summary.find((row) => row[0] === "instrument_multifactor_excel")[2], 2.158090109019519);
});

test("la ficha de stock deja sin valor SS y ROP si faltan d o σLT", () => {
  const dataset = fixture();
  delete dataset.inventory[0].averageDemand;
  delete dataset.inventory[0].leadTimeStdDev;
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const stock = XLSX.utils.sheet_to_json(workbook.Sheets["Stock seguridad"], { header: 1 });
  assert.equal(stock[4][10], "");
  assert.equal(stock[4][11], "");
  assert.match(stock[4][13], /faltan d, σLT/i);
  assert.equal(stock[4][12], 5);
});

test("la ficha estima d desde CECO/BOM y muestra su procedencia", () => {
  const dataset = fixture();
  delete dataset.inventory[0].averageDemand;
  delete dataset.inventory[0].demandStdDev;
  dataset.bom = [{ bodyTypeId: "body-1", materialCode: "MAT-1", quantity: 31 }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const stock = XLSX.utils.sheet_to_json(workbook.Sheets["Stock seguridad"], { header: 1 });
  assert.equal(stock[4][5], 1);
  assert.equal(stock[4][6], 4);
  assert.match(stock[4][13], /demanda planificada CECO\/BOM/);
  assert.equal(stock[4][10], 2);
  assert.equal(stock[4][11], 6);
  assert.equal(stock[4][12], 5);
});

test("la ficha de productividad toma salidas por CECO sin duplicar reservas", () => {
  const dataset = fixture();
  dataset.orderMaterialReservations[0].consumedQuantity = 0;
  dataset.inventoryMovements = [{ ceco: "CECO-1", type: "salida", code: "MAT-1", quantity: 4, timestamp: "2026-10-21" }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][10], 20);
  assert.match(rows[4][19], /Salidas por CECO/);
});

test("la ficha de productividad usa la tarifa registrada del trabajador", () => {
  const dataset = fixture();
  delete dataset.operations[0].hourlyCost;
  dataset.personnel = [{ name: "Ana", hourlyCost: 10 }];
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][6], 10);
  assert.equal(rows[4][18], 1000 / (20 + 80));
});

test("la ficha reconoce material imputado por avance del CECO", () => {
  const dataset = fixture();
  dataset.orderMaterialReservations[0].consumedQuantity = 0;
  dataset.orderMaterialReservations[0].requiredQuantity = 4;
  const workbook = buildIndicatorsWorkbook(dataset, calculateProductivityReport(dataset, range.start, range.end), range);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ficha productividad"], { header: 1 });
  assert.equal(rows[4][10], 20);
  assert.match(rows[4][19], /Avance de fase\/BOM/);
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
