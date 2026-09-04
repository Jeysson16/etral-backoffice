import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { addExportTitle, styleWorkbookSheet } from "../src/lib/excelWorkbookStyle.js";

test("da título, encabezados y filtro a una exportación", () => {
  const sheet = XLSX.utils.aoa_to_sheet(addExportTitle([["Código", "Cantidad"], ["MAT-01", 2]], "MATERIALES", "Maestro ETRAL"));
  styleWorkbookSheet(sheet, { headerRow: 3, titleRow: 0, numberFormats: { 1: "#,##0.00" } });

  assert.equal(sheet.A1.v, "MATERIALES");
  assert.equal(sheet.A4.s.font.color.rgb, "FFFFFF");
  assert.equal(sheet.B5.z, "#,##0.00");
  assert.equal(sheet["!autofilter"].ref, "A4:B5");
});
