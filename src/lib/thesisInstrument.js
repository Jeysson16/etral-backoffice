const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function thesisInstrumentRows(measurements = []) {
  return measurements.map((row) => {
    const materials = Number(row.rawMaterialCost) + Number(row.suppliesCost);
    const labor = Number(row.laborHours) * Number(row.hourlyCost);
    const weight = Number(row.weightKg);
    const output = Number(row.outputValue);
    return {
      ...row,
      materials,
      labor,
      laborProductivity: weight / Number(row.laborHours),
      materialProductivity: weight / materials,
      thesisMultifactor: output / (materials + labor),
      workbookMultifactor: Number(row.workbookMultifactor)
    };
  });
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
  return { rows, pre: summarize("pre"), post: summarize("post") };
}
