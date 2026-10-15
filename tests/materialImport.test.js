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
  assert.deepEqual(rows[0].sourceCodes, ["MAT-01"]);
});

test("preserva todos los códigos de origen cuando consolida descripciones equivalentes", () => {
  const rows = consolidateImportedMaterials([
    { code: "AC-01", description: "Acondicionador de metales preparado", physical: 0 },
    { code: "AC-02", description: "ACONDICIONADOR DE METALES PREPARADO", physical: 0 }
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sourceCodes, ["AC-01", "AC-02"]);
});

test("no consolida materiales con medidas numéricas distintas", () => {
  const rows = consolidateImportedMaterials([
    { code: "AR-14", description: "Arandela de presión de 1/4", physical: 0 },
    { code: "AR-532", description: "Arandela de presión de 5/32", physical: 0 }
  ]);

  assert.equal(rows.length, 2);
});

test("encuentra materiales con descripción equivalente aunque cambie el formato", () => {
  const match = findMatchingMaterial(
    [{ code: "MAT-09", description: "Plancha galvanizada 1.5 mm" }],
    { description: "PLANCHA GALVANIZADA - 1.5 MM" }
  );

  assert.equal(match.code, "MAT-09");
});
