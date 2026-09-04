import * as XLSX from "xlsx";

const NAVY = "20384F";
const ORANGE = "D95D19";
const LIGHT = "F3F6F8";
const BORDER = "D9E1E8";

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
    titleCell.s = { font: { bold: true, sz: 15, color: { rgb: ORANGE } }, alignment: { vertical: "center" } };
    if (subtitle) {
      const subtitleCell = cell(sheet, firstRow + 1, 0);
      subtitleCell.v = subtitle;
      subtitleCell.t = "s";
      subtitleCell.s = { font: { italic: true, color: { rgb: "667789" } } };
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
        fill: row % 2 === 0 ? { fgColor: { rgb: LIGHT } } : undefined,
        alignment: { vertical: "top", wrapText: true },
        border: { bottom: { style: "thin", color: { rgb: BORDER } } }
      };
      if (numberFormats[column]) entry.z = numberFormats[column];
    }
  }

  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: range.s.c }, e: { r: range.e.r, c: range.e.c } }) };
  sheet["!rows"] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 8 }, { hpt: 32 }];
  sheet["!margins"] = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  sheet["!cols"] = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
    const column = range.s.c + offset;
    let width = 11;
    for (let row = range.s.r; row <= range.e.r; row += 1) width = Math.max(width, String(sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? "").length + 2);
    return { wch: Math.min(width, column === 0 ? 30 : 38) };
  });
  return sheet;
}

export function addExportTitle(rows, title, subtitle = "Exportado desde ETRAL") {
  return [[title], [subtitle], [], ...rows];
}
