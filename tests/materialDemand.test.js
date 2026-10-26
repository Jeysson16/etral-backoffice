import test from "node:test";
import assert from "node:assert/strict";
import { deriveMaterialDemand } from "../src/lib/materialDemand.js";

test("estima demanda diaria desde salidas y evita duplicar almacén y consumos", () => {
  const dataset = {
    inventoryMovements: [
      { code: "A", type: "salida", quantity: 4, timestamp: "2026-10-01 09:00" },
      { code: "A", type: "salida", quantity: 2, timestamp: "2026-10-03 09:00" },
      { code: "A", type: "consumo", quantity: 4, timestamp: "2026-10-01 10:00" }
    ],
    warehouse: [{ materialCode: "A", quantity: 4, timestamp: "2026-10-01 09:00" }],
    orders: [{ ceco: "1", bodyTypeId: "P", plannedStartDate: "2026-10-02" }],
    bom: [{ bodyTypeId: "P", materialCode: "A", quantity: 20 }]
  };
  const result = deriveMaterialDemand(dataset, { start: "2026-10-01", end: "2026-10-03" }).get("A");
  assert.equal(result.averageDemand, 2);
  assert.equal(result.demandStdDev, 2);
  assert.equal(result.source, "salidas/consumos registrados");
});

test("usa demanda planificada CECO/BOM solo si no hay salidas", () => {
  const dataset = {
    inventoryMovements: [], warehouse: [],
    orders: [{ ceco: "1", bodyTypeId: "P", plannedStartDate: "2026-10-01" }],
    bom: [{ bodyTypeId: "P", materialCode: "A", quantity: 6 }]
  };
  const result = deriveMaterialDemand(dataset, { start: "2026-10-01", end: "2026-10-03" }).get("A");
  assert.equal(result.averageDemand, 2);
  assert.equal(result.demandStdDev, 3.4641);
  assert.equal(result.source, "demanda planificada CECO/BOM");
});
