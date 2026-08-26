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

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatPeriod(start, end) {
  const formatter = new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" });
  return start.getTime() === end.getTime() ? formatter.format(start) : `${formatter.format(start)}–${formatter.format(end)}`;
}

function pendingStages(order, product) {
  const route = product?.route ?? [];
  const index = Math.max(0, route.indexOf(order.stageId));
  return route.slice(index);
}

function buildHistoricalDemand(dataset, endDate) {
  const movements = (dataset.inventoryMovements ?? []).filter((item) => ["salida", "consumo"].includes(item.type) && item.timestamp);
  const byCode = {};
  dataset.inventory.forEach((item) => { byCode[item.code] = { day: 0, week: 0, month: 0, records: 0 }; });
  const windows = { day: 1, week: 7, month: 30 };
  movements.forEach((movement) => {
    const date = new Date(String(movement.timestamp).replace(" ", "T"));
    if (Number.isNaN(date.getTime()) || !byCode[movement.code]) return;
    const age = Math.floor((endDate - date) / 86400000);
    if (age < 0) return;
    Object.entries(windows).forEach(([period, days]) => {
      if (age < days) byCode[movement.code][period] += Number(movement.quantity || 0);
    });
    byCode[movement.code].records += 1;
  });
  return byCode;
}

function buildProductTrend(dataset) {
  const completed = dataset.orders.filter((order) => Number(order.progress) >= 100 && order.dueDate);
  if (!completed.length) return { available: false, rows: [] };
  const cutoff = new Date(Math.max(...completed.map((order) => new Date(`${order.dueDate}T12:00:00`).getTime())));
  const recentStart = addDays(cutoff, -30);
  const previousStart = addDays(cutoff, -60);
  const products = new Map();
  completed.forEach((order) => {
    const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
    const row = products.get(order.bodyTypeId) ?? { productId: order.bodyTypeId, product: product?.name ?? order.bodyTypeId, completed: 0, recent: 0, previous: 0 };
    const date = new Date(`${order.dueDate}T12:00:00`);
    row.completed += 1;
    if (date >= recentStart) row.recent += 1;
    else if (date >= previousStart) row.previous += 1;
    products.set(order.bodyTypeId, row);
  });
  return {
    available: true,
    reference: `Pedidos cerrados con fecha pactada hasta ${formatPeriod(cutoff, cutoff)}. No se infiere una venta si falta fecha real de entrega.`,
    rows: [...products.values()].map((row) => ({ ...row, trend: row.recent === row.previous ? "estable" : row.recent > row.previous ? "alza" : "baja" })).sort((a, b) => b.completed - a.completed)
  };
}

function calculateScenario(dataset, params) {
  const horizonDays = Math.max(1, Number(params.horizonDays ?? 14));
  const calibration = params.calibrationData ?? calibrateDigitalTwin(dataset);
  const orderComplexityMap = params.orderComplexityMap ?? {};
  const orderWorkerAssignments = params.orderWorkerAssignments ?? {};
  const orderPriorityOverrides = params.orderPriorityOverrides ?? {};
  const activePersonnel = (dataset.personnel ?? []).filter((item) => item.active);
  const availablePersonnel = activePersonnel.filter((item) => !["absent", "leave"].includes(item.status));
  let personnelFactor = 1;
  if (activePersonnel.length > 0) {
    personnelFactor = availablePersonnel.reduce((sum, item) => sum + ((calibration.workerEfficiencyMap[item.id] ?? Number(item.efficiency ?? 100)) / 100), 0) / activePersonnel.length;
  }

  const laborFactor = Math.max(0.1, Number(params.laborAvailability ?? 100) / 100) * personnelFactor;
  const calendarRows = dataset.workCalendar ?? [];
  const calendarFactor = calendarRows.length ? calendarRows.reduce((sum, item) => sum + Number(item.availableHours), 0) / (calendarRows.length * 8) : 1;
  const shifts = Math.max(1, Number(params.shiftsPerDay ?? 1));
  const globalDemandFactor = Math.max(0.1, Number(params.demandPercent ?? 100) / 100);

  const activeOrders = [...dataset.orders.filter((order) => Number(order.progress) < 100)].sort((a, b) => {
    const priorityA = Number(orderPriorityOverrides[a.ceco] ?? a.priority ?? 999);
    const priorityB = Number(orderPriorityOverrides[b.ceco] ?? b.priority ?? 999);
    return priorityA - priorityB || String(a.ceco).localeCompare(String(b.ceco));
  });
  const startDate = new Date();
  startDate.setHours(12, 0, 0, 0);
  const periodEnd = addDays(startDate, horizonDays - 1);

  const stageCapacity = dataset.flowStages.map((stage) => {
    const orderLoads = activeOrders.flatMap((order) => {
      const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
      const pending = pendingStages(order, product);
      if (!pending.includes(stage.id)) return [];
      const orderComplexity = Math.max(0.5, Math.min(2.5, Number(orderComplexityMap[order.ceco] ?? 1.0)));
      const stdHours = Number(stage.standardHours ?? 6) * calibration.standardTimeBias;
      const assignedWorkers = orderWorkerAssignments[order.ceco] ?? [];
      let orderWorkerFactor = 1;
      if (assignedWorkers.length > 0) {
        const assignedEffs = assignedWorkers.map((wId) => calibration.workerEfficiencyMap[wId] ?? 100);
        const avgAssignedEff = assignedEffs.reduce((a, b) => a + b, 0) / assignedEffs.length;
        orderWorkerFactor = 100 / Math.max(50, avgAssignedEff);
      }

      const hours = stdHours * globalDemandFactor * orderComplexity * orderWorkerFactor;
      return [{ ceco: order.ceco, product: product?.name ?? order.bodyTypeId, hours: Number(hours.toFixed(1)), plannedDate: isoDate(addDays(startDate, Math.floor((pending.indexOf(stage.id) / Math.max(1, pending.length)) * horizonDays))) }];
    });
    const demandHours = orderLoads.reduce((sum, row) => sum + row.hours, 0);

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
      incidentHours,
      orders: orderLoads,
      period: formatPeriod(startDate, periodEnd)
    };
  });

  const materialAdjustments = params.materialAdjustments ?? {};
  const scenarioInventory = dataset.inventory.map((item) => {
    const stockAdjustment = Number(materialAdjustments[item.code] ?? 0);
    return stockAdjustment === 0 ? item : { ...item, physical: Math.max(0, Number(item.physical) + stockAdjustment) };
  });
  const historicalDemand = buildHistoricalDemand(dataset, startDate);
  const scheduledRequirements = [];
  activeOrders.forEach((order) => {
    const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
    const pending = pendingStages(order, product);
    const reservations = (dataset.orderMaterialReservations ?? []).filter((row) => row.ceco === order.ceco);
    (dataset.bom ?? []).filter((piece) => piece.bodyTypeId === order.bodyTypeId && pending.includes(piece.stageId)).forEach((piece) => {
      const reservation = reservations.find((row) => row.materialCode === piece.materialCode && row.stageId === piece.stageId);
      const required = reservation ? Math.max(0, Number(reservation.requiredQuantity) - Number(reservation.consumedQuantity)) : Number(piece.quantity);
      if (!required) return;
      const offset = Math.floor((pending.indexOf(piece.stageId) / Math.max(1, pending.length)) * horizonDays);
      scheduledRequirements.push({ materialCode: piece.materialCode, quantity: required, ceco: order.ceco, product: product?.name ?? order.bodyTypeId, stage: dataset.flowStages.find((stage) => stage.id === piece.stageId)?.name ?? piece.stageId, date: isoDate(addDays(startDate, offset)), source: reservation ? "reserva pendiente" : "BOM pendiente sin reserva" });
    });
  });
  const materials = scenarioInventory.map((item) => {
    const safety = Number(item.safety ?? 0);
    const needs = scheduledRequirements.filter((need) => need.materialCode === item.code).sort((a, b) => a.date.localeCompare(b.date));
    let balance = Number(item.physical);
    let firstRisk = null;
    needs.forEach((need) => {
      balance -= need.quantity;
      if (!firstRisk && balance < safety) firstRisk = { date: need.date, balance, type: balance < 0 ? "stockout" : "below_safety" };
    });
    const required = needs.reduce((sum, need) => sum + need.quantity, 0);
    const projected = Number(balance.toFixed(2));
    const leadTimeDays = Number(item.leadTimeDays);
    const demandDuringLeadTime = Number(needs.filter((need) => new Date(`${need.date}T12:00:00`) <= addDays(startDate, Number.isFinite(leadTimeDays) ? leadTimeDays : 0)).reduce((sum, need) => sum + need.quantity, 0).toFixed(2));
    const suggestedReplenishment = Number.isFinite(leadTimeDays) && firstRisk ? Math.max(0, Number((safety + demandDuringLeadTime - Number(item.physical)).toFixed(2))) : null;
    const tone = projected < 0 ? "danger" : projected < safety ? "warning" : "ok";
    return { ...item, safety, available: Number(item.physical) - Number(item.committed || 0), required, projected, coverageIndicator: safety ? Math.round((projected / safety) * 100) : null, tone, requirements: needs, firstRisk, demand: historicalDemand[item.code], leadTimeDays: Number.isFinite(leadTimeDays) ? leadTimeDays : null, demandDuringLeadTime, suggestedReplenishment };
  });
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
  const delayedOrders = activeOrders.filter((order) => order.dueDate && new Date(`${order.dueDate}T23:59:59`) < addDays(startDate, estimatedLeadDays)).length;
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
    materials,
    period: formatPeriod(startDate, periodEnd),
    startDate: isoDate(startDate),
    endDate: isoDate(periodEnd),
    demandInsights: { historical: historicalDemand, products: buildProductTrend(dataset) }
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
      situation: `Se prevé que ${scenario.activeOrders - scenario.throughput} de ${scenario.activeOrders} órdenes abiertas no queden terminables dentro del escenario.`,
      period: scenario.period,
      reason: `La limitación combina capacidad de fases y ${scenario.stockouts} material(es) con proyección negativa.`,
      affected: dataset.orders.filter((order) => Number(order.progress) < 100).map((order) => `CECO ${order.ceco}`),
      recommendedAction: "Revisar primero los cuellos de botella y las reposiciones listadas; luego reprogramar las fechas de los CECO afectados.",
      calculation: `PMP = órdenes terminables / órdenes abiertas × 100 = ${scenario.throughput} / ${scenario.activeOrders} = ${scenario.pmpCompliance}%`
    });
  }

  scenario.stageCapacity.filter((stage) => stage.utilization >= 85).forEach((stage) => {
    notifications.push({
      id: `capacity-${stage.stageId}`,
      category: "Capacidad",
      severity: stage.utilization > 100 ? "critical" : "warning",
      title: stage.utilization > 100 ? `Sobrecarga en ${stage.name}` : `${stage.name} está cerca de su capacidad`,
      value: `${stage.utilization}%`,
      situation: stage.overloadHours > 0 ? `Faltan ${stage.overloadHours} h para atender la carga planificada.` : "La fase conserva menos de 15% de holgura.",
      period: stage.period,
      reason: `${stage.demandHours} h requeridas frente a ${stage.availableHours} h disponibles${stage.incidentHours ? `; ${stage.incidentHours} h de incidencias abiertas reducen la capacidad` : ""}${stage.equipmentFactor < 1 ? "; el estado del equipo reduce la disponibilidad" : ""}.`,
      affected: stage.orders.map((row) => `CECO ${row.ceco} · ${row.product} (${row.hours} h)`),
      recommendedAction: stage.overloadHours > 0 ? `Reasignar o ampliar al menos ${stage.overloadHours} h en ${stage.name}, o desplazar los CECO de menor prioridad fuera de ${stage.period}.` : `Confirmar la disponibilidad antes de liberar más trabajo a ${stage.name}.`,
      calculation: `${stage.demandHours} h / ${stage.availableHours} h = ${stage.utilization}%`
    });
  });

  scenario.materials.filter((material) => material.firstRisk).forEach((material) => {
    notifications.push({
      id: `stock-${material.code}`,
      category: "Inventario",
      severity: material.projected < 0 ? "critical" : "warning",
      title: material.projected < 0 ? `Quiebre proyectado de ${material.code}` : `${material.code} bajo stock de seguridad`,
      value: material.firstRisk.type === "stockout" ? "Quiebre" : "Bajo mínimo",
      situation: material.firstRisk.type === "stockout" ? `El saldo proyectado llega a ${material.firstRisk.balance} ${material.unit}.` : `El saldo proyectado baja a ${material.firstRisk.balance} ${material.unit}, por debajo del mínimo de ${material.safety} ${material.unit}.`,
      period: `Riesgo estimado: ${formatPeriod(new Date(`${material.firstRisk.date}T12:00:00`), new Date(`${material.firstRisk.date}T12:00:00`))}`,
      reason: `${material.required} ${material.unit} pendientes de consumir en pedidos abiertos; el saldo físico actual es ${material.physical} ${material.unit}.`,
      affected: material.requirements.map((need) => `CECO ${need.ceco} · ${need.product} · ${need.stage}: ${need.quantity} ${material.unit} (${need.source})`),
      recommendedAction: material.suggestedReplenishment == null ? "Registrar el plazo de abastecimiento para calcular una reposición sugerida." : `Solicitar ${material.suggestedReplenishment} ${material.unit} como mínimo; cubre la demanda durante ${material.leadTimeDays} días de abastecimiento y restablece el stock de seguridad.`,
      calculation: `${material.physical} físico − ${material.required} programado = ${material.projected} ${material.unit}; SS = Z × σd × √LT = ${material.safety}`
    });
  });

  const rank = { critical: 0, warning: 1 };
  return notifications
    .map((notification) => ({ ...notification, equation: notification.calculation }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function runDigitalTwin(dataset, params = {}) {
  const calibration = params.calibrationData ?? calibrateDigitalTwin(dataset);
  const materialAdjustments = Array.isArray(params.materialAdjustments)
    ? Object.fromEntries(params.materialAdjustments.map((item) => [item.materialCode, Number(item.stockAdjustment ?? 0)]))
    : { ...(params.materialAdjustments ?? {}) };
  if (params.materialCode && params.stockAdjustment != null && !Object.prototype.hasOwnProperty.call(materialAdjustments, params.materialCode)) {
    materialAdjustments[params.materialCode] = Number(params.stockAdjustment);
  }
  const selectedPriorities = Array.isArray(params.priorityCecos)
    ? Object.fromEntries(params.priorityCecos.map((entry, index) => typeof entry === "string" ? [entry, Number(params.orderPriorityOverrides?.[entry] ?? index + 1)] : [entry.ceco, Number(entry.priority)]))
    : {};
  const normalized = {
    horizonDays: Number(params.horizonDays ?? 14),
    laborAvailability: Number(params.laborAvailability ?? 85),
    shiftsPerDay: Number(params.shiftsPerDay ?? 1),
    demandPercent: Number(params.demandPercent ?? 100),
    materialAdjustments,
    priorityCecos: params.priorityCecos ?? [],
    expediteCeco: params.expediteCeco ?? "",
    orderComplexityMap: params.orderComplexityMap ?? {},
    orderWorkerAssignments: params.orderWorkerAssignments ?? {},
    orderPriorityOverrides: { ...(params.orderPriorityOverrides ?? {}), ...selectedPriorities },
    workerInconsistencyMode: params.workerInconsistencyMode ?? "stochastic",
    absenteeismRate: Number(params.absenteeismRate ?? 5),
    inconsistencyStdDev: Number(params.inconsistencyStdDev ?? calibration.workerInconsistencyStdDev),
    calibrationData: calibration
  };

  const baseline = calculateScenario(dataset, { ...normalized, laborAvailability: 100, shiftsPerDay: 1, demandPercent: 100, materialAdjustments: {}, priorityCecos: [], expediteCeco: "", orderPriorityOverrides: {} });
  const scenario = calculateScenario(dataset, normalized);

  const notifications = buildNotifications(dataset, scenario);
  const changes = [
    `Horizonte: ${normalized.horizonDays} días.`,
    `Personal disponible: ${normalized.laborAvailability}%; ${normalized.shiftsPerDay} turno(s).`,
    `Demanda considerada: ${normalized.demandPercent}% de las órdenes abiertas.`,
    "Las proyecciones usan el inventario, los CECO abiertos, el BOM, reservas, recursos e incidencias recibidos desde Supabase al ejecutar.",
    Object.keys(normalized.orderComplexityMap).length > 0
      ? `Ajuste de complejidad aplicado a ${Object.keys(normalized.orderComplexityMap).length} orden(es) CECO.`
      : "Complejidad estándar (100%) en todas las órdenes.",
    Object.entries(normalized.materialAdjustments).filter(([, adjustment]) => Number(adjustment) !== 0).length === 0
      ? "Sin ajuste extraordinario de inventario."
      : `Ajustes de inventario: ${Object.entries(normalized.materialAdjustments).filter(([, adjustment]) => Number(adjustment) !== 0).map(([code, adjustment]) => `${code} ${Number(adjustment) > 0 ? "+" : ""}${Number(adjustment)}`).join("; ")} unidades.`,
    Object.keys(normalized.orderPriorityOverrides).length > 0
      ? `Prioridad de cola: ${Object.entries(normalized.orderPriorityOverrides).sort((a, b) => a[1] - b[1]).map(([ceco, priority]) => `${priority}. CECO ${ceco}`).join("; ")}.`
      : "Prioridad CECO sin cambios."
  ];

  return {
    params: normalized,
    calibration,
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
