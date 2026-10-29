import XLSX from "xlsx-js-style";
import { addExportTitle, styleInstructionSheet, styleWorkbookSheet } from "./excelWorkbookStyle.js";
import { calculateSafetyStock } from "./mrp.js";

const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const aliases = {
  codigo: "code", codigo_material: "materialCode", codigo_producto: "productCode", codigo_pieza: "pieceCode",
  descripcion: "description", nombre_producto: "name", producto: "name", categoria: "category", unidad: "unit",
  marca: "brand", ubicacion: "location", stock_fisico: "physical", stock_inicial: "physical", stock_seguridad: "safety",
  factor_servicio: "serviceFactor", factor_z: "serviceFactor", desviacion_demanda: "demandStdDev", desviacion_demanda_s1: "demandStdDev", plazo_reposicion_dias: "leadTimeDays",
  demanda_promedio_dp: "averageDemand", desviacion_lead_time_s2: "leadTimeStdDev", nivel_servicio: "serviceLevel",
  costo_unitario: "unitCost", moneda: "currency", familia: "family", unidad_salida: "outputUnit",
  dias_objetivo: "targetDays", ruta_fases: "route", codigo_fase: "stageCode", codigo_fase_origen: "sourcePhaseCode", fase_origen: "sourcePhaseCode", longitud_mm: "lengthMm", cantidad: "quantity"
};

const bulkAliases = {
  ...aliases,
  marca_producto: "productBrand", marca_material: "brand",
  descripcion_material: "description", nombre_material: "description",
  categoria_material: "category", unidad_material: "unit",
  ubicacion_material: "location", stock_fisico: "physical", stock_seguridad: "safety"
};

function rowsFor(workbook, sheetName, columnAliases = aliases) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = matrix.findIndex((row) => row.some((cell) => ["code", "productCode", "materialCode", "description", "name", "stageCode"].includes(columnAliases[normalize(cell)])));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex];
  return matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== "")).map((row, index) => ({ __row: headerIndex + index + 2, ...Object.fromEntries(headers.map((key, column) => [columnAliases[normalize(key)] ?? normalize(key), row[column] ?? ""])) }));
}

function text(value) { return String(value ?? "").trim(); }
function numeric(value, defaultValue = 0) {
  if (value === "" || value == null) return defaultValue;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function requireCompleteSafetyParameters(materials) {
  for (const material of materials) {
    const fields = ["averageDemand", "demandStdDev", "leadTimeDays", "leadTimeStdDev", "serviceLevel", "serviceFactor"];
    const provided = fields.filter((key) => material[key] !== null);
    if (provided.length && provided.length < fields.length) {
      throw new Error(`Material fila ${material.row}: completa dp, s1, Lt, s2, nivel de servicio y z para calcular el stock de seguridad.`);
    }
    if (provided.length && (material.averageDemand < 0 || material.demandStdDev < 0 || material.leadTimeDays <= 0 || material.leadTimeStdDev < 0
      || material.serviceLevel <= 0 || material.serviceLevel >= 1 || material.serviceFactor <= 0)) {
      throw new Error(`Material fila ${material.row}: dp, s1 y s2 deben ser no negativos; Lt y z positivos; nivel de servicio entre 0 y 1.`);
    }
  }
  return materials;
}

export async function parseCatalogWorkbook(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const bulk = rowsFor(workbook, "Carga masiva", bulkAliases);
  if (bulk.length) return parseBulkWorkbook(bulk);
  const materials = requireCompleteSafetyParameters(rowsFor(workbook, "Materiales").filter((row) => text(row.description)).map((row, index) => ({
    row: row.__row ?? index + 2, code: text(row.code) || text(row.materialCode), description: text(row.description), category: text(row.category) || "Sin categoría",
    unit: text(row.unit) || "und", brand: text(row.brand), location: text(row.location), physical: numeric(row.physical),
    safety: numeric(row.safety), serviceFactor: numeric(row.serviceFactor, null), demandStdDev: numeric(row.demandStdDev, null),
    leadTimeDays: numeric(row.leadTimeDays, null), averageDemand: numeric(row.averageDemand, null), leadTimeStdDev: numeric(row.leadTimeStdDev, null),
    serviceLevel: numeric(row.serviceLevel, null), unitCost: numeric(row.unitCost, null), currency: text(row.currency) || "PEN"
  })));
  const products = rowsFor(workbook, "Productos").filter((row) => text(row.code) || text(row.name)).map((row, index) => ({
    row: row.__row ?? index + 2, code: text(row.code), name: text(row.name), family: text(row.family), brand: text(row.brand),
    outputUnit: text(row.outputUnit) || "und", targetDays: numeric(row.targetDays, 1), route: text(row.route).split(";").map(text).filter(Boolean)
  }));
  const bom = rowsFor(workbook, "BOM").filter((row) => text(row.productCode) || text(row.code)).map((row, index) => ({
    row: row.__row ?? index + 2, productCode: text(row.productCode) || text(row.code), materialCode: text(row.materialCode) || text(row.code), pieceCode: text(row.pieceCode),
    description: text(row.description), stageCode: text(row.stageCode), sourcePhaseCode: text(row.sourcePhaseCode), lengthMm: numeric(row.lengthMm), quantity: numeric(row.quantity)
  }));
  if (!materials.length && !products.length && !bom.length) throw new Error("No se encontraron registros. Usa las hojas Materiales, Productos y/o BOM de la plantilla.");
  return { materials, products, bom, mode: "pestañas" };
}

function parseBulkWorkbook(rows) {
  const productsByCode = new Map();
  const materialsByKey = new Map();
  const bomByKey = new Map();

  rows.forEach((row, index) => {
    const line = row.__row ?? index + 2;
    const productCode = text(row.productCode);
    const stageCode = text(row.stageCode);
    if (!productCode || !text(row.name) || !text(row.family) || !stageCode) {
      throw new Error(`Carga masiva fila ${line}: código, nombre y familia del producto, y código de fase son obligatorios.`);
    }

    const product = productsByCode.get(productCode) ?? {
      row: line, code: productCode, name: text(row.name), family: text(row.family), brand: text(row.productBrand),
      outputUnit: text(row.outputUnit) || "und", targetDays: numeric(row.targetDays, 1), route: []
    };
    if (!product.route.includes(stageCode)) product.route.push(stageCode);
    productsByCode.set(productCode, product);

    const materialCode = text(row.materialCode);
    const description = text(row.description);
    if (!materialCode && !description) return;
    if (!materialCode || !description) throw new Error(`Carga masiva fila ${line}: cada material requiere código y descripción.`);

    const material = {
      row: line, code: materialCode, description, category: text(row.category) || "Sin categoría", unit: text(row.unit) || "und",
      brand: text(row.brand), location: text(row.location), physical: numeric(row.physical), safety: numeric(row.safety),
      serviceFactor: numeric(row.serviceFactor, null), demandStdDev: numeric(row.demandStdDev, null), leadTimeDays: numeric(row.leadTimeDays, null),
      averageDemand: numeric(row.averageDemand, null), leadTimeStdDev: numeric(row.leadTimeStdDev, null), serviceLevel: numeric(row.serviceLevel, null),
      unitCost: numeric(row.unitCost, null), currency: text(row.currency) || "PEN"
    };
    materialsByKey.set(materialCode, material);

    const quantity = numeric(row.quantity, 0);
    if (quantity <= 0) throw new Error(`Carga masiva fila ${line}: la cantidad del material debe ser mayor que cero.`);
    const pieceCode = text(row.pieceCode) || `AUTO-${productCode}-${stageCode}-${materialCode}`;
    const key = `${productCode}::${pieceCode}`;
    if (bomByKey.has(key)) throw new Error(`Carga masiva fila ${line}: el código de pieza ${pieceCode} se repite para ${productCode}.`);
    bomByKey.set(key, {
      row: line, productCode, materialCode, pieceCode, description, stageCode, sourcePhaseCode: text(row.sourcePhaseCode), lengthMm: numeric(row.lengthMm), quantity
    });
  });

  return { materials: requireCompleteSafetyParameters([...materialsByKey.values()]), products: [...productsByCode.values()], bom: [...bomByKey.values()], mode: "carga masiva" };
}

export function downloadCatalogWorkbook(dataset, type = "all") {
  const workbook = XLSX.utils.book_new();
  if (type === "all" || type === "materials") {
    const rows = dataset.inventory.map((item) => ({
      "Código": item.code, "Descripción": item.description, "Categoría": item.category, "Unidad": item.unit, "Marca": dataset.catalogs.brands.find((brand) => brand.id === item.brandId)?.name ?? "",
      "Ubicación": item.location ?? "", "Stock físico": item.physical, "Stock seguridad": calculateSafetyStock(item), "Demanda promedio dp": item.averageDemand ?? "", "Desviación demanda s1": item.demandStdDev ?? "", "Plazo reposición días": item.leadTimeDays ?? "", "Desviación lead time s2": item.leadTimeStdDev ?? "", "Nivel servicio": item.serviceLevel ?? "", "Factor z": item.serviceFactor ?? "", "Costo unitario": item.unitCost ?? "", "Origen costo": item.unitCostBasis ?? "Registrado", "Origen SS": item.safetyParametersBasis ?? "Registrado", "Moneda": item.currency ?? "PEN"
    }));
    const sheet = XLSX.utils.json_to_sheet(addExportTitle(rows.length ? rows : [materialTemplateRow()], "MATERIALES", "Maestro de inventario"));
    XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(sheet, { headerRow: 3, titleRow: 0, numberFormats: { 6: "#,##0.00", 7: "#,##0.00", 8: "0.00", 9: "0.00", 10: "0.00", 11: "0.00", 12: "0.00%", 13: "0.000", 14: "S/ #,##0.00" } }), "Materiales");
  }
  if (type === "all" || type === "products") {
    const products = dataset.bodyTypes.map((item) => ({ "Código": item.code, "Nombre producto": item.name, "Familia": item.family, "Marca": dataset.catalogs.brands.find((brand) => brand.id === item.brandId)?.name ?? "", "Unidad salida": item.outputUnit, "Días objetivo": item.targetDays, "Ruta fases": item.route.map((id) => dataset.flowStages.find((stage) => stage.id === id)?.code ?? id).join(";") }));
    const bom = dataset.bom.map((item) => ({ "Código producto": dataset.bodyTypes.find((product) => product.id === item.bodyTypeId)?.code ?? "", "Código material": item.materialCode, "Código pieza": item.pieceCode, "Descripción": item.description, "Código fase": dataset.flowStages.find((stage) => stage.id === item.stageId)?.code ?? item.stageId, "Código fase origen": item.sourcePhaseCode ?? "", "Longitud mm": item.lengthMm ?? 0, "Cantidad": item.quantity }));
    const productSheet = XLSX.utils.json_to_sheet(addExportTitle(products.length ? products : [productTemplateRow()], "PRODUCTOS", "Plantillas maestras y rutas de fabricación"));
    XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(productSheet, { headerRow: 3, titleRow: 0, numberFormats: { 5: "0" } }), "Productos");
    const bomSheet = XLSX.utils.json_to_sheet(addExportTitle(bom.length ? bom : [bomTemplateRow()], "LISTA DE MATERIALES (BOM)", "Material requerido por producto y fase"));
    XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(bomSheet, { headerRow: 3, titleRow: 0, numberFormats: { 5: "#,##0.00", 6: "#,##0.00" } }), "BOM");
  }
  XLSX.writeFile(workbook, `control-${type === "materials" ? "materiales" : type === "products" ? "productos" : "catalogos"}-exportados.xlsx`);
}

export function downloadBulkImportWorkbook(dataset) {
  const workbook = XLSX.utils.book_new();
  const rows = dataset.bom.map((piece) => {
    const product = dataset.bodyTypes.find((item) => item.id === piece.bodyTypeId);
    const material = dataset.inventory.find((item) => item.code === piece.materialCode);
    const stage = dataset.flowStages.find((item) => item.id === piece.stageId);
    return {
      "Código producto": product?.code ?? "", "Nombre producto": product?.name ?? "", "Familia": product?.family ?? "",
      "Marca producto": dataset.catalogs.brands.find((brand) => brand.id === product?.brandId)?.name ?? "", "Unidad salida": product?.outputUnit ?? "und", "Días objetivo": product?.targetDays ?? 1,
      "Código fase": stage?.code ?? "", "Código material": material?.code ?? piece.materialCode, "Descripción material": material?.description ?? piece.description,
      "Categoría material": material?.category ?? "Sin categoría", "Unidad material": material?.unit ?? "und", "Marca material": dataset.catalogs.brands.find((brand) => brand.id === material?.brandId)?.name ?? "",
      "Ubicación material": material?.location ?? "", "Stock físico": material?.physical ?? 0, "Stock seguridad": material ? calculateSafetyStock(material) : 0,
      "Código pieza": piece.pieceCode ?? "", "Código fase origen": piece.sourcePhaseCode ?? "", "Longitud mm": piece.lengthMm ?? 0, "Cantidad": piece.quantity
    };
  });
  const bulkSheet = XLSX.utils.json_to_sheet(addExportTitle(rows.length ? rows : [bulkTemplateRow()], "CARGA MASIVA", "Una fila por material y fase del producto"));
  XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(bulkSheet, { headerRow: 3, titleRow: 0, numberFormats: { 5: "0", 13: "#,##0.00", 14: "#,##0.00", 16: "#,##0.00", 17: "#,##0.00" } }), "Carga masiva");
  const stagesSheet = XLSX.utils.json_to_sheet(addExportTitle(dataset.flowStages.map((stage) => ({ "Código fase": stage.code, "Nombre fase": stage.name, "Orden": stage.order + 1 })), "FASES DISPONIBLES", "Códigos válidos para la carga masiva"));
  XLSX.utils.book_append_sheet(workbook, styleWorkbookSheet(stagesSheet, { headerRow: 3, titleRow: 0, numberFormats: { 2: "0" } }), "Fases disponibles");
  const instructionsSheet = XLSX.utils.aoa_to_sheet([
    ["Cómo cargar"],
    ["Completa una fila por material que se consume en una fase del producto."],
    ["Puedes repetir producto y fase. La aplicación agrupa las fases en la ruta y crea o actualiza los materiales y el BOM."],
    ["Usa los códigos de la hoja Fases disponibles. Si dejas Código pieza vacío, se genera uno estable automáticamente."],
    ["Para una fase sin material, deja vacías las columnas de material, pieza, longitud y cantidad."],
    ["No cambies los encabezados de la hoja Carga masiva."]
  ]);
  XLSX.utils.book_append_sheet(workbook, styleInstructionSheet(instructionsSheet), "Instrucciones");
  XLSX.writeFile(workbook, "carga-masiva-productos-materiales.xlsx");
}

export const materialTemplateRow = () => ({ "Código": "Opcional: MAT-0001", "Descripción": "Plancha galvanizada 1.5 mm", "Categoría": "Planchas y perfiles", "Unidad": "und", "Marca": "", "Ubicación": "ALM-A01", "Stock físico": 10, "Stock seguridad": 2, "Demanda promedio dp": "", "Desviación demanda s1": "", "Plazo reposición días": "", "Desviación lead time s2": "", "Nivel servicio": "", "Factor z": "", "Costo unitario": 0, "Moneda": "PEN" });
export const productTemplateRow = () => ({ "Código": "PROD-EJ-01", "Nombre producto": "Furgón ejemplo", "Familia": "Furgones", "Marca": "", "Unidad salida": "und", "Días objetivo": 15, "Ruta fases": "SUM;HAB;ARM;SOL;PIN;ACA" });
export const bomTemplateRow = () => ({ "Código producto": "PROD-EJ-01", "Código material": "MAT-0001", "Código pieza": "BOM-001", "Descripción": "Plancha galvanizada 1.5 mm", "Código fase": "HAB", "Código fase origen": "1", "Longitud mm": 0, "Cantidad": 2 });
export const bulkTemplateRow = () => ({ "Código producto": "PROD-EJ-01", "Nombre producto": "Furgón ejemplo", "Familia": "Furgones", "Marca producto": "", "Unidad salida": "und", "Días objetivo": 15, "Código fase": "HAB", "Código fase origen": "1", "Código material": "MAT-0001", "Descripción material": "Plancha galvanizada 1.5 mm", "Categoría material": "Planchas y perfiles", "Unidad material": "und", "Marca material": "", "Ubicación material": "ALM-A01", "Stock físico": 10, "Stock seguridad": 2, "Demanda promedio dp": "", "Desviación demanda s1": "", "Plazo reposición días": "", "Desviación lead time s2": "", "Nivel servicio": "", "Factor z": "", "Código pieza": "", "Longitud mm": 0, "Cantidad": 2 });
