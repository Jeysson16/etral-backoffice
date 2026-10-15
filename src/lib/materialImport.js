export function normalizeMaterialText(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function descriptionsAreSimilar(first, second) {
  const left = normalizeMaterialText(first);
  const right = normalizeMaterialText(second);
  if (!left || !right) return false;
  if (left === right) return true;

  // Los números cortos son parte de la especificación del material. Ignorarlos
  // hacía equivalentes medidas distintas como 1/4 y 5/32.
  const relevantToken = (token) => token.length > 2 || /\d/.test(token);
  const leftTokens = new Set(left.split(" ").filter(relevantToken));
  const rightTokens = new Set(right.split(" ").filter(relevantToken));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared >= 2 && shared / Math.max(leftTokens.size, rightTokens.size) >= 0.8;
}

// El código es la prioridad. Sin él, se reconocen descripciones iguales o muy próximas
// para evitar duplicar "Plancha galvanizada 1.5 mm" por cambios de puntuación o espacios.
export function findMatchingMaterial(materials, row) {
  const code = String(row.code ?? "").trim().toLowerCase();
  if (code) {
    const byCode = materials.find((item) => String(item.code ?? "").trim().toLowerCase() === code);
    if (byCode) return byCode;
  }
  return materials.find((item) => descriptionsAreSimilar(item.description, row.description));
}

export function consolidateImportedMaterials(materials = []) {
  const consolidated = [];
  for (const row of materials) {
    const existing = findMatchingMaterial(consolidated, row);
    if (!existing) {
      consolidated.push({
        ...row,
        physical: Number(row.physical ?? 0),
        sourceCodes: [...new Set([...(row.sourceCodes ?? []), row.code].filter(Boolean))]
      });
      continue;
    }
    existing.physical = Number(existing.physical ?? 0) + Number(row.physical ?? 0);
    const sourceCodes = [...new Set([
      ...(existing.sourceCodes ?? []),
      ...(row.sourceCodes ?? []),
      row.code
    ].filter(Boolean))];
    // Los campos no cuantitativos de la última fila son los datos maestros más recientes.
    Object.assign(existing, { ...row, code: existing.code || row.code, physical: existing.physical, sourceCodes });
  }
  return consolidated;
}
