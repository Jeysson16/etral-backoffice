import { inventoryHeatmap } from "./mrp.js";

function daysUntil(date, now = new Date("2026-07-26T12:00:00")) {
  if (!date) return 999;
  return Math.ceil((new Date(`${date}T23:59:59`) - now) / 86400000);
}

export function calibrateDigitalTwin(dataset) {

  const operations = dataset.operations ?? [];
  const progress = dataset.activityProgress ?? [];
  const personnel = dataset.personnel ?? [];
  const incidents = dataset.incidents ?? [];

  // 1. Bias Factor de Tiempos Estándar (Horas reales vs teóricas registradas)
  let totalLoggedHours = operations.reduce((sum, op) => sum + Number(op.totalHours || 0), 0);
  let totalStandardHours = 0;

  progress.forEach((p) => {
    if (p.status === "completed") {
      const act = (dataset.stageActivities ?? []).find((a) => a.id === p.activityId);
      if (act) {
        totalStandardHours += Number(act.standardMinutes || 60) / 60;
      }
    }
  });

  const standardTimeBias = totalStandardHours > 0 && totalLoggedHours > 0
    ? Number((totalLoggedHours / totalStandardHours).toFixed(2))
    : 1.05;

  // 2. Eficiencia Empírica por Trabajador
  const workerStats = {};
  personnel.forEach((p) => {
    workerStats[p.name] = { id: p.id, name: p.name, loggedHours: 0, completedTasks: 0, nominalEfficiency: Number(p.efficiency || 100) };
  });

  operations.forEach((op) => {
    if (workerStats[op.worker]) {
      workerStats[op.worker].loggedHours += Number(op.totalHours || 0);
      workerStats[op.worker].completedTasks += 1;
    }
  });

  const workerEfficiencyMap = {};
  let totalVarianceSum = 0;
  let evaluatedWorkers = 0;

  Object.values(workerStats).forEach((w) => {
    let empiricalEff = w.nominalEfficiency;
    if (w.completedTasks > 0 && w.loggedHours > 0) {
      // Comparar horas promedio esperadas (8h por tarea promedio) vs horas registradas
      const expectedHours = w.completedTasks * 6.5;
      empiricalEff = Math.round(Math.min(130, Math.max(60, (expectedHours / w.loggedHours) * 100)));
    }
    workerEfficiencyMap[w.id] = empiricalEff;
    totalVarianceSum += Math.pow((empiricalEff - w.nominalEfficiency), 2);
    evaluatedWorkers++;
  });

  const rmseVariance = evaluatedWorkers > 0 ? Math.sqrt(totalVarianceSum / evaluatedWorkers) : 5.2;
  const workerInconsistencyStdDev = Number((Math.max(4, Math.min(25, rmseVariance))).toFixed(1));

  // 3. Riesgo de Inactividad por Fase (basado en incidencias de la planta en Supabase)
  const stageDowntimeRisk = {};
  (dataset.flowStages ?? []).forEach((stage) => {
    const stageIncidents = incidents.filter((inc) => inc.stageId === stage.id);
    const downtime = stageIncidents.reduce((sum, inc) => sum + Number(inc.downtimeHours || 0), 0);
    stageDowntimeRisk[stage.id] = downtime;
  });

  // 4. Puntuación de Confiabilidad Operativa del Gemelo (0 a 100%)
  const totalDowntime = Object.values(stageDowntimeRisk).reduce((a, b) => a + b, 0);
  const reliabilityScore = Math.max(50, Math.min(99, Math.round(100 - (workerInconsistencyStdDev * 1.2) - (totalDowntime * 0.5))));

  return {
    calibratedAt: new Date().toISOString(),
    standardTimeBias,
    workerEfficiencyMap,
    workerInconsistencyStdDev,
    stageDowntimeRisk,
    reliabilityScore,
    sampleSizeOperations: operations.length,
    sampleSizeProgress: progress.length,
    sampleSizeIncidents: incidents.length
  };
}

function gaussianRandom(mean = 0, stdDev = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function calculateScenario(dataset, params, seedNoise = 0) {
  const horizonDays = Math.max(1, Number(params.horizonDays ?? 14));
  const calibration = params.calibrationData ?? calibrateDigitalTwin(dataset);
  const orderComplexityMap = params.orderComplexityMap ?? {};
  const orderWorkerAssignments = params.orderWorkerAssignments ?? {};
  const orderPriorityOverrides = params.orderPriorityOverrides ?? {};
  const workerInconsistencyMode = params.workerInconsistencyMode ?? "stochastic"; // "stochastic", "skill_based", "flat"
  const absenteeismRate = Math.max(0, Math.min(30, Number(params.absenteeismRate ?? 5))) / 100;
  const inconsistencyStdDev = Math.max(0, Math.min(35, Number(params.inconsistencyStdDev ?? calibration.workerInconsistencyStdDev)));

  const activePersonnel = (dataset.personnel ?? []).filter((item) => item.active);
  const availablePersonnel = activePersonnel.filter((item) => !["absent", "leave"].includes(item.status));

  // Cálculo de factor de personal con variabilidad estocástica / ausentismo
  let personnelFactor = 1;
  if (activePersonnel.length > 0) {
    const totalEff = availablePersonnel.reduce((sum, item) => {
      let eff = calibration.workerEfficiencyMap[item.id] ?? Number(item.efficiency ?? 100);
      if (workerInconsistencyMode === "stochastic" && seedNoise !== 0) {
        const noise = gaussianRandom(0, inconsistencyStdDev);
        eff = Math.max(50, Math.min(140, eff + noise));
      }
      // Simular ausentismo probabilístico
      if (Math.random() < absenteeismRate && seedNoise !== 0) {
        eff = 0;
      }
      return sum + (eff / 100);
    }, 0);
    personnelFactor = Math.max(0.2, totalEff / activePersonnel.length);
  }

  const laborFactor = Math.max(0.1, Number(params.laborAvailability ?? 100) / 100) * personnelFactor;
  const calendarRows = dataset.workCalendar ?? [];
  const calendarFactor = calendarRows.length ? calendarRows.reduce((sum, item) => sum + Number(item.availableHours), 0) / (calendarRows.length * 8) : 1;
  const shifts = Math.max(1, Number(params.shiftsPerDay ?? 1));
  const globalDemandFactor = Math.max(0.1, Number(params.demandPercent ?? 100) / 100);

  // Órdenes activas con priorización y complejidad específica por orden
  let activeOrders = dataset.orders.filter((order) => Number(order.progress) < 100);
  if (Object.keys(orderPriorityOverrides).length > 0 || params.expediteCeco) {
    activeOrders = [...activeOrders].sort((a, b) => {
      const prioA = orderPriorityOverrides[a.ceco] ?? (a.ceco === params.expediteCeco ? 1 : Number(a.priority || 999));
      const prioB = orderPriorityOverrides[b.ceco] ?? (b.ceco === params.expediteCeco ? 1 : Number(b.priority || 999));
      return prioA - prioB;
    });
  }

  const stageCapacity = dataset.flowStages.map((stage) => {
    const demandHours = activeOrders.reduce((sum, order) => {
      const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
      const route = product?.route ?? [];
      const currentIndex = Math.max(0, route.indexOf(order.stageId));
      const isPending = route.indexOf(stage.id) >= currentIndex;
      if (!isPending) return sum;

      // Parámetros específicos por orden
      const orderComplexity = Math.max(0.5, Math.min(2.5, Number(orderComplexityMap[order.ceco] ?? 1.0)));
      const stdHours = Number(stage.standardHours ?? 6) * calibration.standardTimeBias;

      // Trabajadores asignados a la orden
      const assignedWorkers = orderWorkerAssignments[order.ceco] ?? [];
      let orderWorkerFactor = 1;
      if (assignedWorkers.length > 0) {
        const assignedEffs = assignedWorkers.map((wId) => calibration.workerEfficiencyMap[wId] ?? 100);
        const avgAssignedEff = assignedEffs.reduce((a, b) => a + b, 0) / assignedEffs.length;
        orderWorkerFactor = 100 / Math.max(50, avgAssignedEff);
      }

      return sum + (stdHours * globalDemandFactor * orderComplexity * orderWorkerFactor);
    }, 0);

    const stageEquipment = (dataset.equipment ?? []).filter((item) => item.stageId === stage.id);
    const equipmentFactor = stageEquipment.length
      ? stageEquipment.reduce((sum, item) => sum + ({ operational: 1, restricted: 0.7, maintenance: 0.35, out_of_service: 0 }[item.status] ?? 1), 0) / stageEquipment.length
      : 1;

    const incidentHours = (dataset.incidents ?? [])
      .filter((item) => item.stageId === stage.id && item.status !== "resolved")
      .reduce((sum, item) => sum + Number(item.downtimeHours), 0);

    const availableHours = Math.max(0, Number(stage.capacityHours) * (horizonDays / 7) * laborFactor * calendarFactor * equipmentFactor * shifts - incidentHours);
    const utilization = availableHours === 0 ? 100 : Math.round((demandHours / availableHours) * 100);

    return {
      stageId: stage.id,
      name: stage.name,
      color: stage.color,
      demandHours: Number(demandHours.toFixed(1)),
      availableHours: Number(availableHours.toFixed(1)),
      utilization,
      overloadHours: Number(Math.max(0, demandHours - availableHours).toFixed(1)),
      personnelFactor: Number(personnelFactor.toFixed(2)),
      equipmentFactor: Number(equipmentFactor.toFixed(2)),
      incidentHours
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
  const calibration = params.calibrationData ?? calibrateDigitalTwin(dataset);
  const normalized = {
    horizonDays: Number(params.horizonDays ?? 14),
    laborAvailability: Number(params.laborAvailability ?? 85),
    shiftsPerDay: Number(params.shiftsPerDay ?? 1),
    demandPercent: Number(params.demandPercent ?? 100),
    materialCode: params.materialCode ?? dataset.inventory[0]?.code,
    stockAdjustment: Number(params.stockAdjustment ?? 0),
    expediteCeco: params.expediteCeco ?? "",
    orderComplexityMap: params.orderComplexityMap ?? {},
    orderWorkerAssignments: params.orderWorkerAssignments ?? {},
    orderPriorityOverrides: params.orderPriorityOverrides ?? {},
    workerInconsistencyMode: params.workerInconsistencyMode ?? "stochastic",
    absenteeismRate: Number(params.absenteeismRate ?? 5),
    inconsistencyStdDev: Number(params.inconsistencyStdDev ?? calibration.workerInconsistencyStdDev),
    calibrationData: calibration
  };

  const baseline = calculateScenario(dataset, { ...normalized, laborAvailability: 100, shiftsPerDay: 1, demandPercent: 100, stockAdjustment: 0 }, 0);
  const scenario = calculateScenario(dataset, normalized, 0);

  // Ejecución de Monte Carlo (30 iteraciones) para estimación estocástica e incertidumbre
  const monteCarloRuns = 30;
  const pmpResults = [];
  const leadDayResults = [];

  for (let i = 0; i < monteCarloRuns; i++) {
    const iter = calculateScenario(dataset, normalized, i + 1);
    pmpResults.push(iter.pmpCompliance);
    leadDayResults.push(iter.estimatedLeadDays);
  }

  pmpResults.sort((a, b) => a - b);
  leadDayResults.sort((a, b) => a - b);

  const confidenceIntervals = {
    pmpLower: pmpResults[Math.floor(monteCarloRuns * 0.05)] ?? scenario.pmpCompliance,
    pmpUpper: pmpResults[Math.floor(monteCarloRuns * 0.95)] ?? scenario.pmpCompliance,
    leadLower: leadDayResults[Math.floor(monteCarloRuns * 0.05)] ?? scenario.estimatedLeadDays,
    leadUpper: leadDayResults[Math.floor(monteCarloRuns * 0.95)] ?? scenario.estimatedLeadDays
  };

  const notifications = buildNotifications(dataset, scenario);
  const changes = [
    `Horizonte: ${normalized.horizonDays} días.`,
    `Personal disponible: ${normalized.laborAvailability}%; ${normalized.shiftsPerDay} turno(s).`,
    `Demanda considerada: ${normalized.demandPercent}% de las órdenes abiertas.`,
    `Modelo de inconsistencia laboral: ${normalized.workerInconsistencyMode === "stochastic" ? `Estocástico Monte Carlo (σ = ${normalized.inconsistencyStdDev}%, ausentismo = ${normalized.absenteeismRate}%)` : "Porcentual plano"}.`,
    Object.keys(normalized.orderComplexityMap).length > 0
      ? `Ajuste de complejidad aplicado a ${Object.keys(normalized.orderComplexityMap).length} orden(es) CECO.`
      : "Complejidad estándar (100%) en todas las órdenes.",
    normalized.stockAdjustment === 0
      ? "Sin ajuste extraordinario de inventario."
      : `${normalized.materialCode}: ${normalized.stockAdjustment > 0 ? "+" : ""}${normalized.stockAdjustment} unidades.`,
    normalized.expediteCeco ? `CECO ${normalized.expediteCeco} priorizado en la cola.` : "Prioridad CECO sin cambios."
  ];

  return {
    params: normalized,
    calibration,
    confidenceIntervals,
    baseline,
    scenario,
    changes,
    notifications
  };
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

