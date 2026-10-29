import XLSX from "xlsx-js-style";
import { styleWorkbookSheet } from "./excelWorkbookStyle.js";

const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function downloadMaterialPricesWorkbook(dataset) {
  const completed = new Set((dataset.orders ?? []).filter((order) => Number(order.progress) >= 100).map((order) => order.ceco));
  const used = new Map();
  for (const row of dataset.orderMaterialReservations ?? []) {
    if (!completed.has(row.ceco)) continue;
    const cecos = used.get(row.materialCode) ?? new Set();
    cecos.add(row.ceco);
    used.set(row.materialCode, cecos);
  }
  const rows = [...(dataset.inventory ?? [])]
    .sort((a, b) => (used.get(b.code)?.size ?? 0) - (used.get(a.code)?.size ?? 0) || a.code.localeCompare(b.code))
    .map((item) => [item.code, item.description, item.unit, used.get(item.code)?.size ?? 0, item.unitCost ?? "", item.unitCostBasis ?? "Registrado"]);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["PRECIOS UNITARIOS DE MATERIALES"],
    ["Revisa o cambia Precio unitario S/. Solo se importan precios nuevos o modificados; no cambia existencias."],
    [],
    ["Código", "Material", "Unidad", "CECO terminados", "Precio unitario S/", "Origen del costo"],
    ...rows
  ]);
  XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(sheet, { headerRow: 3, titleRow: 0, numberFormats: { 3: "0", 4: "S/ #,##0.00" } }), "Precios");
  XLSX.writeFile(workbook, "precios-materiales-etral.xlsx");
}

export async function parseMaterialPricesWorkbook(file, inventory) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets.Precios;
  if (!sheet) throw new Error("El archivo debe contener la hoja Precios de la plantilla.");
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => normalize(cell) === "codigo")
    && row.some((cell) => ["precio_unitario_s", "costo_unitario", "precio_unitario"].includes(normalize(cell))));
  if (headerIndex < 0) throw new Error("La hoja Precios requiere las columnas Código y Precio unitario S/.");
  const headers = matrix[headerIndex].map(normalize);
  const codeColumn = headers.indexOf("codigo");
  const priceColumn = headers.findIndex((name) => ["precio_unitario_s", "costo_unitario", "precio_unitario"].includes(name));
  const known = new Map((inventory ?? []).map((item) => [item.code, item]));
  const seen = new Set();
  const entries = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index];
    const code = String(row[codeColumn] ?? "").trim();
    const rawPrice = row[priceColumn];
    if (!code || rawPrice === "" || rawPrice == null) continue;
    if (!known.has(code)) throw new Error(`Fila ${index + 1}: el material ${code} no existe en Inventario.`);
    if (seen.has(code)) throw new Error(`Fila ${index + 1}: el material ${code} está repetido.`);
    const price = Number(String(rawPrice).replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Fila ${index + 1}: el precio de ${code} debe ser mayor que cero.`);
    seen.add(code);
    if (Number(known.get(code).unitCost) === price) continue;
    entries.push({ code, unitCost: price });
  }
  if (!entries.length) throw new Error("No hay precios nuevos o modificados para actualizar.");
  return entries;
}
