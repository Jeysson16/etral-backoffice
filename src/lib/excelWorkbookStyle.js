import * as XLSX from "xlsx";

const NAVY = "20384F";
const ORANGE = "D95D19";
const LIGHT = "F3F6F8";
const BORDER = "D9E1E8";
const SUBTLE = "667789";

function cell(sheet, row, column) {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  return sheet[address] || (sheet[address] = { t: "s", v: "" });
}

export function styleWorkbookSheet(sheet, { title = "", subtitle = "", headerRow = 0, titleRow = null, numberFormats = {} } = {}) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const firstRow = titleRow ?? (title ? 0 : null);

  if (title) {
    const titleCell = cell(sheet, firstRow, 0);
    titleCell.v = title;
    titleCell.t = "s";
    titleCell.s = { fill: { fgColor: { rgb: NAVY } }, font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center" } };
    if (subtitle) {
      const subtitleCell = cell(sheet, firstRow + 1, 0);
      subtitleCell.v = subtitle;
      subtitleCell.t = "s";
      subtitleCell.s = { font: { italic: true, color: { rgb: SUBTLE } }, alignment: { vertical: "center" } };
    }
  }

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const header = cell(sheet, headerRow, column);
    header.s = {
      fill: { fgColor: { rgb: NAVY } },
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: { top: { style: "thin", color: { rgb: "FFFFFF" } }, bottom: { style: "thin", color: { rgb: "FFFFFF" } }, left: { style: "thin", color: { rgb: "FFFFFF" } }, right: { style: "thin", color: { rgb: "FFFFFF" } } }
    };
  }

  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const entry = cell(sheet, row, column);
      entry.s = {
        ...(entry.s || {}),
        fill: row % 2 === 0 ? { fgColor: { rgb: LIGHT } } : { fgColor: { rgb: "FFFFFF" } },
        alignment: { vertical: "top", wrapText: true },
        border: { bottom: { style: "thin", color: { rgb: BORDER } } }
      };
      if (numberFormats[column]) entry.z = numberFormats[column];
    }
  }

  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: range.s.c }, e: { r: range.e.r, c: range.e.c } }) };
  if (title && range.e.c > 0) sheet["!merges"] = [...(sheet["!merges"] ?? []), { s: { r: firstRow, c: 0 }, e: { r: firstRow, c: range.e.c } }];
  sheet["!rows"] = Array.from({ length: Math.max(range.e.r + 1, headerRow + 1) }, (_, row) => ({ hpt: row === firstRow ? 28 : row === firstRow + 1 ? 19 : row === headerRow ? 34 : 23 }));
  sheet["!margins"] = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  sheet["!pageSetup"] = { orientation: range.e.c > 7 ? "landscape" : "portrait", fitToWidth: 1, fitToHeight: 0 };
  sheet["!sheetPr"] = { outlinePr: { summaryBelow: true } };
  sheet["!tabColor"] = { rgb: ORANGE };
  sheet["!cols"] = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
    const column = range.s.c + offset;
    let width = 11;
    for (let row = range.s.r; row <= range.e.r; row += 1) width = Math.max(width, String(sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? "").length + 2);
    return { wch: Math.min(width, column === 0 ? 30 : 38) };
  });
  return sheet;
}

export function styleInstructionSheet(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  const endColumn = Math.max(range.e.c, 0);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: endColumn } }];
  const heading = cell(sheet, 0, 0);
  heading.s = { fill: { fgColor: { rgb: NAVY } }, font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center" } };
  for (let row = 1; row <= range.e.r; row += 1) {
    const entry = cell(sheet, row, 0);
    entry.s = { fill: { fgColor: { rgb: row % 2 ? "FFF4EB" : "FFFFFF" } }, font: { color: { rgb: "324A5E" } }, alignment: { vertical: "center", wrapText: true }, border: { bottom: { style: "thin", color: { rgb: BORDER } } } };
  }
  sheet["!cols"] = [{ wch: 105 }];
  sheet["!rows"] = Array.from({ length: range.e.r + 1 }, (_, row) => ({ hpt: row === 0 ? 30 : 34 }));
  sheet["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  sheet["!tabColor"] = { rgb: ORANGE };
  return sheet;
}

export function addExportTitle(rows, title, subtitle = "Exportado desde ETRAL") {
  return [[title], [subtitle], [], ...rows];
}
