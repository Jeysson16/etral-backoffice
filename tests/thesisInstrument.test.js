import test from "node:test";
import assert from "node:assert/strict";
import { scopeDatasetToThesis, summarizeThesisInstrument } from "../src/lib/thesisInstrument.js";

const sample = [
  { phase: "post", ceco: "260350", weightKg: 624.29, laborHours: 65.5, hourlyCost: 4.708333333333333, rawMaterialCost: 1992.12, suppliesCost: 1828.27, outputValue: 11500, energyCost: 1200, capitalCost: 3820.39, workbookMultifactor: 2.158090109019519 },
  { phase: "post", ceco: "260370", weightKg: 624.29, laborHours: 45.25, hourlyCost: 4.708333333333333, rawMaterialCost: 1992.12, suppliesCost: 1828.27, outputValue: 15500, energyCost: null, capitalCost: 3820.39, workbookMultifactor: 3.8428715919952983 }
];

test("el instrumento usa peso, horas y costo por CECO, con promedio de razones", () => {
  const result = summarizeThesisInstrument(sample);
  assert.equal(result.post.count, 2);
  assert.ok(Math.abs(result.rows[0].laborProductivity - 9.531145038167937) < 1e-10);
  assert.ok(Math.abs(result.rows[0].materialProductivity - 0.163410018348912) < 1e-10);
  assert.ok(Math.abs(result.post.labor - (9.531145038167937 + 13.796464088397787) / 2) < 1e-10);
  assert.ok(result.post.multifactor > result.post.workbookMultifactor);
  assert.equal(result.verifiedWorkbookRows, 2);
});

test("el análisis de tesis incluye solo CECO de Post sin alterar órdenes operativas", () => {
  const dataset = {
    thesisMeasurements: [{ phase: "pre", ceco: "260010" }, { phase: "post", ceco: "260350" }],
    orders: [{ ceco: "260350" }, { ceco: "260500" }],
    operations: [{ ceco: "260350" }, { ceco: "260500" }],
    activityProgress: [{ ceco: "260350" }, { ceco: "260500" }],
    orderMaterialReservations: [{ ceco: "260350" }, { ceco: "260500" }],
    inventory: [{ code: "MAT" }]
  };
  const scoped = scopeDatasetToThesis(dataset);
  assert.deepEqual(scoped.orders.map((row) => row.ceco), ["260350"]);
  assert.deepEqual(scoped.operations.map((row) => row.ceco), ["260350"]);
  assert.deepEqual(scoped.activityProgress.map((row) => row.ceco), ["260350"]);
  assert.deepEqual(scoped.orderMaterialReservations.map((row) => row.ceco), ["260350"]);
  assert.equal(scoped.inventory, dataset.inventory);
  assert.equal(dataset.orders.length, 2);
});
