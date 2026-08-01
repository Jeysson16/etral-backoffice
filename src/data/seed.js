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
  { id: "body-mixed-rail", code: "PROD-BMI", family: "Barandas", name: "Baranda Mixta", targetDays: 12, outputUnit: "und", route: ["stage-supply", "stage-prepaint", "stage-cut", "stage-assembly", "stage-paint", "stage-mount", "stage-systems", "stage-delivery"] },
  { id: "body-rail-telera", code: "PROD-BTE", family: "Barandas", name: "Baranda Telera", targetDays: 13, outputUnit: "und", route: ["stage-supply", "stage-prepaint", "stage-cut", "stage-assembly", "stage-paint", "stage-mount", "stage-delivery"] },
  { id: "body-platform", code: "PROD-PLA", family: "Plataformas", name: "Plataforma y cortaviento", targetDays: 18, outputUnit: "und", route: ["stage-supply", "stage-cut", "stage-assembly", "stage-paint", "stage-mount", "stage-systems", "stage-delivery"] },
  { id: "body-service-maint", code: "SERV-MAN", family: "Servicios", name: "Mantenimiento de carrocería", targetDays: 5, outputUnit: "serv", route: ["stage-supply", "stage-paint", "stage-systems", "stage-delivery"] },
  { id: "body-eco-box", code: "PROD-ECO", family: "Especiales", name: "Caja ecológica semicircular", targetDays: 22, outputUnit: "und", route: ["stage-supply", "stage-cut", "stage-assembly", "stage-paint", "stage-systems", "stage-delivery"] }
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
  { id: "inv-0114", code: "MAT-0114", category: "Sistema eléctrico", categoryId: "cat-electric", brandId: "brand-generic", unitId: "unit-und", description: "Base de faro lateral estandarizada", physical: 42, committed: 12, safety: 10, serviceFactor: 1.65, demandStdDev: 2.2, leadTimeDays: 7, unit: "und", location: "ALM-ELE" },
  { id: "inv-0115", code: "MAT-0115", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-aurora", unitId: "unit-gal", description: "Base epóxica Aurora", physical: 14, committed: 4, safety: 5, serviceFactor: 1.65, demandStdDev: 1.5, leadTimeDays: 7, unit: "gal", location: "ALM-PIN" },
  { id: "inv-0116", code: "MAT-0116", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-generic", unitId: "unit-kg", description: "Waype de limpieza", physical: 58, committed: 11, safety: 12, serviceFactor: 1.65, demandStdDev: 3.2, leadTimeDays: 5, unit: "kg", location: "ALM-CON" },
  { id: "inv-0117", code: "MAT-0117", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Gancho lateral tipo C para interior de carrocería", physical: 140, committed: 38, safety: 34, serviceFactor: 1.65, demandStdDev: 18, leadTimeDays: 5, unit: "und", location: "ALM-FIJ" },
  { id: "inv-0118", code: "MAT-0118", category: "Herramientas y consumibles", categoryId: "cat-welding", brandId: "brand-generic", unitId: "unit-und", description: "Tiza calderera", physical: 28, committed: 6, safety: 6, serviceFactor: 1.65, demandStdDev: 1.4, leadTimeDays: 4, unit: "und", location: "ALM-HER" },
  { id: "inv-0119", code: "MAT-0119", category: "Planchas", categoryId: "cat-steel", brandId: "brand-generic", unitId: "unit-und", description: "Refuerzo frontal tipo 2", physical: 32, committed: 10, safety: 8, serviceFactor: 1.65, demandStdDev: 2.2, leadTimeDays: 9, unit: "und", location: "ALM-PLA" },
  { id: "inv-0120", code: "MAT-0120", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Anclaje de carrocería", physical: 190, committed: 54, safety: 45, serviceFactor: 1.65, demandStdDev: 16, leadTimeDays: 5, unit: "und", location: "ALM-FIJ" },
  { id: "inv-0121", code: "MAT-0121", category: "Soldadura", categoryId: "cat-welding", brandId: "brand-generic", unitId: "unit-roll", description: "Alambre MIG MAG de 1 mm", physical: 18, committed: 6, safety: 5, serviceFactor: 1.65, demandStdDev: 1.4, leadTimeDays: 7, unit: "rollo", location: "ALM-SOL" },
  { id: "inv-0122", code: "MAT-0122", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Bisagra BP-006", physical: 62, committed: 18, safety: 14, serviceFactor: 1.65, demandStdDev: 5.6, leadTimeDays: 4, unit: "und", location: "ALM-ACC" },
  { id: "inv-0123", code: "MAT-0123", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Bisagra BL-002", physical: 74, committed: 24, safety: 18, serviceFactor: 1.65, demandStdDev: 6.5, leadTimeDays: 4, unit: "und", location: "ALM-ACC" },
  { id: "inv-0124", code: "MAT-0124", category: "Sistema eléctrico", categoryId: "cat-electric", brandId: "brand-generic", unitId: "unit-und", description: "Guardafango tipo 2", physical: 24, committed: 8, safety: 6, serviceFactor: 1.65, demandStdDev: 2, leadTimeDays: 7, unit: "und", location: "ALM-ACC" },
  { id: "inv-0125", code: "MAT-0125", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-m", description: "Jebe de hermeticidad 1 1/2 pulg.", physical: 210, committed: 52, safety: 42, serviceFactor: 1.65, demandStdDev: 15, leadTimeDays: 5, unit: "m", location: "ALM-REV" },
  { id: "inv-0126", code: "MAT-0126", category: "Fijaciones", categoryId: "cat-fastener", brandId: "brand-generic", unitId: "unit-und", description: "Autoperforante #10 x 3/4 pulg.", physical: 980, committed: 240, safety: 230, serviceFactor: 1.65, demandStdDev: 62, leadTimeDays: 5, unit: "und", location: "ALM-FIJ" },
  { id: "inv-0127", code: "MAT-0127", category: "Pinturas", categoryId: "cat-paint", brandId: "brand-3m", unitId: "unit-und", description: "Pegamento 3M", physical: 22, committed: 5, safety: 6, serviceFactor: 1.65, demandStdDev: 1.7, leadTimeDays: 7, unit: "und", location: "ALM-PIN" },
  { id: "inv-0128", code: "MAT-0128", category: "Soldadura", categoryId: "cat-welding", brandId: "brand-generic", unitId: "unit-kg", description: "Soldadura Cellocord 6011", physical: 86, committed: 20, safety: 20, serviceFactor: 1.65, demandStdDev: 7, leadTimeDays: 5, unit: "kg", location: "ALM-SOL" }
];

export const catalogsSeed = {
  categories: [
    { id: "cat-steel", name: "Planchas y perfiles" }, { id: "cat-paint", name: "Pinturas y preparación" },
    { id: "cat-welding", name: "Soldadura" }, { id: "cat-fastener", name: "Fijaciones y herrajes" },
    { id: "cat-electric", name: "Sistema eléctrico" }, { id: "cat-wood", name: "Madera y revestimiento" }
  ],
  units: [{ id: "unit-und", name: "Unidad", symbol: "und" }, { id: "unit-gal", name: "Galón", symbol: "gal" }, { id: "unit-kg", name: "Kilogramo", symbol: "kg" }, { id: "unit-m", name: "Metro", symbol: "m" }, { id: "unit-roll", name: "Rollo", symbol: "rollo" }, { id: "unit-cylinder", name: "Balón", symbol: "balón" }],
  brands: [{ id: "brand-anypsa", name: "Anypsa" }, { id: "brand-3m", name: "3M" }, { id: "brand-aurora", name: "Aurora" }, { id: "brand-fene", name: "Fene" }, { id: "brand-etral", name: "ETRAL" }, { id: "brand-generic", name: "Genérico" }]
};

export const shiftsSeed = [
  { id: "shift-day", code: "T1", name: "Turno día", startTime: "07:30", endTime: "16:30", breakMinutes: 60, active: true },
  { id: "shift-evening", code: "T2", name: "Turno tarde", startTime: "16:30", endTime: "23:30", breakMinutes: 45, active: true }
];

export const personnelSeed = [
  { id: "person-001", employeeCode: "ETR-001", name: "Luis Medina", role: "Soldador", specialty: "Soldadura estructural", shiftId: "shift-day", status: "available", efficiency: 96, weeklyHours: 48, active: true },
  { id: "person-002", employeeCode: "ETR-002", name: "Rosa Paredes", role: "Armadora", specialty: "Ensamble de carrocería", shiftId: "shift-day", status: "assigned", efficiency: 94, weeklyHours: 48, active: true },
  { id: "person-003", employeeCode: "ETR-003", name: "Marco Rojas", role: "Operador de corte", specialty: "Corte y trazado", shiftId: "shift-day", status: "assigned", efficiency: 91, weeklyHours: 48, active: true },
  { id: "person-004", employeeCode: "ETR-004", name: "Ana Reyes", role: "Pintora", specialty: "Preparación y acabado", shiftId: "shift-day", status: "available", efficiency: 93, weeklyHours: 48, active: true },
  { id: "person-005", employeeCode: "ETR-005", name: "Jorge Díaz", role: "Inspector", specialty: "Control de calidad", shiftId: "shift-evening", status: "available", efficiency: 97, weeklyHours: 42, active: true },
  { id: "person-006", employeeCode: "ETR-006", name: "Claudia Soto", role: "Inspectora", specialty: "Liberación de producto", shiftId: "shift-day", status: "absent", efficiency: 95, weeklyHours: 48, active: true }
];

export const equipmentSeed = [
  { id: "equipment-cut-01", code: "EQ-COR-01", name: "Cizalla hidráulica", stageId: "stage-cut", status: "operational", capacityHours: 44, maintenanceDue: "2026-08-10" },
  { id: "equipment-weld-01", code: "EQ-SOL-01", name: "Soldadora MIG", stageId: "stage-assembly", status: "operational", capacityHours: 50, maintenanceDue: "2026-08-07" },
  { id: "equipment-paint-01", code: "EQ-PIN-01", name: "Cabina de pintura", stageId: "stage-paint", status: "operational", capacityHours: 36, maintenanceDue: "2026-08-12" },
  { id: "equipment-lift-01", code: "EQ-MON-01", name: "Puente grúa", stageId: "stage-mount", status: "operational", capacityHours: 38, maintenanceDue: "2026-08-18" }
];

export const workCalendarSeed = [
  { id: "calendar-2026-07-31", date: "2026-07-31", dayType: "reduced", availableHours: 6, note: "Mantenimiento preventivo planificado" },
  { id: "calendar-2026-08-30", date: "2026-08-30", dayType: "holiday", availableHours: 0, note: "Feriado nacional" }
];

export const assignmentsSeed = [
  { id: "assignment-001", personnelId: "person-004", ceco: "260240", activityId: "act-paint-5", assignedDate: "2026-07-27", plannedHours: 7, status: "planned" },
  { id: "assignment-002", personnelId: "person-001", ceco: "260250", activityId: "act-assembly-3", assignedDate: "2026-07-27", plannedHours: 8, status: "in_progress" },
  { id: "assignment-003", personnelId: "person-003", ceco: "260260", activityId: "act-cut-2", assignedDate: "2026-07-27", plannedHours: 6, status: "in_progress" },
  { id: "assignment-004", personnelId: "person-005", ceco: "260270", activityId: "act-systems-4", assignedDate: "2026-07-28", plannedHours: 4, status: "planned" },
  { id: "assignment-005", personnelId: "person-002", ceco: "260210", activityId: "act-assembly-2", assignedDate: "2026-07-28", plannedHours: 6, status: "blocked" }
];

export const incidentsSeed = [
  { id: "incident-001", occurredAt: "2026-03-28 10:10", type: "material", severity: "high", stageId: "stage-assembly", ceco: "260100", equipmentId: null, downtimeHours: 18, description: "Falta de anclajes y refuerzos obligó a reprogramar la plataforma.", status: "resolved" },
  { id: "incident-002", occurredAt: "2026-07-25 09:20", type: "quality", severity: "low", stageId: "stage-paint", ceco: "260240", equipmentId: null, downtimeHours: 1, description: "Observación menor corregida antes de liberar pintura.", status: "resolved" },
  { id: "incident-003", occurredAt: "2026-07-26 11:40", type: "material", severity: "medium", stageId: "stage-assembly", ceco: "260210", equipmentId: null, downtimeHours: 4, description: "Backlog anterior al control MRP con reserva parcial de perfiles.", status: "investigating" }
];

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
  { id: "bom-12", bodyTypeId: "body-mixed-rail", stageId: "stage-paint", materialCode: "MAT-0042", pieceCode: "PZA-3103", description: "Pintura de acabado", lengthMm: 0, quantity: 8 },
  { id: "bom-13", bodyTypeId: "body-van-ribbed", stageId: "stage-doors", materialCode: "MAT-0122", pieceCode: "PZA-1105", description: "Bisagras BP-006 para puertas", lengthMm: 0, quantity: 6 },
  { id: "bom-14", bodyTypeId: "body-van-ribbed", stageId: "stage-doors", materialCode: "MAT-0123", pieceCode: "PZA-1106", description: "Bisagras BL-002 para hoja posterior", lengthMm: 0, quantity: 9 },
  { id: "bom-15", bodyTypeId: "body-van-ribbed", stageId: "stage-systems", materialCode: "MAT-0125", pieceCode: "PZA-1107", description: "Jebe de hermeticidad de puertas", lengthMm: 0, quantity: 13 },
  { id: "bom-16", bodyTypeId: "body-van-ribbed", stageId: "stage-systems", materialCode: "MAT-0126", pieceCode: "PZA-1108", description: "Autoperforantes para terminaciones", lengthMm: 0, quantity: 240 },
  { id: "bom-17", bodyTypeId: "body-van-flat", stageId: "stage-prepaint", materialCode: "MAT-0115", pieceCode: "PZA-1204", description: "Base epóxica de imprimación", lengthMm: 0, quantity: 2 },
  { id: "bom-18", bodyTypeId: "body-van-flat", stageId: "stage-doors", materialCode: "MAT-0108", pieceCode: "PZA-1205", description: "Kit de cierre posterior", lengthMm: 0, quantity: 4 },
  { id: "bom-19", bodyTypeId: "body-mixed-rail", stageId: "stage-assembly", materialCode: "MAT-0117", pieceCode: "PZA-3104", description: "Ganchos laterales tipo C", lengthMm: 0, quantity: 38 },
  { id: "bom-20", bodyTypeId: "body-mixed-rail", stageId: "stage-mount", materialCode: "MAT-0120", pieceCode: "PZA-3105", description: "Anclajes de carrocería", lengthMm: 0, quantity: 18 },
  { id: "bom-21", bodyTypeId: "body-rail-telera", stageId: "stage-cut", materialCode: "MAT-0044", pieceCode: "PZA-4101", description: "Perfiles para baranda telera", lengthMm: 6000, quantity: 14 },
  { id: "bom-22", bodyTypeId: "body-rail-telera", stageId: "stage-assembly", materialCode: "MAT-0121", pieceCode: "PZA-4102", description: "Alambre MIG MAG para ensamble", lengthMm: 0, quantity: 1 },
  { id: "bom-23", bodyTypeId: "body-rail-telera", stageId: "stage-paint", materialCode: "MAT-0102", pieceCode: "PZA-4103", description: "Base zincromato Anypsa X3", lengthMm: 0, quantity: 2 },
  { id: "bom-24", bodyTypeId: "body-platform", stageId: "stage-cut", materialCode: "MAT-0043", pieceCode: "PZA-5101", description: "Planchas para plataforma", lengthMm: 6200, quantity: 10 },
  { id: "bom-25", bodyTypeId: "body-platform", stageId: "stage-assembly", materialCode: "MAT-0119", pieceCode: "PZA-5102", description: "Refuerzos frontales tipo 2", lengthMm: 0, quantity: 2 },
  { id: "bom-26", bodyTypeId: "body-platform", stageId: "stage-systems", materialCode: "MAT-0124", pieceCode: "PZA-5103", description: "Guardafangos tipo 2", lengthMm: 0, quantity: 2 },
  { id: "bom-27", bodyTypeId: "body-service-maint", stageId: "stage-paint", materialCode: "MAT-0103", pieceCode: "PZA-6101", description: "Lijas para fierro #80", lengthMm: 0, quantity: 4 },
  { id: "bom-28", bodyTypeId: "body-service-maint", stageId: "stage-paint", materialCode: "MAT-0116", pieceCode: "PZA-6102", description: "Waype y limpieza de superficie", lengthMm: 0, quantity: 1 },
  { id: "bom-29", bodyTypeId: "body-service-maint", stageId: "stage-delivery", materialCode: "MAT-0127", pieceCode: "PZA-6103", description: "Pegamento 3M para terminaciones", lengthMm: 0, quantity: 1 },
  { id: "bom-30", bodyTypeId: "body-eco-box", stageId: "stage-cut", materialCode: "MAT-0043", pieceCode: "PZA-7101", description: "Planchas para caja semicircular", lengthMm: 6200, quantity: 12 },
  { id: "bom-31", bodyTypeId: "body-eco-box", stageId: "stage-assembly", materialCode: "MAT-0128", pieceCode: "PZA-7102", description: "Soldadura Cellocord 6011", lengthMm: 0, quantity: 8 },
  { id: "bom-32", bodyTypeId: "body-eco-box", stageId: "stage-paint", materialCode: "MAT-0113", pieceCode: "PZA-7103", description: "Sellador 3M 550", lengthMm: 0, quantity: 2 }
];

export const ordersSeed = [
  { id: "order-260240", ceco: "260240", customerId: "customer-tunesa", customer: "TUNESA EXPRES S.A.C", bodyTypeId: "body-van-ribbed", progress: 78, line: "Línea 1", status: "green", stageId: "stage-paint", plantState: "En proceso controlado", priority: 1, dueDate: "2026-08-02" },
  { id: "order-260250", ceco: "260250", customerId: "customer-lucca", customer: "TRANSPORTES LUCCA S.A.C", bodyTypeId: "body-rail-telera", progress: 64, line: "Línea 2", status: "green", stageId: "stage-assembly", plantState: "En proceso controlado", priority: 2, dueDate: "2026-08-06" },
  { id: "order-260260", ceco: "260260", customerId: "customer-soluciones-ambientales", customer: "SOLUCIONES AMBIENTALES PERU E.I.R.L", bodyTypeId: "body-eco-box", progress: 46, line: "Línea 3", status: "orange", stageId: "stage-cut", plantState: "Reserva completa, pendiente de capacidad", priority: 3, dueDate: "2026-08-12" },
  { id: "order-260270", ceco: "260270", customerId: "customer-las-americas", customer: "DISTRIBUIDORA DROGUERIA LAS AMERICAS S.A.C", bodyTypeId: "body-van-ribbed", progress: 71, line: "Línea 1", status: "green", stageId: "stage-systems", plantState: "En proceso controlado", priority: 4, dueDate: "2026-08-14" },
  { id: "order-260210", ceco: "260210", customerId: "customer-salvatierra", customer: "JAVIER SALVATIERRA FERREL", bodyTypeId: "body-rail-telera", progress: 58, line: "Línea 2", status: "red", stageId: "stage-assembly", plantState: "Backlog histórico sin liberación final", priority: 8, dueDate: "2026-05-15" },
  { id: "order-260230", ceco: "260230", customerId: "customer-jucasa", customer: "JUCASA SERVICIOS GENERALES E.I.R.L", bodyTypeId: "body-mixed-rail", progress: 100, line: "Línea 2", status: "green", stageId: "stage-delivery", plantState: "Completado", priority: 20, dueDate: "2026-05-14" },
  { id: "order-260220", ceco: "260220", customerId: "customer-jam", customer: "JAM DISTRIBUCIONES SAC", bodyTypeId: "body-service-maint", progress: 100, line: "Línea 3", status: "green", stageId: "stage-delivery", plantState: "Completado en fecha", priority: 21, dueDate: "2026-04-09" },
  { id: "order-260200", ceco: "260200", customerId: "customer-luchito", customer: "LUCHITO SANDOVAL", bodyTypeId: "body-service-maint", progress: 100, line: "Línea 3", status: "green", stageId: "stage-delivery", plantState: "Completado con atraso histórico", priority: 22, dueDate: "2026-03-27" },
  { id: "order-260100", ceco: "260100", customerId: "customer-itango", customer: "GRUPO ITANGO E.I.R.L", bodyTypeId: "body-platform", progress: 100, line: "Línea 1", status: "green", stageId: "stage-delivery", plantState: "Completado con atraso histórico", priority: 23, dueDate: "2026-03-07" },
  { id: "order-260070", ceco: "260070", customerId: "customer-prefabricasas", customer: "J.S. PREFABRICASAS CONTRATISTAS S.A.C.", bodyTypeId: "body-platform", progress: 100, line: "Línea 1", status: "green", stageId: "stage-delivery", plantState: "Completado con atraso histórico", priority: 24, dueDate: "2026-02-23" },
  { id: "order-260060", ceco: "260060", customerId: "customer-ivan-cruzado", customer: "IVAN CRUZADO", bodyTypeId: "body-mixed-rail", progress: 100, line: "Línea 2", status: "green", stageId: "stage-delivery", plantState: "Completado antes de fecha", priority: 25, dueDate: "2026-01-28" }
];

export const customersSeed = [
  { id: "customer-tunesa", name: "TUNESA EXPRES S.A.C", documentNumber: "20477167307", contactName: "Coordinación de flota", phone: "", email: "", active: true },
  { id: "customer-lucca", name: "TRANSPORTES LUCCA S.A.C", documentNumber: "20611418087", contactName: "Operaciones", phone: "", email: "", active: true },
  { id: "customer-soluciones-ambientales", name: "SOLUCIONES AMBIENTALES PERU E.I.R.L", documentNumber: "20496108664", contactName: "Logística", phone: "", email: "", active: true },
  { id: "customer-las-americas", name: "DISTRIBUIDORA DROGUERIA LAS AMERICAS S.A.C", documentNumber: "20481555371", contactName: "Mantenimiento de unidades", phone: "", email: "", active: true },
  { id: "customer-salvatierra", name: "JAVIER SALVATIERRA FERREL", documentNumber: "18083958", contactName: "", phone: "", email: "", active: true },
  { id: "customer-jucasa", name: "JUCASA SERVICIOS GENERALES E.I.R.L", documentNumber: "20529474211", contactName: "", phone: "", email: "", active: true },
  { id: "customer-jam", name: "JAM DISTRIBUCIONES SAC", documentNumber: "", contactName: "", phone: "", email: "", active: true },
  { id: "customer-luchito", name: "LUCHITO SANDOVAL", documentNumber: "", contactName: "", phone: "", email: "", active: true },
  { id: "customer-itango", name: "GRUPO ITANGO E.I.R.L", documentNumber: "20602564038", contactName: "", phone: "", email: "", active: true },
  { id: "customer-prefabricasas", name: "J.S. PREFABRICASAS CONTRATISTAS S.A.C.", documentNumber: "20606298278", contactName: "", phone: "", email: "", active: true },
  { id: "customer-ivan-cruzado", name: "IVAN CRUZADO", documentNumber: "", contactName: "", phone: "", email: "", active: true }
];

export const orderMaterialReservationsSeed = [
  { id: "reservation-260240-bom-1", ceco: "260240", bomItemId: "bom-1", stageId: "stage-cut", materialCode: "MAT-0043", requiredQuantity: 8, reservedQuantity: 8, issuedQuantity: 8, consumedQuantity: 8, status: "consumed" },
  { id: "reservation-260240-bom-2", ceco: "260240", bomItemId: "bom-2", stageId: "stage-assembly", materialCode: "MAT-0044", requiredQuantity: 16, reservedQuantity: 16, issuedQuantity: 16, consumedQuantity: 14, status: "issued" },
  { id: "reservation-260240-bom-3", ceco: "260240", bomItemId: "bom-3", stageId: "stage-paint", materialCode: "MAT-0042", requiredQuantity: 12, reservedQuantity: 12, issuedQuantity: 6, consumedQuantity: 4, status: "partial" },
  { id: "reservation-260240-bom-4", ceco: "260240", bomItemId: "bom-4", stageId: "stage-prepaint", materialCode: "MAT-0047", requiredQuantity: 3, reservedQuantity: 3, issuedQuantity: 3, consumedQuantity: 3, status: "consumed" },
  { id: "reservation-260240-bom-13", ceco: "260240", bomItemId: "bom-13", stageId: "stage-doors", materialCode: "MAT-0122", requiredQuantity: 6, reservedQuantity: 6, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260240-bom-14", ceco: "260240", bomItemId: "bom-14", stageId: "stage-doors", materialCode: "MAT-0123", requiredQuantity: 9, reservedQuantity: 9, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260240-bom-15", ceco: "260240", bomItemId: "bom-15", stageId: "stage-systems", materialCode: "MAT-0125", requiredQuantity: 13, reservedQuantity: 13, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260240-bom-16", ceco: "260240", bomItemId: "bom-16", stageId: "stage-systems", materialCode: "MAT-0126", requiredQuantity: 240, reservedQuantity: 240, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260250-bom-21", ceco: "260250", bomItemId: "bom-21", stageId: "stage-cut", materialCode: "MAT-0044", requiredQuantity: 14, reservedQuantity: 14, issuedQuantity: 14, consumedQuantity: 14, status: "consumed" },
  { id: "reservation-260250-bom-22", ceco: "260250", bomItemId: "bom-22", stageId: "stage-assembly", materialCode: "MAT-0121", requiredQuantity: 1, reservedQuantity: 1, issuedQuantity: 1, consumedQuantity: 1, status: "consumed" },
  { id: "reservation-260250-bom-23", ceco: "260250", bomItemId: "bom-23", stageId: "stage-paint", materialCode: "MAT-0102", requiredQuantity: 2, reservedQuantity: 2, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260260-bom-30", ceco: "260260", bomItemId: "bom-30", stageId: "stage-cut", materialCode: "MAT-0043", requiredQuantity: 12, reservedQuantity: 12, issuedQuantity: 6, consumedQuantity: 0, status: "partial" },
  { id: "reservation-260260-bom-31", ceco: "260260", bomItemId: "bom-31", stageId: "stage-assembly", materialCode: "MAT-0128", requiredQuantity: 8, reservedQuantity: 8, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260260-bom-32", ceco: "260260", bomItemId: "bom-32", stageId: "stage-paint", materialCode: "MAT-0113", requiredQuantity: 2, reservedQuantity: 2, issuedQuantity: 0, consumedQuantity: 0, status: "reserved" },
  { id: "reservation-260270-bom-1", ceco: "260270", bomItemId: "bom-1", stageId: "stage-cut", materialCode: "MAT-0043", requiredQuantity: 8, reservedQuantity: 8, issuedQuantity: 8, consumedQuantity: 8, status: "consumed" },
  { id: "reservation-260270-bom-2", ceco: "260270", bomItemId: "bom-2", stageId: "stage-assembly", materialCode: "MAT-0044", requiredQuantity: 16, reservedQuantity: 16, issuedQuantity: 16, consumedQuantity: 16, status: "consumed" },
  { id: "reservation-260270-bom-15", ceco: "260270", bomItemId: "bom-15", stageId: "stage-systems", materialCode: "MAT-0125", requiredQuantity: 13, reservedQuantity: 13, issuedQuantity: 13, consumedQuantity: 6, status: "issued" },
  { id: "reservation-260270-bom-16", ceco: "260270", bomItemId: "bom-16", stageId: "stage-systems", materialCode: "MAT-0126", requiredQuantity: 240, reservedQuantity: 240, issuedQuantity: 120, consumedQuantity: 80, status: "partial" },
  { id: "reservation-260210-bom-21", ceco: "260210", bomItemId: "bom-21", stageId: "stage-cut", materialCode: "MAT-0044", requiredQuantity: 14, reservedQuantity: 8, issuedQuantity: 8, consumedQuantity: 8, status: "partial" },
  { id: "reservation-260210-bom-22", ceco: "260210", bomItemId: "bom-22", stageId: "stage-assembly", materialCode: "MAT-0121", requiredQuantity: 1, reservedQuantity: 1, issuedQuantity: 1, consumedQuantity: 1, status: "consumed" },
  { id: "reservation-260210-bom-23", ceco: "260210", bomItemId: "bom-23", stageId: "stage-paint", materialCode: "MAT-0102", requiredQuantity: 2, reservedQuantity: 0, issuedQuantity: 0, consumedQuantity: 0, status: "pending" }
];

export const operationsSeed = [
  { id: "op-1", date: "2026-07-24", ceco: "260240", worker: "Ana Reyes", activity: "Aplicación de sellador", totalHours: 6.5 },
  { id: "op-2", date: "2026-07-24", ceco: "260250", worker: "Luis Medina", activity: "Soldeo de carrocería telera", totalHours: 8 },
  { id: "op-3", date: "2026-07-25", ceco: "260260", worker: "Marco Rojas", activity: "Corte de planchas para caja semicircular", totalHours: 6 },
  { id: "op-4", date: "2026-07-25", ceco: "260270", worker: "Jorge Díaz", activity: "Verificación de accesorios eléctricos", totalHours: 4 },
  { id: "op-5", date: "2026-04-09", ceco: "260220", worker: "Claudia Soto", activity: "Entrega documentada según fecha real", totalHours: 2 },
  { id: "op-6", date: "2026-04-02", ceco: "260200", worker: "Ana Reyes", activity: "Cierre de mantenimiento con atraso histórico", totalHours: 3 },
  { id: "op-7", date: "2026-04-03", ceco: "260100", worker: "Luis Medina", activity: "Liberación de plataforma reprogramada", totalHours: 5 }
];

export const stageInventorySeed = [
  { id: "wip-1", stageId: "stage-paint", ceco: "260240", item: "Furgón acanalado sellado", quantity: 1, unit: "und", status: "processing" },
  { id: "wip-2", stageId: "stage-assembly", ceco: "260250", item: "Baranda telera en soldadura", quantity: 1, unit: "und", status: "processing" },
  { id: "wip-3", stageId: "stage-cut", ceco: "260260", item: "Piezas de caja semicircular", quantity: 22, unit: "pzas", status: "processing" },
  { id: "wip-4", stageId: "stage-systems", ceco: "260270", item: "Accesorios eléctricos y cierres", quantity: 1, unit: "set", status: "processing" },
  { id: "wip-5", stageId: "stage-assembly", ceco: "260210", item: "Estructura telera incompleta", quantity: 1, unit: "und", status: "blocked" }
];

export const activityProgressSeed = [
  { id: "cap-240-1", ceco: "260240", activityId: "act-paint-1", status: "completed", progress: 100, startedAt: "2026-07-23 08:10", finishedAt: "2026-07-23 09:05" },
  { id: "cap-240-2", ceco: "260240", activityId: "act-paint-2", status: "completed", progress: 100, startedAt: "2026-07-23 09:15", finishedAt: "2026-07-23 11:20" },
  { id: "cap-240-3", ceco: "260240", activityId: "act-paint-3", status: "completed", progress: 100, startedAt: "2026-07-24 08:00", finishedAt: "2026-07-24 10:10" },
  { id: "cap-240-4", ceco: "260240", activityId: "act-paint-4", status: "completed", progress: 100, startedAt: "2026-07-24 10:20", finishedAt: "2026-07-24 12:05" },
  { id: "cap-240-5", ceco: "260240", activityId: "act-paint-5", status: "in_progress", progress: 65, startedAt: "2026-07-25 08:10", finishedAt: null },
  { id: "cap-250-1", ceco: "260250", activityId: "act-assembly-1", status: "completed", progress: 100, startedAt: "2026-07-22 08:00", finishedAt: "2026-07-22 10:00" },
  { id: "cap-250-2", ceco: "260250", activityId: "act-assembly-2", status: "completed", progress: 100, startedAt: "2026-07-22 10:15", finishedAt: "2026-07-22 12:00" },
  { id: "cap-250-3", ceco: "260250", activityId: "act-assembly-3", status: "in_progress", progress: 70, startedAt: "2026-07-24 08:00", finishedAt: null },
  { id: "cap-260-1", ceco: "260260", activityId: "act-cut-1", status: "completed", progress: 100, startedAt: "2026-07-25 07:45", finishedAt: "2026-07-25 08:30" },
  { id: "cap-260-2", ceco: "260260", activityId: "act-cut-2", status: "in_progress", progress: 55, startedAt: "2026-07-25 08:45", finishedAt: null },
  { id: "cap-270-1", ceco: "260270", activityId: "act-systems-1", status: "completed", progress: 100, startedAt: "2026-07-23 08:00", finishedAt: "2026-07-23 10:00" },
  { id: "cap-270-2", ceco: "260270", activityId: "act-systems-2", status: "completed", progress: 100, startedAt: "2026-07-23 10:15", finishedAt: "2026-07-23 12:15" },
  { id: "cap-270-3", ceco: "260270", activityId: "act-systems-3", status: "completed", progress: 100, startedAt: "2026-07-24 08:15", finishedAt: "2026-07-24 09:30" },
  { id: "cap-270-4", ceco: "260270", activityId: "act-systems-4", status: "in_progress", progress: 45, startedAt: "2026-07-25 09:00", finishedAt: null },
  { id: "cap-210-1", ceco: "260210", activityId: "act-assembly-1", status: "completed", progress: 100, startedAt: "2026-04-02 08:00", finishedAt: "2026-04-02 10:30" },
  { id: "cap-210-2", ceco: "260210", activityId: "act-assembly-2", status: "blocked", progress: 25, startedAt: "2026-04-03 08:00", finishedAt: null }
];

export const warehouseSeed = [
  { id: "wh-1", ticket: "SAL-7001", ceco: "260240", materialCode: "MAT-0043", quantity: 8, timestamp: "2026-07-20 08:35" },
  { id: "wh-2", ticket: "SAL-7002", ceco: "260240", materialCode: "MAT-0044", quantity: 16, timestamp: "2026-07-20 09:10" },
  { id: "wh-3", ticket: "SAL-7003", ceco: "260250", materialCode: "MAT-0044", quantity: 14, timestamp: "2026-07-21 10:20" },
  { id: "wh-4", ticket: "SAL-7004", ceco: "260270", materialCode: "MAT-0125", quantity: 13, timestamp: "2026-07-23 11:15" },
  { id: "wh-5", ticket: "SAL-7005", ceco: "260220", materialCode: "MAT-0103", quantity: 4, timestamp: "2026-04-09 08:30" }
];

export const inventoryMovementsSeed = [
  { id: "mov-1", type: "ingreso", code: "MAT-0043", ceco: "", quantity: 80, timestamp: "2026-07-18 08:10", note: "Reposición planificada por MRP para lote agosto" },
  { id: "mov-2", type: "ingreso", code: "MAT-0044", ceco: "", quantity: 60, timestamp: "2026-07-18 08:30", note: "Reposición de perfiles críticos" },
  { id: "mov-3", type: "reserva", code: "MAT-0043", ceco: "260240", quantity: 8, timestamp: "2026-07-19 09:20", note: "Reserva automática por BOM" },
  { id: "mov-4", type: "reserva", code: "MAT-0044", ceco: "260250", quantity: 14, timestamp: "2026-07-19 09:45", note: "Reserva automática por BOM" },
  { id: "mov-5", type: "salida", code: "MAT-0043", ceco: "260240", quantity: 8, timestamp: "2026-07-20 08:35", note: "Entrega de almacén a planta · SAL-7001" },
  { id: "mov-6", type: "salida", code: "MAT-0044", ceco: "260250", quantity: 14, timestamp: "2026-07-21 10:20", note: "Entrega de almacén a planta · SAL-7003" },
  { id: "mov-7", type: "consumo", code: "MAT-0121", ceco: "260250", quantity: 1, timestamp: "2026-07-24 16:10", note: "Uso reportado en soldado telera" },
  { id: "mov-8", type: "ajuste", code: "MAT-0044", ceco: "260210", quantity: 6, timestamp: "2026-07-26 11:40", note: "Regularización de faltante heredado antes del MRP" }
];

export const qualitySeed = [
  { id: "qa-1", ceco: "260240", stageId: "stage-paint", inspector: "Claudia Soto", approval: "approved", observations: "Sellado liberado; continúa dentro de fecha pactada." },
  { id: "qa-2", ceco: "260250", stageId: "stage-assembly", inspector: "Jorge Díaz", approval: "approved", observations: "Cordones conformes en muestra de baranda telera." },
  { id: "qa-3", ceco: "260260", stageId: "stage-cut", inspector: "Claudia Soto", approval: "pending", observations: "Pendiente de verificación dimensional final." },
  { id: "qa-4", ceco: "260220", stageId: "stage-delivery", inspector: "Jorge Díaz", approval: "approved", observations: "Entrega 2026-04-09 según fecha real registrada." },
  { id: "qa-5", ceco: "260200", stageId: "stage-delivery", inspector: "Claudia Soto", approval: "approved", observations: "Entrega real 2026-04-02; atraso histórico frente a pactada 2026-03-27." },
  { id: "qa-6", ceco: "260100", stageId: "stage-delivery", inspector: "Jorge Díaz", approval: "approved", observations: "Entrega real 2026-04-03; caso usado como línea base antes del control de reservas." }
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
  customers: customersSeed,
  orderMaterialReservations: orderMaterialReservationsSeed,
  operations: operationsSeed,
  warehouse: warehouseSeed,
  inventoryMovements: inventoryMovementsSeed,
  quality: qualitySeed,
  catalogs: catalogsSeed,
  shifts: shiftsSeed,
  personnel: personnelSeed,
  equipment: equipmentSeed,
  workCalendar: workCalendarSeed,
  assignments: assignmentsSeed,
  incidents: incidentsSeed
};
