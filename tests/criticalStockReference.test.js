import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(new URL("../src/data/criticalStockReference.json", import.meta.url), "utf8"));

test("el anexo de materiales críticos conserva los SS calculados en el Excel", () => {
  assert.equal(rows.length, 39);
  assert.equal(new Set(rows.map((row) => row.code)).size, rows.length);
  for (const row of rows) {
    assert.ok(row.decision.startsWith("SÍ"));
    assert.equal(row.safetyStock, Math.ceil(1.6448536269514715 * row.dailyDemand * row.leadTimeStdDev), row.code);
  }
  assert.equal(Math.round(rows.reduce((sum, row) => sum + row.safetyStock * row.unitCost, 0) * 100) / 100, 3850.82);
});
