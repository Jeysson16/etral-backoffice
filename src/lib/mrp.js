export function availableStock(item) {
  return Number(item.physical) - Number(item.committed);
}

export function calculateSafetyStock(item) {
  const z = Number(item.serviceFactor);
  const deviation = Number(item.demandStdDev);
  const leadTime = Number(item.leadTimeDays);
  if (z > 0 && deviation >= 0 && leadTime > 0) {
    return Math.ceil(z * deviation * Math.sqrt(leadTime));
  }
  return Number(item.safety ?? 0);
}

export function buildMaterialExplosion(order, bodyTypes, bom, inventory, balances = null) {
  const bodyType = bodyTypes.find((item) => item.id === order.bodyTypeId);
  const recipe = bom.filter((item) => item.bodyTypeId === order.bodyTypeId);

  return recipe.map((piece) => {
    const material = inventory.find((item) => item.code === piece.materialCode);
    const stockBefore = balances ? Number(balances[piece.materialCode] ?? 0) : Number(material?.physical ?? 0);
    const required = Number(piece.quantity);
    const stockAfter = stockBefore - required;
    if (balances) balances[piece.materialCode] = stockAfter;
    const safety = material ? calculateSafetyStock(material) : 0;
    return {
      ceco: order.ceco,
      bodyTypeName: bodyType?.name ?? "Sin producto",
      materialCode: piece.materialCode,
      pieceCode: piece.pieceCode,
      description: piece.description,
      required,
      stockBefore,
      stockAfter,
      available: stockBefore,
      safety,
      shortage: Math.max(0, -stockAfter),
      canRelease: stockAfter >= safety
    };
  });
}

export function evaluateMrp(orders, bodyTypes, bom, inventory) {
  const balances = Object.fromEntries(inventory.map((item) => [item.code, Number(item.physical)]));
  const prioritized = [...orders]
    .filter((order) => Number(order.progress) < 100)
    .sort((a, b) => Number(a.priority) - Number(b.priority));
  const explosions = prioritized.flatMap((order) => buildMaterialExplosion(order, bodyTypes, bom, inventory, balances));
  const alerts = explosions
    .filter((item) => !item.canRelease)
    .map((item) => ({
      type: "stock_break",
      severity: item.shortage > 0 ? "critical" : "warning",
      ceco: item.ceco,
      materialCode: item.materialCode,
      message: `${item.materialCode} compromete el CECO ${item.ceco}`,
      impact: item.shortage > 0
        ? `Faltan ${item.shortage} ${inventory.find((row) => row.code === item.materialCode)?.unit ?? "und"}`
        : `Saldo ${item.stockAfter}; mínimo ${item.safety}`
    }));

  return { explosions, alerts, balances };
}

export function materialRequirementSummary(orders, bom) {
  return bom.reduce((summary, piece) => {
    const openOrders = orders.filter((order) => order.bodyTypeId === piece.bodyTypeId && Number(order.progress) < 100);
    summary[piece.materialCode] = (summary[piece.materialCode] ?? 0) + openOrders.length * Number(piece.quantity);
    return summary;
  }, {});
}

// El avance de una orden se reparte equitativamente entre las fases de la
// ruta; dentro de cada fase se promedian sus actividades activas. Esta misma
// regla se aplica en Supabase al persistir el avance del CECO.
export function calculateCecoProgress(order, bodyTypes, stageActivities, activityProgress = []) {
  const product = bodyTypes.find((item) => item.id === order?.bodyTypeId);
  const route = product?.route ?? [];
  const stages = route.map((stageId) => {
    const activities = stageActivities.filter((item) => item.stageId === stageId && item.active !== false);
    const completed = activities.filter((activity) => activityProgress.find((item) => item.ceco === order.ceco && item.activityId === activity.id)?.status === "completed").length;
    const progress = activities.length
      ? activities.reduce((sum, activity) => sum + Number(activityProgress.find((item) => item.ceco === order.ceco && item.activityId === activity.id)?.progress ?? 0), 0) / activities.length
      : 0;
    return { stageId, activities: activities.length, completed, progress: Math.round(progress * 100) / 100 };
  });
  const progress = stages.length
    ? Math.round((stages.reduce((sum, stage) => sum + stage.progress, 0) / stages.length) * 100) / 100
    : 0;
  return { ceco: order?.ceco, progress, stages };
}

// Consolida las piezas del BOM por material y fase, para mostrar cuánto debe
// estar disponible antes de iniciar cada etapa del producto.
export function materialRequirementsByStage(productId, bom) {
  const grouped = new Map();
  bom.filter((item) => item.bodyTypeId === productId).forEach((piece) => {
    const key = `${piece.stageId}::${piece.materialCode}`;
    const current = grouped.get(key) ?? { stageId: piece.stageId, materialCode: piece.materialCode, quantity: 0, pieces: [] };
    current.quantity += Number(piece.quantity ?? 0);
    current.pieces.push(piece);
    grouped.set(key, current);
  });
  return [...grouped.values()].map((item) => ({ ...item, quantity: Math.round(item.quantity * 1000) / 1000 }));
}

export function inventoryHeatmap(inventory, orders = [], bom = []) {
  const requirements = materialRequirementSummary(orders, bom);
  return inventory.map((item) => {
    const available = availableStock(item);
    const required = requirements[item.code] ?? 0;
    const projected = Number(item.physical) - required;
    const calculatedSafety = calculateSafetyStock(item);
    const ratio = calculatedSafety === 0 ? 2 : projected / calculatedSafety;
    const coverageIndicator = calculatedSafety === 0 ? 200 : Math.round((projected / calculatedSafety) * 100);
    const tone = projected < 0 ? "danger" : projected < calculatedSafety ? "warning" : "ok";
    return { ...item, safety: calculatedSafety, available, required, projected, ratio, coverageIndicator, tone };
  });
}
