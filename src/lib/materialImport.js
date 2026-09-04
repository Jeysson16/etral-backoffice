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

  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));
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
      consolidated.push({ ...row, physical: Number(row.physical ?? 0) });
      continue;
    }
    existing.physical = Number(existing.physical ?? 0) + Number(row.physical ?? 0);
    // Los campos no cuantitativos de la última fila son los datos maestros más recientes.
    Object.assign(existing, { ...row, code: existing.code || row.code, physical: existing.physical });
  }
  return consolidated;
}
