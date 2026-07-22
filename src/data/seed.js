export const initialFlowStages = [
  { id: "stage-supply", order: 0, name: "Abastecimiento de materiales", shortName: "01", capacityHours: 40, standardHours: 4, color: "#64748b", gatedByQuality: false },
  { id: "stage-prepaint", order: 1, name: "Prepintado de componentes", shortName: "02", capacityHours: 36, standardHours: 6, color: "#0ea5e9", gatedByQuality: true },
  { id: "stage-cut", order: 2, name: "Corte de componentes", shortName: "03", capacityHours: 44, standardHours: 7, color: "#2563eb", gatedByQuality: true },
  { id: "stage-assembly", order: 3, name: "Armado de furgón acanalado", shortName: "04", capacityHours: 52, standardHours: 14, color: "#16a34a", gatedByQuality: false },
  { id: "stage-paint", order: 4, name: "Preparación de pintado general", shortName: "05", capacityHours: 34, standardHours: 16, color: "#f97316", gatedByQuality: true },
  { id: "stage-doors", order: 5, name: "Armado e instalación de puertas", shortName: "06", capacityHours: 32, standardHours: 12, color: "#8b5cf6", gatedByQuality: true },
  { id: "stage-mount", order: 6, name: "Montaje de furgón sobre chasis", shortName: "07", capacityHours: 30, standardHours: 8, color: "#d97706", gatedByQuality: true },
  { id: "stage-systems", order: 7, name: "Instalación de sistemas y accesorios", shortName: "08", capacityHours: 30, standardHours: 6, color: "#eab308", gatedByQuality: true },
  { id: "stage-delivery", order: 8, name: "Verificación y entrega", shortName: "09", capacityHours: 38, standardHours: 4, color: "#0f766e", gatedByQuality: true }
];

export const stageActivitiesSeed = [
  ["stage-supply", ["Adquisición de planchas y perfiles metálicos", "Recepción de materiales", "Transporte interno al área de corte"]],
  ["stage-prepaint", ["Lijado de piezas", "Aplicación de acondicionador de metal", "Pre-pintado", "Secado de prepintado de componentes"]],
  ["stage-cut", ["Inspección de medidas y piezas para corte", "Corte de planchas y perfiles"]],
  ["stage-assembly", ["Soldeo de falso chasis", "Resoldeo de falso chasis", "Soldeo de carrocería", "Resoldeo de carrocería", "Instalación de kit de cierre"]],
  ["stage-paint", ["Esmerilado de soldaduras", "Masillado", "Lijado y pulido", "Aplicación de sellador", "Instalación de techo", "Aplicación de pintura final de la estructura"]],
  ["stage-doors", ["Preparación de piezas", "Prepintado", "Soldado de subensamble", "Lijado", "Macillado", "Pulido", "Aplicación de sellador", "Pintado de puertas", "Instalación de jebes de puerta", "Colocación de pernos y tuercas", "Instalación de seguros de puerta", "Instalación de puertas"]],
  ["stage-mount", ["Ubicación de furgón para el montaje", "Instalación de listones de madera", "Inspección de listones de madera", "Montaje de furgón", "Instalación de abrazaderas", "Inspección de abrazaderas"]],
  ["stage-systems", ["Instalación de sistema eléctrico", "Instalación de defensas y guardafangos", "Instalación de parachoque", "Instalación de porta extintor", "Instalación de porta cono", "Instalación de porta taco"]],
  ["stage-delivery", ["Verificar", "Almacenamiento / entrega del producto"]]
].flatMap(([stageId, activities]) => activities.map((name, index) => ({
  id: `act-${stageId.replace("stage-", "")}-${index + 1}`,
  stageId,
  sequence: index + 1,
  name,
  standardMinutes: 60 + index * 15,
  active: true
})));

const furgonRoute = initialFlowStages.map((stage) => stage.id);

export const bodyTypes = [
  { id: "body-van-ribbed", code: "PROD-FAC", family: "Furgones", name: "Furgón Acanalado", targetDays: 16, outputUnit: "und", route: furgonRoute },
  { id: "body-van-flat", code: "PROD-FLI", family: "Furgones", name: "Furgón Liso", targetDays: 14, outputUnit: "und", route: furgonRoute },
  { id: "body-tank-5000", code: "PROD-CIS", family: "Cisternas", name: "Cisterna 5000G", targetDays: 20, outputUnit: "und", route: ["stage-supply", "stage-cut", "stage-assembly", "stage-paint", "stage-mount", "stage-systems", "stage-delivery"] },
  { id: "body-mixed-rail", code: "PROD-BMI", family: "Barandas", name: "Baranda Mixta", targetDays: 12, outputUnit: "und", route: ["stage-supply", "stage-prepaint", "stage-cut", "stage-assembly", "stage-paint", "stage-mount", "stage-systems", "stage-delivery"] }
];

export const inventorySeed = [
  { id: "inv-paint", code: "MAT-0042", category: "Pinturas", description: "Pintura poliuretano naranja ETRAL", physical: 38, committed: 32, safety: 15, serviceFactor: 1.65, demandStdDev: 3.4, leadTimeDays: 7, unit: "gal", location: "ALM-PIN" },
  { id: "inv-steel", code: "MAT-0043", category: "Planchas", description: "Plancha galvanizada 1.9 mm x 1200 x 2400", physical: 260, committed: 174, safety: 40, serviceFactor: 1.65, demandStdDev: 9.16, leadTimeDays: 7, unit: "und", location: "ALM-PLA" },
  { id: "inv-profile", code: "MAT-0044", category: "Perfiles", description: "Tubo cuadrado 1 1/2 pulg. x 2.0 mm", physical: 96, committed: 72, safety: 20, serviceFactor: 1.65, demandStdDev: 4.58, leadTimeDays: 7, unit: "und", location: "ALM-PER" },
  { id: "inv-electrode", code: "MAT-0045", category: "Consumibles", description: "Electrodo E7018", physical: 420, committed: 215, safety: 75, serviceFactor: 1.65, demandStdDev: 20.33, leadTimeDays: 5, unit: "kg", location: "ALM-CON" },
  { id: "inv-valve", code: "MAT-0046", category: "Accesorios", description: "Válvula para cisterna 3 pulgadas", physical: 12, committed: 10, safety: 6, serviceFactor: 1.65, demandStdDev: 0.97, leadTimeDays: 14, unit: "und", location: "ALM-ACC" },
  { id: "inv-thinner", code: "MAT-0047", category: "Pinturas", description: "Thinner acrílico industrial", physical: 54, committed: 18, safety: 12, serviceFactor: 1.65, demandStdDev: 2.75, leadTimeDays: 7, unit: "gal", location: "ALM-PIN" },
  { id: "inv-0101", code: "MAT-0101", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-generic", unitId: "unit-gal", description: "Acondicionador de metales preparado", physical: 18, committed: 3, safety: 4, serviceFactor: 1.65, demandStdDev: 1.2, leadTimeDays: 7, unit: "gal", location: "ALM-PIN" },
  { id: "inv-0102", code: "MAT-0102", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-anypsa", unitId: "unit-gal", description: "Base zincromato Anypsa X3", physical: 26, committed: 8, safety: 6, serviceFactor: 1.65, demandStdDev: 1.7, leadTimeDays: 7, unit: "gal", location: "ALM-PIN" },
  { id: "inv-0103", code: "MAT-0103", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-fene", unitId: "unit-und", description: "Papel lija de fierro gr. 80", physical: 95, committed: 14, safety: 20, serviceFactor: 1.65, demandStdDev: 5, leadTimeDays: 5, unit: "und", location: "ALM-PIN" },
  { id: "inv-0104", code: "MAT-0104", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-generic", unitId: "unit-kg", description: "Trapo industrial", physical: 42, committed: 7, safety: 8, serviceFactor: 1.65, demandStdDev: 2.1, leadTimeDays: 4, unit: "kg", location: "ALM-CON" },
  { id: "inv-0105", code: "MAT-0105", category: "Soldadura", categoryId: "cat-welding", brandId: "brand-generic", unitId: "unit-roll", description: "Alambre de soldadura E70XX", physical: 24, committed: 5, safety: 6, serviceFactor: 1.65, demandStdDev: 1.4, leadTimeDays: 7, unit: "rollo", location: "ALM-SOL" },
  { id: "inv-0106", code: "MAT-0106", category: "Soldadura", categoryId: "cat-welding", brandId: "brand-generic", unitId: "unit-cylinder", description: "Argo mix", physical: 12, committed: 3, safety: 3, serviceFactor: 1.65, demandStdDev: 0.8, leadTimeDays: 5, unit: "balón", location: "ALM-SOL" },
  { id: "inv-0107", code: "MAT-0107", category: "Soldadura", categoryId: "cat-welding", brandId: "brand-fene", unitId: "unit-und", description: "Disco de corte Fene 7 pulgadas", physical: 64, committed: 12, safety: 15, serviceFactor: 1.65, demandStdDev: 3.4, leadTimeDays: 5, unit: "und", location: "ALM-HER" },
  { id: "inv-0108", code: "MAT-0108", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Kit de cierre 134121", physical: 16, committed: 6, safety: 4, serviceFactor: 1.65, demandStdDev: 1.1, leadTimeDays: 10, unit: "und", location: "ALM-ACC" },
  { id: "inv-0109", code: "MAT-0109", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Perno zincado cabeza de coche 5/16 x 1", physical: 620, committed: 130, safety: 150, serviceFactor: 1.65, demandStdDev: 35, leadTimeDays: 5, unit: "und", location: "ALM-FIJ" },
  { id: "inv-0110", code: "MAT-0110", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Tuerca stop zincada de 5/16", physical: 540, committed: 120, safety: 140, serviceFactor: 1.65, demandStdDev: 32, leadTimeDays: 5, unit: "und", location: "ALM-FIJ" },
  { id: "inv-0111", code: "MAT-0111", category: "Planchas", categoryId: "cat-steel", brandId: "brand-generic", unitId: "unit-m", description: "Bobina de aluzinc 18000 mm ancho", physical: 160, committed: 38, safety: 35, serviceFactor: 1.65, demandStdDev: 8, leadTimeDays: 14, unit: "m", location: "ALM-PLA" },
  { id: "inv-0112", code: "MAT-0112", category: "Madera y revestimiento", categoryId: "cat-wood", brandId: "brand-generic", unitId: "unit-m", description: "Bobina de fibra de vidrio translúcida 2600 mm ancho", physical: 45, committed: 9, safety: 10, serviceFactor: 1.65, demandStdDev: 2.8, leadTimeDays: 12, unit: "m", location: "ALM-REV" },
  { id: "inv-0113", code: "MAT-0113", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-3m", unitId: "unit-und", description: "Sellador 3M 550 + boquilla", physical: 36, committed: 8, safety: 10, serviceFactor: 1.65, demandStdDev: 2.3, leadTimeDays: 7, unit: "und", location: "ALM-PIN" },
  { id: "inv-0114", code: "MAT-0114", category: "Sistema eléctrico", categoryId: "cat-electric", brandId: "brand-generic", unitId: "unit-und", description: "Base de faro lateral estandarizada", physical: 42, committed: 12, safety: 10, serviceFactor: 1.65, demandStdDev: 2.2, leadTimeDays: 7, unit: "und", location: "ALM-ELE" }
];

export const catalogsSeed = {
  categories: [
    { id: "cat-steel", name: "Planchas y perfiles" }, { id: "cat-paint", name: "Pinturas y preparación" },
    { id: "cat-welding", name: "Soldadura" }, { id: "cat-fastener", name: "Fijaciones y herrajes" },
    { id: "cat-electric", name: "Sistema eléctrico" }, { id: "cat-wood", name: "Madera y revestimiento" }
  ],
  units: [{ id: "unit-und", name: "Unidad", symbol: "und" }, { id: "unit-gal", name: "Galón", symbol: "gal" }, { id: "unit-kg", name: "Kilogramo", symbol: "kg" }, { id: "unit-m", name: "Metro", symbol: "m" }, { id: "unit-roll", name: "Rollo", symbol: "rollo" }],
  brands: [{ id: "brand-anypsa", name: "Anypsa" }, { id: "brand-3m", name: "3M" }, { id: "brand-aurora", name: "Aurora" }, { id: "brand-fene", name: "Fene" }, { id: "brand-etral", name: "ETRAL" }, { id: "brand-generic", name: "Genérico" }]
};

export const bomSeed = [
  { id: "bom-1", bodyTypeId: "body-van-ribbed", stageId: "stage-cut", materialCode: "MAT-0043", pieceCode: "PZA-1101", description: "Panel lateral acanalado", lengthMm: 6200, quantity: 8 },
  { id: "bom-2", bodyTypeId: "body-van-ribbed", stageId: "stage-assembly", materialCode: "MAT-0044", pieceCode: "PZA-1102", description: "Perfil estructural", lengthMm: 6000, quantity: 16 },
  { id: "bom-3", bodyTypeId: "body-van-ribbed", stageId: "stage-paint", materialCode: "MAT-0042", pieceCode: "PZA-1103", description: "Pintura poliuretano", lengthMm: 0, quantity: 12 },
  { id: "bom-4", bodyTypeId: "body-van-ribbed", stageId: "stage-prepaint", materialCode: "MAT-0047", pieceCode: "PZA-1104", description: "Thinner de preparación", lengthMm: 0, quantity: 3 },
  { id: "bom-5", bodyTypeId: "body-van-flat", stageId: "stage-cut", materialCode: "MAT-0043", pieceCode: "PZA-1201", description: "Panel lateral liso", lengthMm: 6200, quantity: 6 },
  { id: "bom-6", bodyTypeId: "body-van-flat", stageId: "stage-paint", materialCode: "MAT-0042", pieceCode: "PZA-1203", description: "Pintura poliuretano", lengthMm: 0, quantity: 10 },
  { id: "bom-7", bodyTypeId: "body-tank-5000", stageId: "stage-assembly", materialCode: "MAT-0043", pieceCode: "PZA-2101", description: "Cilindro rolado", lengthMm: 5800, quantity: 10 },
  { id: "bom-8", bodyTypeId: "body-tank-5000", stageId: "stage-systems", materialCode: "MAT-0046", pieceCode: "PZA-2103", description: "Válvula descarga 3 pulgadas", lengthMm: 0, quantity: 2 },
  { id: "bom-9", bodyTypeId: "body-tank-5000", stageId: "stage-assembly", materialCode: "MAT-0045", pieceCode: "PZA-2104", description: "Consumible de soldadura", lengthMm: 0, quantity: 45 },
  { id: "bom-10", bodyTypeId: "body-mixed-rail", stageId: "stage-cut", materialCode: "MAT-0043", pieceCode: "PZA-3101", description: "Plancha de baranda", lengthMm: 2400, quantity: 5 },
  { id: "bom-11", bodyTypeId: "body-mixed-rail", stageId: "stage-assembly", materialCode: "MAT-0044", pieceCode: "PZA-3102", description: "Tubos estructurales", lengthMm: 6000, quantity: 12 },
  { id: "bom-12", bodyTypeId: "body-mixed-rail", stageId: "stage-paint", materialCode: "MAT-0042", pieceCode: "PZA-3103", description: "Pintura de acabado", lengthMm: 0, quantity: 8 }
];

export const ordersSeed = [
  { id: "order-260180", ceco: "260180", customer: "Andes Cargo", bodyTypeId: "body-van-ribbed", progress: 68, line: "Línea 1", status: "green", stageId: "stage-paint", plantState: "En proceso", priority: 1, dueDate: "2026-07-16" },
  { id: "order-260181", ceco: "260181", customer: "Sur Express", bodyTypeId: "body-van-flat", progress: 18, line: "Línea 2", status: "orange", stageId: "stage-prepaint", plantState: "En cola", priority: 3, dueDate: "2026-07-18" },
  { id: "order-260182", ceco: "260182", customer: "Pacífico Oil", bodyTypeId: "body-tank-5000", progress: 42, line: "Línea 3", status: "green", stageId: "stage-assembly", plantState: "En proceso", priority: 2, dueDate: "2026-07-21" },
  { id: "order-260183", ceco: "260183", customer: "Norte Farma", bodyTypeId: "body-van-ribbed", progress: 37, line: "Línea 1", status: "red", stageId: "stage-assembly", plantState: "Bloqueado por material", priority: 4, dueDate: "2026-07-23" },
  { id: "order-260184", ceco: "260184", customer: "Minerales SAC", bodyTypeId: "body-mixed-rail", progress: 31, line: "Línea 3", status: "orange", stageId: "stage-cut", plantState: "En proceso", priority: 5, dueDate: "2026-07-25" }
];

export const operationsSeed = [
  { id: "op-1", date: "2026-07-12", ceco: "260180", worker: "Luis Medina", activity: "Aplicación de pintura final", totalHours: 7.5 },
  { id: "op-2", date: "2026-07-12", ceco: "260182", worker: "Rosa Paredes", activity: "Soldeo de estructura", totalHours: 8 },
  { id: "op-3", date: "2026-07-12", ceco: "260184", worker: "Marco Rojas", activity: "Corte de componentes", totalHours: 6.5 },
  { id: "op-4", date: "2026-07-11", ceco: "260181", worker: "Ana Reyes", activity: "Pre-pintado", totalHours: 4 }
];

export const stageInventorySeed = [
  { id: "wip-1", stageId: "stage-paint", ceco: "260180", item: "Carrocería lista para acabado", quantity: 1, unit: "und", status: "processing" },
  { id: "wip-2", stageId: "stage-prepaint", ceco: "260181", item: "Componentes preparados", quantity: 26, unit: "pzas", status: "waiting" },
  { id: "wip-3", stageId: "stage-assembly", ceco: "260182", item: "Conjunto de cisterna", quantity: 1, unit: "und", status: "processing" },
  { id: "wip-4", stageId: "stage-assembly", ceco: "260183", item: "Estructura parcial", quantity: 1, unit: "und", status: "blocked" },
  { id: "wip-5", stageId: "stage-cut", ceco: "260184", item: "Piezas cortadas", quantity: 18, unit: "pzas", status: "processing" }
];

export const activityProgressSeed = [
  { id: "cap-180-1", ceco: "260180", activityId: "act-paint-1", status: "completed", progress: 100, startedAt: "2026-07-12 08:10", finishedAt: "2026-07-12 09:05" },
  { id: "cap-180-2", ceco: "260180", activityId: "act-paint-2", status: "completed", progress: 100, startedAt: "2026-07-12 09:15", finishedAt: "2026-07-12 11:20" },
  { id: "cap-180-3", ceco: "260180", activityId: "act-paint-3", status: "in_progress", progress: 65, startedAt: "2026-07-12 11:30", finishedAt: null },
  { id: "cap-181-1", ceco: "260181", activityId: "act-prepaint-1", status: "completed", progress: 100, startedAt: "2026-07-12 07:50", finishedAt: "2026-07-12 08:25" },
  { id: "cap-181-2", ceco: "260181", activityId: "act-prepaint-2", status: "in_progress", progress: 40, startedAt: "2026-07-12 08:35", finishedAt: null },
  { id: "cap-182-1", ceco: "260182", activityId: "act-assembly-1", status: "completed", progress: 100, startedAt: "2026-07-11 08:00", finishedAt: "2026-07-11 09:10" },
  { id: "cap-182-2", ceco: "260182", activityId: "act-assembly-2", status: "completed", progress: 100, startedAt: "2026-07-11 09:20", finishedAt: "2026-07-11 13:00" },
  { id: "cap-182-3", ceco: "260182", activityId: "act-assembly-3", status: "in_progress", progress: 55, startedAt: "2026-07-12 08:05", finishedAt: null },
  { id: "cap-183-1", ceco: "260183", activityId: "act-assembly-1", status: "completed", progress: 100, startedAt: "2026-07-10 08:00", finishedAt: "2026-07-10 12:10" },
  { id: "cap-183-2", ceco: "260183", activityId: "act-assembly-2", status: "blocked", progress: 25, startedAt: "2026-07-11 08:15", finishedAt: null },
  { id: "cap-184-1", ceco: "260184", activityId: "act-cut-1", status: "completed", progress: 100, startedAt: "2026-07-12 07:45", finishedAt: "2026-07-12 08:35" },
  { id: "cap-184-2", ceco: "260184", activityId: "act-cut-2", status: "in_progress", progress: 70, startedAt: "2026-07-12 08:45", finishedAt: null }
];

export const warehouseSeed = [
  { id: "wh-1", ticket: "SAL-7001", ceco: "260180", materialCode: "MAT-0042", quantity: 12, timestamp: "2026-07-10 08:35" },
  { id: "wh-2", ticket: "SAL-7002", ceco: "260182", materialCode: "MAT-0045", quantity: 80, timestamp: "2026-07-10 11:20" },
  { id: "wh-3", ticket: "SAL-7003", ceco: "260184", materialCode: "MAT-0043", quantity: 24, timestamp: "2026-07-11 09:10" }
];

export const inventoryMovementsSeed = [
  { id: "mov-1", type: "ingreso", code: "MAT-0042", ceco: "", quantity: 50, timestamp: "2026-07-09 08:10", note: "Compra inicial pintura" },
  { id: "mov-2", type: "reserva", code: "MAT-0042", ceco: "260180", quantity: 12, timestamp: "2026-07-09 09:20", note: "Reserva MRP por BOM" },
  { id: "mov-3", type: "salida", code: "MAT-0042", ceco: "260180", quantity: 12, timestamp: "2026-07-10 08:35", note: "Entrega de almacén a planta" },
  { id: "mov-4", type: "consumo", code: "MAT-0045", ceco: "260182", quantity: 20, timestamp: "2026-07-10 15:40", note: "Uso reportado en soldado" }
];

export const qualitySeed = [
  { id: "qa-1", ceco: "260180", stageId: "stage-paint", inspector: "Claudia Soto", approval: "approved", observations: "Espesor conforme." },
  { id: "qa-2", ceco: "260182", stageId: "stage-assembly", inspector: "Jorge Díaz", approval: "observed", observations: "Revisar cordón en soporte." },
  { id: "qa-3", ceco: "260183", stageId: "stage-assembly", inspector: "Claudia Soto", approval: "pending", observations: "Bloqueado por material." }
];

export const initialDataset = {
  flowStages: initialFlowStages,
  stageActivities: stageActivitiesSeed,
  stageInventory: stageInventorySeed,
  activityProgress: activityProgressSeed,
  bodyTypes,
  inventory: inventorySeed,
  bom: bomSeed,
  orders: ordersSeed,
  operations: operationsSeed,
  warehouse: warehouseSeed,
  inventoryMovements: inventoryMovementsSeed,
  quality: qualitySeed,
  catalogs: catalogsSeed
};
