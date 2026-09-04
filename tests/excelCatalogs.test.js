import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseCatalogWorkbook } from "../src/lib/excelCatalogs.js";

function workbookFile(sheets) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name));
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "carga.xlsx");
}

test("interpreta una carga masiva por producto, fase y material", async () => {
  const file = workbookFile({
    "Carga masiva": [
      { "Código producto": "FUR-01", "Nombre producto": "Furgón", Familia: "Furgones", "Código fase": "HAB", "Código material": "MAT-01", "Descripción material": "Plancha", "Unidad material": "und", Cantidad: 2 },
      { "Código producto": "FUR-01", "Nombre producto": "Furgón", Familia: "Furgones", "Código fase": "ARM", "Código material": "MAT-02", "Descripción material": "Perfil", "Unidad material": "m", "Código pieza": "PERFIL-01", Cantidad: 4 }
    ]
  });

  const result = await parseCatalogWorkbook(file);

  assert.equal(result.mode, "carga masiva");
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].route, ["HAB", "ARM"]);
  assert.equal(result.materials.length, 2);
  assert.equal(result.bom[0].pieceCode, "AUTO-FUR-01-HAB-MAT-01");
  assert.equal(result.bom[1].pieceCode, "PERFIL-01");
});

test("mantiene el código de material de la pestaña BOM tradicional", async () => {
  const file = workbookFile({
    BOM: [{ "Código producto": "FUR-01", "Código material": "MAT-01", "Código pieza": "PZ-01", "Código fase": "HAB", Cantidad: 1 }]
  });

  const result = await parseCatalogWorkbook(file);

  assert.equal(result.bom[0].productCode, "FUR-01");
  assert.equal(result.bom[0].materialCode, "MAT-01");
});
