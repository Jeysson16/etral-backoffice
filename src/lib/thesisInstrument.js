const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function thesisPostCecos(dataset) {
  return new Set((dataset.thesisMeasurements ?? []).filter((row) => row.phase === "post").map((row) => row.ceco));
}

export function scopeDatasetToThesis(dataset, selectedCecos = thesisPostCecos(dataset)) {
  const cecos = selectedCecos;
  if (!cecos.size && !(dataset.thesisMeasurements ?? []).length) return dataset;
  const included = (row) => cecos.has(row.ceco);
  return {
    ...dataset,
    orders: (dataset.orders ?? []).filter(included),
    operations: (dataset.operations ?? []).filter(included),
    activityProgress: (dataset.activityProgress ?? []).filter(included),
    orderMaterialReservations: (dataset.orderMaterialReservations ?? []).filter(included),
    warehouse: (dataset.warehouse ?? []).filter((row) => !row.ceco || included(row)),
    inventoryMovements: (dataset.inventoryMovements ?? []).filter((row) => !row.ceco || included(row))
  };
}

export function thesisInstrumentRows(measurements = []) {
  const rows = [...measurements].sort((a, b) => a.phase === b.phase
    ? Number(a.sourceRow) - Number(b.sourceRow)
    : a.phase === "pre" ? -1 : 1).map((row) => {
    const materials = Number(row.rawMaterialCost) + Number(row.suppliesCost);
    const labor = Number(row.laborHours) * Number(row.hourlyCost);
    const weight = Number(row.weightKg);
    const output = Number(row.outputValue);
    const workbookMultifactorCalculated = row.capitalCost == null ? null
      : output / (labor + Number(row.energyCost ?? 0) + Number(row.capitalCost));
    return {
      ...row,
      materials,
      labor,
      laborProductivity: weight / Number(row.laborHours),
      materialProductivity: weight / materials,
      thesisMultifactor: output / (materials + labor),
      workbookMultifactor: workbookMultifactorCalculated,
      workbookMultifactorSource: Number(row.workbookMultifactor),
      workbookMultifactorCalculated
    };
  });
  for (const phase of ["pre", "post"]) {
    const phaseRows = rows.filter((row) => row.phase === phase);
    const anchors = phaseRows.filter((row) => row.groupMultifactorSum != null);
    anchors.forEach((anchor, index) => {
      const nextRow = anchors[index + 1]?.sourceRow ?? Infinity;
      const members = phaseRows.filter((row) => row.sourceRow >= anchor.sourceRow && row.sourceRow < nextRow);
      anchor.groupCecos = members.map((row) => row.ceco).join(", ");
      anchor.groupVerified = Math.abs(members.reduce((sum, row) => sum + row.workbookMultifactor, 0) - anchor.groupMultifactorSum) < 1e-8
        && Math.abs(members.reduce((sum, row) => sum + row.laborProductivity, 0) - anchor.groupLaborSum) < 1e-8
        && Math.abs(members.reduce((sum, row) => sum + row.materialProductivity, 0) - anchor.groupMaterialSum) < 1e-8;
    });
  }
  return rows;
}

export function summarizeThesisInstrument(measurements = []) {
  const rows = thesisInstrumentRows(measurements);
  const summarize = (phase) => {
    const items = rows.filter((row) => row.phase === phase);
    return {
      count: items.length,
      labor: average(items.map((row) => row.laborProductivity)),
      materials: average(items.map((row) => row.materialProductivity)),
      multifactor: average(items.map((row) => row.thesisMultifactor)),
      workbookMultifactor: average(items.map((row) => row.workbookMultifactor))
    };
  };
  return { rows, pre: summarize("pre"), post: summarize("post"), verifiedWorkbookRows: rows.filter((row) => row.workbookMultifactorCalculated != null && Math.abs(row.workbookMultifactorCalculated - row.workbookMultifactorSource) < 1e-8).length, verifiedGroups: rows.filter((row) => row.groupVerified).length, groupCount: rows.filter((row) => row.groupMultifactorSum != null).length };
}
