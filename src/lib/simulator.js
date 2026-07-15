import { inventoryHeatmap } from "./mrp.js";

function daysUntil(date, now = new Date("2026-07-13T12:00:00")) {
  if (!date) return 999;
  return Math.ceil((new Date(`${date}T23:59:59`) - now) / 86400000);
}

function calculateScenario(dataset, params) {
  const horizonDays = Math.max(1, Number(params.horizonDays ?? 14));
  const laborFactor = Math.max(0.1, Number(params.laborAvailability ?? 100) / 100);
  const shifts = Math.max(1, Number(params.shiftsPerDay ?? 1));
  const demandFactor = Math.max(0.1, Number(params.demandPercent ?? 100) / 100);
  const activeOrders = dataset.orders.filter((order) => Number(order.progress) < 100);

  const stageCapacity = dataset.flowStages.map((stage) => {
    const demandHours = activeOrders.reduce((sum, order) => {
      const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
      const route = product?.route ?? [];
      const currentIndex = Math.max(0, route.indexOf(order.stageId));
      const isPending = route.indexOf(stage.id) >= currentIndex;
      return sum + (isPending ? Number(stage.standardHours ?? 6) * demandFactor : 0);
    }, 0);
    const availableHours = Number(stage.capacityHours) * (horizonDays / 7) * laborFactor * shifts;
    const utilization = availableHours === 0 ? 100 : Math.round((demandHours / availableHours) * 100);
    return {
      stageId: stage.id,
      name: stage.name,
      color: stage.color,
      demandHours: Number(demandHours.toFixed(1)),
      availableHours: Number(availableHours.toFixed(1)),
      utilization,
      overloadHours: Number(Math.max(0, demandHours - availableHours).toFixed(1))
    };
  });

  const stockAdjustment = Number(params.stockAdjustment ?? 0);
  const selectedMaterial = params.materialCode;
  const scenarioInventory = dataset.inventory.map((item) => (
    item.code === selectedMaterial ? { ...item, physical: Math.max(0, Number(item.physical) + stockAdjustment) } : item
  ));
  const materials = inventoryHeatmap(scenarioInventory, activeOrders, dataset.bom);
  const stockouts = materials.filter((item) => item.projected < 0).length;
  const bottleneck = [...stageCapacity].sort((a, b) => b.utilization - a.utilization)[0];
  const capacityRatio = bottleneck ? Math.min(1, 100 / Math.max(100, bottleneck.utilization)) : 1;
  const stockRatio = Math.max(0.35, 1 - stockouts * 0.13);
  const completionRatio = Math.min(capacityRatio, stockRatio);
  const throughput = Math.max(0, Math.min(activeOrders.length, Math.floor(activeOrders.length * completionRatio)));
  const avgTarget = activeOrders.length
    ? activeOrders.reduce((sum, order) => sum + Number(dataset.bodyTypes.find((item) => item.id === order.bodyTypeId)?.targetDays ?? 14), 0) / activeOrders.length
    : 0;
  const estimatedLeadDays = Number((avgTarget / Math.max(0.35, completionRatio)).toFixed(1));
  const delayedOrders = activeOrders.filter((order) => daysUntil(order.dueDate) < estimatedLeadDays).length;
  const pmpCompliance = activeOrders.length === 0 ? 100 : Math.round((throughput / activeOrders.length) * 100);

  return {
    activeOrders: activeOrders.length,
    throughput,
    pmpCompliance,
    delayedOrders,
    stockouts,
    estimatedLeadDays,
    bottleneck: bottleneck?.name ?? "Sin carga",
    stageCapacity,
    materials
  };
}

function buildNotifications(dataset, scenario) {
  const notifications = [];

  if (scenario.pmpCompliance < 90) {
    notifications.push({
      id: "indicator-pmp",
      category: "PMP",
      severity: scenario.pmpCompliance < 75 ? "critical" : "warning",
      title: "Cumplimiento del plan por debajo del objetivo",
      value: `${scenario.pmpCompliance}%`,
      equation: `PMP = órdenes terminables / órdenes abiertas × 100 = ${scenario.throughput} / ${scenario.activeOrders} × 100`,
      detail: `${scenario.delayedOrders} CECO presentan riesgo de superar su fecha pactada.`,
      affected: dataset.orders.filter((order) => Number(order.progress) < 100).map((order) => order.ceco)
    });
  }

  scenario.stageCapacity.filter((stage) => stage.utilization >= 85).forEach((stage) => {
    notifications.push({
      id: `capacity-${stage.stageId}`,
      category: "Capacidad",
      severity: stage.utilization > 100 ? "critical" : "warning",
      title: stage.utilization > 100 ? `Cuello de botella en ${stage.name}` : `${stage.name} cerca de su capacidad`,
      value: `${stage.utilization}%`,
      equation: `Utilización = horas requeridas / horas disponibles × 100 = ${stage.demandHours} / ${stage.availableHours} × 100`,
      detail: stage.overloadHours > 0 ? `Sobrecarga de ${stage.overloadHours} h dentro del horizonte.` : "Conviene vigilar la cola antes de liberar más trabajo.",
      affected: dataset.orders.filter((order) => {
        const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
        return Number(order.progress) < 100 && product?.route.includes(stage.stageId);
      }).map((order) => order.ceco)
    });
  });

  scenario.materials.filter((material) => material.coverageIndicator < 100).forEach((material) => {
    const productIds = new Set(dataset.bom.filter((item) => item.materialCode === material.code).map((item) => item.bodyTypeId));
    notifications.push({
      id: `stock-${material.code}`,
      category: "Inventario",
      severity: material.projected < 0 ? "critical" : "warning",
      title: material.projected < 0 ? `Quiebre proyectado de ${material.code}` : `${material.code} bajo stock de seguridad`,
      value: `${material.coverageIndicator}%`,
      equation: `Cobertura = stock proyectado / SS × 100 = ${material.projected} / ${material.safety} × 100; SS = Z × σd × √LT`,
      detail: `${material.description}. Stock de seguridad estadístico: ${material.safety} ${material.unit}.`,
      affected: dataset.orders.filter((order) => Number(order.progress) < 100 && productIds.has(order.bodyTypeId)).map((order) => order.ceco)
    });
  });

  const rank = { critical: 0, warning: 1 };
  return notifications.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function runDigitalTwin(dataset, params = {}) {
  const normalized = {
    horizonDays: Number(params.horizonDays ?? 14),
    laborAvailability: Number(params.laborAvailability ?? 85),
    shiftsPerDay: Number(params.shiftsPerDay ?? 1),
    demandPercent: Number(params.demandPercent ?? 100),
    materialCode: params.materialCode ?? dataset.inventory[0]?.code,
    stockAdjustment: Number(params.stockAdjustment ?? 0),
    expediteCeco: params.expediteCeco ?? ""
  };
  const baseline = calculateScenario(dataset, { ...normalized, laborAvailability: 100, shiftsPerDay: 1, demandPercent: 100, stockAdjustment: 0 });
  const scenario = calculateScenario(dataset, normalized);
  const notifications = buildNotifications(dataset, scenario);
  const changes = [
    `Horizonte: ${normalized.horizonDays} días.`,
    `Personal disponible: ${normalized.laborAvailability}%; ${normalized.shiftsPerDay} turno(s).`,
    `Demanda considerada: ${normalized.demandPercent}% de las órdenes abiertas.`,
    normalized.stockAdjustment === 0
      ? "Sin ajuste extraordinario de inventario."
      : `${normalized.materialCode}: ${normalized.stockAdjustment > 0 ? "+" : ""}${normalized.stockAdjustment} unidades.`,
    normalized.expediteCeco ? `CECO ${normalized.expediteCeco} priorizado en la cola.` : "Prioridad CECO sin cambios."
  ];
  return { params: normalized, baseline, scenario, changes, notifications };
}

export function calculateKpis(dataset) {
  const activeOrders = dataset.orders.filter((order) => Number(order.progress) < 100).length;
  const blocked = dataset.orders.filter((order) => order.status === "red").length;
  const totalHours = dataset.operations.reduce((sum, row) => sum + Number(row.totalHours), 0);
  const capacityHours = dataset.flowStages.reduce((sum, stage) => sum + Number(stage.capacityHours), 0);
  const capacityUse = capacityHours === 0 ? 0 : Math.round((totalHours / capacityHours) * 100);
  const dueSoon = dataset.orders.filter((order) => daysUntil(order.dueDate) <= 7 && Number(order.progress) < 100).length;
  return { activeOrders, blocked, capacityUse, dueSoon };
}
