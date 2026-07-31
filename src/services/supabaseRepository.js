import { supabase } from "../supabase/client.js";

export function hasSupabaseConfig() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY));
}

export const supabaseRepository = {
  async getDataset() {
    if (!supabase) {
      throw new Error("Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.");
    }
    const requiredTables = ["flow_stages", "stage_activities", "stage_inventory", "ceco_activity_progress", "body_types", "product_routes", "inventory_items", "bom_items", "ceco_orders", "operation_logs", "warehouse_exits", "quality_checks", "inventory_movements", "material_categories", "measurement_units", "brands"];
    const optionalTables = ["customers", "order_material_reservations", "work_shifts", "personnel", "equipment", "work_calendar", "resource_assignments", "operational_incidents"];
    const tables = [...requiredTables, ...optionalTables];
    const results = await Promise.all(tables.map((table) => supabase.from(table).select("*")));
    const failed = results.slice(0, requiredTables.length).find((result) => result.error);
    if (failed) throw failed.error;
    const optionalFailure = results.slice(requiredTables.length).find((result) => result.error && !["PGRST205", "42P01"].includes(result.error.code));
    if (optionalFailure) throw optionalFailure.error;
    const rows = Object.fromEntries(tables.map((table, index) => [table, results[index].error ? [] : results[index].data]));

    return {
      flowStages: rows.flow_stages.map(mapStage),
      stageActivities: rows.stage_activities.map(mapActivity),
      stageInventory: rows.stage_inventory.map(mapStageInventory),
      activityProgress: rows.ceco_activity_progress.map(mapActivityProgress),
      bodyTypes: rows.body_types.map((row) => mapBodyType(row, rows.product_routes)),
      inventory: rows.inventory_items.map(mapInventory),
      bom: rows.bom_items.map(mapBom),
      orders: rows.ceco_orders.map(mapOrder),
      customers: rows.customers.length ? rows.customers.map(mapCustomer) : legacyCustomers(rows.ceco_orders),
      orderMaterialReservations: rows.order_material_reservations.map(mapReservation),
      operations: rows.operation_logs.map(mapOperation),
      warehouse: rows.warehouse_exits.map(mapWarehouse),
      quality: rows.quality_checks.map(mapQuality),
      inventoryMovements: rows.inventory_movements.map(mapMovement),
      catalogs: { categories: rows.material_categories, units: rows.measurement_units, brands: rows.brands },
      shifts: rows.work_shifts.map(mapShift),
      personnel: rows.personnel.map(mapPerson),
      equipment: rows.equipment.map(mapEquipment),
      workCalendar: rows.work_calendar.map(mapCalendarDay),
      assignments: rows.resource_assignments.map(mapAssignment),
      incidents: rows.operational_incidents.map(mapIncident)
    };
  },
  async saveFlowStages(flowStages) {
    const rows = flowStages.map((stage, index) => ({
      id: stage.id,
      order: index,
      name: stage.name,
      short_name: stage.shortName,
      capacity_hours: stage.capacityHours,
      standard_hours: stage.standardHours,
      color: stage.color,
      gated_by_quality: stage.gatedByQuality
    }));
    const { error } = await supabase.from("flow_stages").upsert(rows);
    if (error) throw error;
    return this.getDataset();
  },
  async moveOrder(ceco, stageId) {
    const { error } = await supabase.rpc("move_order_to_stage", { p_ceco: ceco, p_stage_id: stageId });
    if (error) throw error;
    return this.getDataset();
  },
  async updateOrder(ceco, patch) {
    const customer = patch.customerId ? await supabase.from("customers").select("name").eq("id", patch.customerId).single() : null;
    if (customer?.error) throw customer.error;
    const { error } = await supabase.from("ceco_orders").update({ customer_id: patch.customerId || null, customer: customer?.data?.name || patch.customer, line: patch.line, due_date: patch.dueDate }).eq("ceco", ceco);
    if (error) throw error;
    return this.getDataset();
  },
  async updateActivityProgress(ceco, activityId, patch) {
    const { error } = await supabase.rpc("set_order_activity_progress", { p_ceco: ceco, p_activity_id: activityId, p_status: patch.status, p_progress: Number(patch.progress) });
    if (error) throw error;
    return this.getDataset();
  },
  async createOrder(payload) {
    const { error } = await supabase.rpc("create_order_with_reservations", {
      p_customer_id: payload.customerId || "", p_customer_name: payload.customer || "",
      p_body_type_id: payload.bodyTypeId, p_line: payload.line, p_due_date: payload.dueDate
    });
    if (error) throw error;
    return this.getDataset();
  },
  async createInventory(payload) {
    const { data: code, error: rpcError } = await supabase.rpc("next_inventory_code", { category_prefix: payload.category || "MAT" });
    if (rpcError) throw rpcError;
    const { error } = await supabase.from("inventory_items").insert({
      id: `inv-${code}`,
      code,
      category: payload.category || "MAT",
      category_id: payload.categoryId || null,
      description: payload.description,
      physical: Number(payload.physical),
      committed: Number(payload.committed || 0),
      safety: Number(payload.safety),
      unit: payload.unit,
      unit_id: payload.unitId || null,
      brand_id: payload.brandId || null,
      location: payload.location,
      service_factor: nullableNumber(payload.serviceFactor),
      demand_std_dev: nullableNumber(payload.demandStdDev),
      lead_time_days: nullableNumber(payload.leadTimeDays)
    });
    if (error) throw error;
    await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: "ingreso", code, ceco: "", quantity: Number(payload.physical), note: "Alta inicial de insumo" });
    return this.getDataset();
  },
  async createCatalogItem(payload) {
    const config = {
      categories: { table: "material_categories", prefix: "cat" },
      units: { table: "measurement_units", prefix: "unit" },
      brands: { table: "brands", prefix: "brand" }
    }[payload.type];
    if (!config) throw new Error("Catálogo no válido");
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Ingresa un nombre para la opción");
    const safeName = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const row = { id: `${config.prefix}-${safeName}-${Date.now()}`, name };
    if (payload.type === "units") row.symbol = String(payload.symbol || "").trim() || name.toLowerCase();
    const { error } = await supabase.from(config.table).insert(row);
    if (error) throw error;
    return this.getDataset();
  },
  async updateCatalogItem(payload) {
    const config = { categories: { table: "material_categories" }, units: { table: "measurement_units" }, brands: { table: "brands" } }[payload.type];
    if (!config) throw new Error("Catálogo no válido");
    const row = { name: String(payload.name || "").trim() };
    if (payload.type === "units") row.symbol = String(payload.symbol || "").trim();
    const { error } = await supabase.from(config.table).update(row).eq("id", payload.id);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteCatalogItem(payload) {
    const config = { categories: "material_categories", units: "measurement_units", brands: "brands" }[payload.type];
    if (!config) throw new Error("Catálogo no válido");
    const { error } = await supabase.from(config).delete().eq("id", payload.id);
    if (error) throw error;
    return this.getDataset();
  },
  async createInventoryMovement(payload) {
    const dataset = await this.getDataset();
    const item = dataset.inventory.find((entry) => entry.code === payload.code);
    if (!item) throw new Error("Material no encontrado");
    const quantity = Number(payload.quantity);
    const patch = {};
    if (payload.type === "ingreso" || payload.type === "ajuste") patch.physical = Math.max(0, Number(item.physical) + quantity);
    if (payload.type === "salida") {
      patch.physical = Math.max(0, Number(item.physical) - quantity);
      patch.committed = Math.max(0, Number(item.committed) - quantity);
    }
    if (payload.type === "reserva") patch.committed = Number(item.committed) + quantity;
    if (Object.keys(patch).length) {
      const { error: updateError } = await supabase.from("inventory_items").update(patch).eq("code", payload.code);
      if (updateError) throw updateError;
    }
    const { error } = await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: payload.type, code: payload.code, ceco: payload.ceco || "", quantity, note: payload.note });
    if (error) throw error;
    return this.getDataset();
  },
  async createBodyType(payload) {
    const { error } = await supabase.rpc("save_product_template", { p_id: "", p_code: payload.code, p_family: payload.family, p_name: payload.name, p_target_days: Number(payload.targetDays), p_output_unit: payload.outputUnit, p_route: payload.route });
    if (error) throw error;
    return this.getDataset();
  },
  async updateBodyType(id, payload) {
    const { error } = await supabase.rpc("save_product_template", { p_id: id, p_code: payload.code, p_family: payload.family, p_name: payload.name, p_target_days: Number(payload.targetDays), p_output_unit: payload.outputUnit, p_route: payload.route });
    if (error) throw error;
    return this.getDataset();
  },
  async createStageActivity(payload) {
    const dataset = await this.getDataset();
    const sequence = dataset.stageActivities.filter((item) => item.stageId === payload.stageId).length + 1;
    const { error } = await supabase.from("stage_activities").insert({ id: `act-${Date.now()}`, stage_id: payload.stageId, sequence, name: payload.name, standard_minutes: Number(payload.standardMinutes), active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async updateStageActivity(id, payload) {
    const { error } = await supabase.from("stage_activities").update({ stage_id: payload.stageId, name: payload.name, standard_minutes: Number(payload.standardMinutes), active: payload.active !== false }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async updateInventory(code, patch) {
    const { error } = await supabase.from("inventory_items").update({
      description: patch.description,
      category: patch.category,
      category_id: patch.categoryId || null,
      unit: patch.unit,
      unit_id: patch.unitId || null,
      brand_id: patch.brandId || null,
      location: patch.location,
      safety: Number(patch.safety || 0),
      service_factor: nullableNumber(patch.serviceFactor),
      demand_std_dev: nullableNumber(patch.demandStdDev),
      lead_time_days: nullableNumber(patch.leadTimeDays)
    }).eq("code", code);
    if (error) throw error;
    return this.getDataset();
  },
  async registerPurchase(code, quantity) {
    const dataset = await this.getDataset();
    const item = dataset.inventory.find((entry) => entry.code === code);
    if (!item) throw new Error("Insumo no encontrado");
    const { error } = await supabase.from("inventory_items").update({ physical: Number(item.physical) + Number(quantity) }).eq("code", code);
    if (error) throw error;
    await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: "ingreso", code, ceco: "", quantity: Number(quantity), note: "Ingreso por compra" });
    return this.getDataset();
  },
  async createWarehouseExit(payload) {
    const { error } = await supabase.rpc("issue_material_to_order", { p_ceco: payload.ceco, p_material_code: payload.materialCode, p_quantity: Number(payload.quantity) });
    if (error) throw error;
    return this.getDataset();
  },
  async consumeMaterial(payload) {
    const { error } = await supabase.from("inventory_movements").insert({
      id: `mov-${Date.now()}`,
      type: "consumo",
      code: payload.materialCode,
      ceco: payload.ceco,
      quantity: Number(payload.quantity),
      note: payload.note || "Uso de material en planta"
    });
    if (error) throw error;
    return this.getDataset();
  },
  async createOperation(payload) {
    const { error } = await supabase.from("operation_logs").insert({
      id: `op-${Date.now()}`,
      date: payload.date,
      ceco: payload.ceco,
      worker: payload.worker,
      activity: payload.activity,
      total_hours: Number(payload.totalHours)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async createQualityCheck(payload) {
    const { error } = await supabase.from("quality_checks").insert({
      id: `qa-${Date.now()}`,
      ceco: payload.ceco,
      stage_id: payload.stageId,
      inspector: payload.inspector,
      approval: payload.approval,
      observations: payload.observations
    });
    if (error) throw error;
    return this.getDataset();
  },
  async createBomItem(payload) {
    const { error } = await supabase.from("bom_items").insert({
      id: `bom-${Date.now()}`,
      body_type_id: payload.bodyTypeId,
      stage_id: payload.stageId,
      material_code: payload.materialCode,
      piece_code: payload.pieceCode,
      description: payload.description,
      length_mm: Number(payload.lengthMm),
      quantity: Number(payload.quantity)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async updateBomItem(id, patch) {
    const { error } = await supabase.from("bom_items").update({ material_code: patch.materialCode, piece_code: patch.pieceCode, description: patch.description, stage_id: patch.stageId, length_mm: Number(patch.lengthMm || 0), quantity: Number(patch.quantity) }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteBomItem(id) {
    const { error } = await supabase.from("bom_items").delete().eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async createCustomer(payload) {
    const name = String(payload.name || "").trim();
    const id = `customer-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const { error } = await supabase.from("customers").insert({ id, name, document_number: payload.documentNumber || null, contact_name: payload.contactName || null, phone: payload.phone || null, email: payload.email || null, active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async updateCustomer(id, payload) {
    const { error } = await supabase.from("customers").update({ name: payload.name, document_number: payload.documentNumber || null, contact_name: payload.contactName || null, phone: payload.phone || null, email: payload.email || null, active: payload.active !== false }).eq("id", id);
    if (error) throw error;
    const { error: orderError } = await supabase.from("ceco_orders").update({ customer: payload.name }).eq("customer_id", id);
    if (orderError) throw orderError;
    return this.getDataset();
  },
  async createShift(payload) {
    const { error } = await supabase.from("work_shifts").insert({ id: `shift-${Date.now()}`, code: payload.code, name: payload.name, start_time: payload.startTime, end_time: payload.endTime, break_minutes: Number(payload.breakMinutes), active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async createPersonnel(payload) {
    const { error } = await supabase.from("personnel").insert({ id: `person-${Date.now()}`, employee_code: payload.employeeCode, name: payload.name, role: payload.role, specialty: payload.specialty, shift_id: payload.shiftId || null, status: payload.status, efficiency: Number(payload.efficiency), weekly_hours: Number(payload.weeklyHours), active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async createEquipment(payload) {
    const { error } = await supabase.from("equipment").insert({ id: `equipment-${Date.now()}`, code: payload.code, name: payload.name, stage_id: payload.stageId, status: payload.status, capacity_hours: Number(payload.capacityHours), maintenance_due: payload.maintenanceDue || null });
    if (error) throw error;
    return this.getDataset();
  },
  async createCalendarDay(payload) {
    const { error } = await supabase.from("work_calendar").upsert({ id: `calendar-${payload.date}`, calendar_date: payload.date, day_type: payload.dayType, available_hours: Number(payload.availableHours), note: payload.note }, { onConflict: "calendar_date" });
    if (error) throw error;
    return this.getDataset();
  },
  async createAssignment(payload) {
    const { error } = await supabase.from("resource_assignments").insert({ id: `assignment-${Date.now()}`, personnel_id: payload.personnelId, ceco: payload.ceco, activity_id: payload.activityId, assigned_date: payload.assignedDate, planned_hours: Number(payload.plannedHours), status: payload.status });
    if (error) throw error;
    return this.getDataset();
  },
  async createIncident(payload) {
    const { error } = await supabase.from("operational_incidents").insert({ id: `incident-${Date.now()}`, occurred_at: payload.occurredAt, type: payload.type, severity: payload.severity, stage_id: payload.stageId, ceco: payload.ceco || null, equipment_id: payload.equipmentId || null, downtime_hours: Number(payload.downtimeHours), description: payload.description, status: "open" });
    if (error) throw error;
    return this.getDataset();
  },
  subscribe(callback) {
    const channel = supabase
      .channel("digital-twin-realtime")
      .on("postgres_changes", { event: "*", schema: "public" }, () => callback())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }
};

function mapStage(row) {
  return { id: row.id, order: row.order, name: row.name, shortName: row.short_name, capacityHours: Number(row.capacity_hours), standardHours: Number(row.standard_hours), color: row.color, gatedByQuality: row.gated_by_quality };
}

function mapBodyType(row, routes) {
  return { id: row.id, code: row.code, family: row.family, name: row.name, targetDays: Number(row.target_days), outputUnit: row.output_unit, route: routes.filter((item) => item.product_id === row.id).sort((a, b) => a.sequence - b.sequence).map((item) => item.stage_id) };
}

function mapInventory(row) {
  return { id: row.id, code: row.code, category: row.category, categoryId: row.category_id, brandId: row.brand_id, unitId: row.unit_id, description: row.description, physical: Number(row.physical), committed: Number(row.committed), safety: Number(row.safety), serviceFactor: Number(row.service_factor), demandStdDev: Number(row.demand_std_dev), leadTimeDays: Number(row.lead_time_days), unit: row.unit, location: row.location };
}

function mapBom(row) {
  return { id: row.id, bodyTypeId: row.body_type_id, stageId: row.stage_id, materialCode: row.material_code, pieceCode: row.piece_code, description: row.description, lengthMm: Number(row.length_mm), quantity: Number(row.quantity) };
}

function mapActivity(row) {
  return { id: row.id, stageId: row.stage_id, sequence: row.sequence, name: row.name, standardMinutes: Number(row.standard_minutes), active: row.active };
}

function mapStageInventory(row) {
  return { id: row.id, stageId: row.stage_id, ceco: row.ceco, item: row.item, quantity: Number(row.quantity), unit: row.unit, status: row.status };
}

function mapActivityProgress(row) {
  return { id: row.id, ceco: row.ceco, activityId: row.activity_id, status: row.status, progress: Number(row.progress), startedAt: row.started_at ? String(row.started_at).replace("T", " ").slice(0, 16) : null, finishedAt: row.finished_at ? String(row.finished_at).replace("T", " ").slice(0, 16) : null };
}

function mapOrder(row) {
  return { id: row.id, ceco: row.ceco, customerId: row.customer_id, customer: row.customer, bodyTypeId: row.body_type_id, progress: Number(row.progress), line: row.line, status: row.status, stageId: row.stage_id, plantState: row.plant_state, priority: row.priority, dueDate: row.due_date };
}

function mapCustomer(row) { return { id: row.id, documentNumber: row.document_number, name: row.name, contactName: row.contact_name, phone: row.phone, email: row.email, active: row.active }; }
function mapReservation(row) { return { id: row.id, ceco: row.ceco, bomItemId: row.bom_item_id, stageId: row.stage_id, materialCode: row.material_code, requiredQuantity: Number(row.required_quantity), reservedQuantity: Number(row.reserved_quantity), issuedQuantity: Number(row.issued_quantity), consumedQuantity: Number(row.consumed_quantity), status: row.status }; }
function nullableNumber(value) { return value === "" || value == null ? null : Number(value); }
function legacyCustomers(orders) {
  return [...new Map(orders.map((row) => [row.customer, { id: `legacy-${String(row.customer).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: row.customer, documentNumber: null, contactName: null, phone: null, email: null, active: true }])).values()];
}

function mapOperation(row) {
  return { id: row.id, date: row.date, ceco: row.ceco, worker: row.worker, activity: row.activity, totalHours: Number(row.total_hours) };
}

function mapWarehouse(row) {
  return { id: row.id, ticket: row.ticket, ceco: row.ceco, materialCode: row.material_code, quantity: Number(row.quantity), timestamp: String(row.timestamp).replace("T", " ").slice(0, 16) };
}

function mapQuality(row) {
  return { id: row.id, ceco: row.ceco, stageId: row.stage_id, inspector: row.inspector, approval: row.approval, observations: row.observations };
}

function mapMovement(row) {
  return { id: row.id, type: row.type, code: row.code, ceco: row.ceco || "", quantity: Number(row.quantity), timestamp: String(row.timestamp).replace("T", " ").slice(0, 16), note: row.note };
}

function mapShift(row) { return { id: row.id, code: row.code, name: row.name, startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), breakMinutes: Number(row.break_minutes), active: row.active }; }
function mapPerson(row) { return { id: row.id, employeeCode: row.employee_code, name: row.name, role: row.role, specialty: row.specialty, shiftId: row.shift_id, status: row.status, efficiency: Number(row.efficiency), weeklyHours: Number(row.weekly_hours), active: row.active }; }
function mapEquipment(row) { return { id: row.id, code: row.code, name: row.name, stageId: row.stage_id, status: row.status, capacityHours: Number(row.capacity_hours), maintenanceDue: row.maintenance_due }; }
function mapCalendarDay(row) { return { id: row.id, date: row.calendar_date, dayType: row.day_type, availableHours: Number(row.available_hours), note: row.note }; }
function mapAssignment(row) { return { id: row.id, personnelId: row.personnel_id, ceco: row.ceco, activityId: row.activity_id, assignedDate: row.assigned_date, plannedHours: Number(row.planned_hours), status: row.status }; }
function mapIncident(row) { return { id: row.id, occurredAt: String(row.occurred_at).replace("T", " ").slice(0, 16), type: row.type, severity: row.severity, stageId: row.stage_id, ceco: row.ceco, equipmentId: row.equipment_id, downtimeHours: Number(row.downtime_hours), description: row.description, status: row.status }; }
