import * as XLSX from "xlsx";

const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const aliases = {
  codigo: "code", codigo_material: "code", codigo_producto: "productCode", codigo_pieza: "pieceCode",
  descripcion: "description", nombre_producto: "name", producto: "name", categoria: "category", unidad: "unit",
  marca: "brand", ubicacion: "location", stock_fisico: "physical", stock_inicial: "physical", stock_seguridad: "safety",
  factor_servicio: "serviceFactor", desviacion_demanda: "demandStdDev", plazo_reposicion_dias: "leadTimeDays",
  costo_unitario: "unitCost", moneda: "currency", familia: "family", unidad_salida: "outputUnit",
  dias_objetivo: "targetDays", ruta_fases: "route", codigo_fase: "stageCode", longitud_mm: "lengthMm", cantidad: "quantity"
};

function rowsFor(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => ["code", "productCode", "description", "name"].includes(aliases[normalize(cell)])));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex];
  return matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== "")).map((row, index) => ({ __row: headerIndex + index + 2, ...Object.fromEntries(headers.map((key, column) => [aliases[normalize(key)] ?? normalize(key), row[column] ?? ""])) }));
}

function text(value) { return String(value ?? "").trim(); }
function numeric(value, defaultValue = 0) {
  if (value === "" || value == null) return defaultValue;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export async function parseCatalogWorkbook(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const materials = rowsFor(workbook, "Materiales").filter((row) => text(row.description)).map((row, index) => ({
    row: row.__row ?? index + 2, code: text(row.code), description: text(row.description), category: text(row.category) || "Sin categoría",
    unit: text(row.unit) || "und", brand: text(row.brand), location: text(row.location), physical: numeric(row.physical),
    safety: numeric(row.safety), serviceFactor: numeric(row.serviceFactor, null), demandStdDev: numeric(row.demandStdDev, null),
    leadTimeDays: numeric(row.leadTimeDays, null), unitCost: numeric(row.unitCost, null), currency: text(row.currency) || "PEN"
  }));
  const products = rowsFor(workbook, "Productos").filter((row) => text(row.code) || text(row.name)).map((row, index) => ({
    row: row.__row ?? index + 2, code: text(row.code), name: text(row.name), family: text(row.family), brand: text(row.brand),
    outputUnit: text(row.outputUnit) || "und", targetDays: numeric(row.targetDays, 1), route: text(row.route).split(";").map(text).filter(Boolean)
  }));
  const bom = rowsFor(workbook, "BOM").filter((row) => text(row.productCode) || text(row.code)).map((row, index) => ({
    row: row.__row ?? index + 2, productCode: text(row.productCode) || text(row.code), materialCode: text(row.code), pieceCode: text(row.pieceCode),
    description: text(row.description), stageCode: text(row.stageCode), lengthMm: numeric(row.lengthMm), quantity: numeric(row.quantity)
  }));
  if (!materials.length && !products.length && !bom.length) throw new Error("No se encontraron registros. Usa las hojas Materiales, Productos y/o BOM de la plantilla.");
  return { materials, products, bom };
}

export function downloadCatalogWorkbook(dataset, type = "all") {
  const workbook = XLSX.utils.book_new();
  if (type === "all" || type === "materials") {
    const rows = dataset.inventory.map((item) => ({
      "Código": item.code, "Descripción": item.description, "Categoría": item.category, "Unidad": item.unit, "Marca": dataset.catalogs.brands.find((brand) => brand.id === item.brandId)?.name ?? "",
      "Ubicación": item.location ?? "", "Stock físico": item.physical, "Stock seguridad": item.safety, "Factor servicio": item.serviceFactor ?? "", "Desviación demanda": item.demandStdDev ?? "", "Plazo reposición días": item.leadTimeDays ?? "", "Costo unitario": item.unitCost ?? "", "Moneda": item.currency ?? "PEN"
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [materialTemplateRow()]), "Materiales");
  }
  if (type === "all" || type === "products") {
    const products = dataset.bodyTypes.map((item) => ({ "Código": item.code, "Nombre producto": item.name, "Familia": item.family, "Marca": dataset.catalogs.brands.find((brand) => brand.id === item.brandId)?.name ?? "", "Unidad salida": item.outputUnit, "Días objetivo": item.targetDays, "Ruta fases": item.route.map((id) => dataset.flowStages.find((stage) => stage.id === id)?.code ?? id).join(";") }));
    const bom = dataset.bom.map((item) => ({ "Código producto": dataset.bodyTypes.find((product) => product.id === item.bodyTypeId)?.code ?? "", "Código material": item.materialCode, "Código pieza": item.pieceCode, "Descripción": item.description, "Código fase": dataset.flowStages.find((stage) => stage.id === item.stageId)?.code ?? item.stageId, "Longitud mm": item.lengthMm ?? 0, "Cantidad": item.quantity }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(products.length ? products : [productTemplateRow()]), "Productos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bom.length ? bom : [bomTemplateRow()]), "BOM");
  }
  XLSX.writeFile(workbook, `etral-${type === "materials" ? "materiales" : type === "products" ? "productos" : "catalogos"}-exportados.xlsx`);
}

export const materialTemplateRow = () => ({ "Código": "Opcional: MAT-0001", "Descripción": "Plancha galvanizada 1.5 mm", "Categoría": "Planchas y perfiles", "Unidad": "und", "Marca": "", "Ubicación": "ALM-A01", "Stock físico": 10, "Stock seguridad": 2, "Factor servicio": 1.65, "Desviación demanda": "", "Plazo reposición días": "", "Costo unitario": 0, "Moneda": "PEN" });
export const productTemplateRow = () => ({ "Código": "PROD-EJ-01", "Nombre producto": "Furgón ejemplo", "Familia": "Furgones", "Marca": "ETRAL", "Unidad salida": "und", "Días objetivo": 15, "Ruta fases": "SUM;HAB;ARM;SOL;PIN;ACA" });
export const bomTemplateRow = () => ({ "Código producto": "PROD-EJ-01", "Código material": "MAT-0001", "Código pieza": "BOM-001", "Descripción": "Plancha galvanizada 1.5 mm", "Código fase": "HAB", "Longitud mm": 0, "Cantidad": 2 });
