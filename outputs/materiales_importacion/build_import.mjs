import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "file:///C:/Users/Jeysson/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const sources = [
  {
    path: "C:/Users/Jeysson/Downloads/LISTA_DE_MATERIALES_FURGON_ACANALADO.xlsx",
    productCode: "PROD-FAC",
    prefix: "FAC",
    existingPieces: ["PZA-1101", "PZA-1102", "PZA-1103", "PZA-1104", "PZA-1105", "PZA-1106", "PZA-1107", "PZA-1108"],
    phases: { 1: "CUT", 2: "PRE", 3: "ASM", 4: "ASM", 5: "ASM", 7: "DRS", 8: "PNT", 9: "DRS", 10: "MNT", 11: "SYS", 12: "SYS", 13: "MNT", 14: "DEL" },
  },
  {
    path: "C:/Users/Jeysson/Downloads/LISTA_DE_MATERIALES_FURGON_LISO.xlsx",
    productCode: "PROD-FLI",
    prefix: "FLI",
    existingPieces: ["PZA-1201", "PZA-1203", "PZA-1204", "PZA-1205"],
    phases: { 1: "CUT", 2: "PRE", 4: "ASM", 5: "PNT", 6: "DRS", 7: "MNT", 8: "SYS", 9: "DEL" },
  },
  {
    path: "C:/Users/Jeysson/Downloads/LISTA_DE_MATERIALES_BARANDA_MIXTA.xlsx",
    productCode: "PROD-BMI",
    prefix: "BMI",
    existingPieces: ["PZA-3101", "PZA-3102", "PZA-3103", "PZA-3104", "PZA-3105"],
    phases: { 1: "CUT", 2: "PRE", 3: "ASM", 4: "ASM", 5: "ASM", 6: "MNT", 7: "PNT", 8: "DRS", 9: "SYS", 10: "SYS", 11: "MNT", 12: "DEL" },
  },
  {
    path: "C:/Users/Jeysson/Downloads/LISTA_DE_MATERIALES_BARANDA_TELERA.xlsx",
    productCode: "PROD-BTE",
    prefix: "BTE",
    existingPieces: ["PZA-4101", "PZA-4102", "PZA-4103"],
    phases: { 1: "CUT", 2: "PRE", 3: "ASM", 4: "ASM", 5: "ASM", 6: "MNT", 7: "PNT", 8: "DRS", 9: "SYS", 10: "SYS", 11: "DEL", 12: "SYS" },
  },
  {
    path: "C:/Users/Jeysson/Downloads/LISTA_DE_MATERIALES_PLATAFORMA.xlsx",
    productCode: "PROD-PLT",
    prefix: "PLA",
    existingPieces: ["PZA-5101", "PZA-5102", "PZA-5103"],
    phases: { 1: "CUT", 2: "PRE", 3: "ASM", 4: "ASM", 5: "ASM", 6: "MNT", 7: "PNT", 9: "SYS", 10: "SYS", 11: "DEL" },
  },
];

const materials = [];
const bom = [];
const summary = [];

for (const source of sources) {
  const input = await FileBlob.load(source.path);
  const sourceWorkbook = await SpreadsheetFile.importXlsx(input);
  const sheet = sourceWorkbook.worksheets.getItemAt(0);
  const rows = sheet.getRange("A1:J300").values.slice(1).filter((row) => row.some((value) => value !== null && value !== ""));
  let rowNumber = 0;
  const phaseCounts = new Map();
  for (const row of rows) {
    rowNumber += 1;
    const description = String(row[2] ?? "").trim();
    const category = String(row[3] ?? "Sin categoría").trim() || "Sin categoría";
    const phaseNumber = Number(row[4]);
    const sourceCode = String(row[5] ?? "").trim();
    const unit = String(row[7] ?? "und").trim().toLowerCase() || "und";
    const quantity = Number(row[9]);
    const stageCode = source.phases[phaseNumber];
    if (!description || !sourceCode || !stageCode || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${source.prefix} fila ${rowNumber + 1}: registro inválido (material, código, fase o cantidad).`);
    }
    materials.push([sourceCode, description, category, unit, "", "", 0, 0, "", "", "", "", "PEN"]);
    const pieceCode = source.existingPieces[rowNumber - 1] ?? `IMP-${source.prefix}-${String(rowNumber).padStart(3, "0")}`;
    bom.push([source.productCode, sourceCode, pieceCode, description, stageCode, String(phaseNumber), 0, quantity, category, unit]);
    phaseCounts.set(stageCode, (phaseCounts.get(stageCode) ?? 0) + 1);
  }
  summary.push([source.productCode, source.prefix, rows.length, [...phaseCounts.entries()].map(([k, v]) => `${k}:${v}`).join(" · ")]);
}

const workbook = Workbook.create();
const materialSheet = workbook.worksheets.add("Materiales");
const bomSheet = workbook.worksheets.add("BOM");
const controlSheet = workbook.worksheets.add("Control");

const materialHeaders = [["Código", "Descripción", "Categoría", "Unidad", "Marca", "Ubicación", "Stock físico", "Stock seguridad", "Factor servicio", "Desviación demanda", "Plazo reposición días", "Costo unitario", "Moneda"]];
const bomHeaders = [["Código producto", "Código material", "Código pieza", "Descripción", "Código fase", "Código fase origen", "Longitud mm", "Cantidad"]];
const controlHeaders = [["Producto Etral", "Lista origen", "Componentes", "Distribución por fase"]];
materialSheet.getRange("A1").write([...materialHeaders, ...materials]);
bomSheet.getRange("A1").write([...bomHeaders, ...bom.map((row) => row.slice(0, 8))]);
controlSheet.getRange("A1").write([...controlHeaders, ...summary]);

for (const [sheet, columns] of [[materialSheet, "A1:M" + (materials.length + 1)], [bomSheet, "A1:H" + (bom.length + 1)], [controlSheet, "A1:D" + (summary.length + 1)]]) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  const used = sheet.getRange(columns);
  used.format.font = { name: "Arial", size: 10, color: "#172033" };
  used.format.verticalAlignment = "center";
  const header = sheet.getRange(columns.replace(/1:[A-Z]+\d+$/, "1:" + columns.match(/:([A-Z]+)/)[1] + "1"));
  header.format.fill = "#143A5A";
  header.format.font = { name: "Arial", size: 10, bold: true, color: "#FFFFFF" };
  header.format.horizontalAlignment = "center";
  header.format.rowHeight = 24;
}

materialSheet.getRange(`A1:M${materials.length + 1}`).format.autofitColumns();
bomSheet.getRange(`A1:H${bom.length + 1}`).format.autofitColumns();
controlSheet.getRange(`A1:D${summary.length + 1}`).format.autofitColumns();
materialSheet.getRange(`B2:B${materials.length + 1}`).format.columnWidth = 42;
materialSheet.getRange(`C2:C${materials.length + 1}`).format.columnWidth = 24;
bomSheet.getRange(`D2:D${bom.length + 1}`).format.columnWidth = 42;
controlSheet.getRange(`D2:D${summary.length + 1}`).format.columnWidth = 55;
materialSheet.getRange(`G2:L${materials.length + 1}`).format.numberFormat = "#,##0.00";
bomSheet.getRange(`G2:H${bom.length + 1}`).format.numberFormat = "#,##0.00";

workbook.recalculate();
const outputPath = "C:/Users/Jeysson/Documents/Etral/outputs/materiales_importacion/etral-importacion-bom-normalizada.xlsx";
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const preview = await workbook.render({ sheetName: "Control", range: "A1:D6", scale: 1.5, format: "png" });
await fs.writeFile("C:/Users/Jeysson/Documents/Etral/outputs/materiales_importacion/control-preview.png", new Uint8Array(await preview.arrayBuffer()));

const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
const check = await workbook.inspect({ kind: "table", range: "Control!A1:D6", include: "values,formulas", tableMaxRows: 10, tableMaxCols: 6 });

const sqlLiteral = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const materialValues = bom.map((row) => `  (${sqlLiteral(row[1])}, ${sqlLiteral(row[3])}, ${sqlLiteral(row[8])}, ${sqlLiteral(row[9])})`).join(",\n");
const bomValues = bom.map((row) => `  (${sqlLiteral(row[0])}, ${sqlLiteral(row[2])}, ${sqlLiteral(row[1])}, ${sqlLiteral(row[3])}, ${sqlLiteral(row[4])}, ${sqlLiteral(row[5])}, ${Number(row[7])})`).join(",\n");
const migrationPath = "C:/Users/Jeysson/Documents/Etral/supabase/migrations/20261015230000_preserve_excel_bom_phases.sql";
const migration = `-- Conserva el código de fase original y cada código de material de los cinco Excel fuente.
alter table public.bom_items add column if not exists source_phase_code text;

create temporary table etral_excel_material_source (
  material_code text primary key,
  description text not null,
  category text not null,
  unit text not null
) on commit drop;

insert into etral_excel_material_source(material_code, description, category, unit) values
${materialValues};

insert into public.inventory_items(id, code, category, description, physical, committed, safety, unit, currency)
select 'inv-' || lower(source.material_code), source.material_code, source.category, source.description, 0, 0, 0, source.unit, 'PEN'
from etral_excel_material_source source
on conflict (code) do update
set category = excluded.category,
    description = excluded.description,
    unit = excluded.unit;

create temporary table etral_excel_bom_source (
  product_code text not null,
  piece_code text not null,
  material_code text not null,
  description text not null,
  stage_code text not null,
  source_phase_code text not null,
  quantity numeric not null,
  primary key(product_code, piece_code)
) on commit drop;

insert into etral_excel_bom_source(product_code, piece_code, material_code, description, stage_code, source_phase_code, quantity) values
${bomValues};

do $$
declare
  updated_rows integer;
begin
  update public.bom_items bom
  set material_code = source.material_code,
      description = source.description,
      stage_id = stage.id,
      source_phase_code = source.source_phase_code,
      quantity = source.quantity
  from etral_excel_bom_source source
  join public.body_types product on product.code = source.product_code
  join public.flow_stages stage on stage.code = source.stage_code
  where bom.body_type_id = product.id
    and bom.piece_code = source.piece_code;

  get diagnostics updated_rows = row_count;
  if updated_rows <> 531 then
    raise exception 'Se esperaban 531 componentes BOM actualizados desde Excel, pero se actualizaron %', updated_rows;
  end if;
end $$;

do $$
declare
  mismatches integer;
begin
  select count(*) into mismatches
  from etral_excel_bom_source source
  join public.body_types product on product.code = source.product_code
  left join public.bom_items bom
    on bom.body_type_id = product.id
   and bom.piece_code = source.piece_code
  left join public.flow_stages stage on stage.id = bom.stage_id
  where bom.id is null
     or bom.material_code <> source.material_code
     or bom.description <> source.description
     or stage.code <> source.stage_code
     or bom.source_phase_code <> source.source_phase_code
     or bom.quantity <> source.quantity;

  if mismatches <> 0 then
    raise exception 'La validación BOM contra los Excel encontró % diferencias', mismatches;
  end if;
end $$;
`;
await fs.writeFile(migrationPath, migration, "utf8");

console.log(JSON.stringify({ outputPath, migrationPath, materials: materials.length, bom: bom.length, summary, errors: errors.ndjson, check: check.ndjson }, null, 2));
