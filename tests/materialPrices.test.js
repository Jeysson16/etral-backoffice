import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { parseMaterialPricesWorkbook } from "../src/lib/materialPrices.js";

function priceFile(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["PRECIOS UNITARIOS DE MATERIALES"], [], [],
    ["Código", "Material", "Unidad", "CECO terminados", "Precio unitario S/"],
    ...rows
  ]), "Precios");
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "precios.xlsx");
}

test("la carga de precios solo toma códigos y precios completados", async () => {
  const inventory = [{ code: "A", physical: 8 }, { code: "B", physical: 12 }];
  const rows = await parseMaterialPricesWorkbook(priceFile([
    ["A", "Plancha", "und", 2, 15.5],
    ["B", "Perno", "und", 1, ""]
  ]), inventory);
  assert.deepEqual(rows, [{ code: "A", unitCost: 15.5 }]);
  assert.equal(inventory[0].physical, 8);
});

test("rechaza precios no positivos y materiales ajenos al inventario", async () => {
  const inventory = [{ code: "A" }];
  await assert.rejects(parseMaterialPricesWorkbook(priceFile([["A", "Plancha", "und", 1, 0]]), inventory), /mayor que cero/);
  await assert.rejects(parseMaterialPricesWorkbook(priceFile([["Z", "Plancha", "und", 1, 10]]), inventory), /no existe/);
});

test("reimportar la hoja sin cambiar un estimado conserva su procedencia", async () => {
  const inventory = [{ code: "A", unitCost: 0.25, unitCostBasis: "Estimado: referencia minorista Perú" }];
  await assert.rejects(parseMaterialPricesWorkbook(priceFile([["A", "Remache", "und", 1, 0.25]]), inventory), /No hay precios nuevos/);
  assert.match(inventory[0].unitCostBasis, /^Estimado/);
});
