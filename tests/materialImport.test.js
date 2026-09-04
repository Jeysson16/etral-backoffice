import test from "node:test";
import assert from "node:assert/strict";
import { consolidateImportedMaterials, findMatchingMaterial } from "../src/lib/materialImport.js";

test("consolida cantidades de filas repetidas dentro de un Excel", () => {
  const rows = consolidateImportedMaterials([
    { code: "MAT-01", description: "Plancha galvanizada 1.5 mm", physical: 4 },
    { code: "MAT-01", description: "Plancha galvanizada 1.5 mm", physical: 6 }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].physical, 10);
});

test("encuentra materiales con descripción equivalente aunque cambie el formato", () => {
  const match = findMatchingMaterial(
    [{ code: "MAT-09", description: "Plancha galvanizada 1.5 mm" }],
    { description: "PLANCHA GALVANIZADA - 1.5 MM" }
  );

  assert.equal(match.code, "MAT-09");
});
