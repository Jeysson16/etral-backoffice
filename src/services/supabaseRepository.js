import { supabase } from "../supabase/client.js";
import { consolidateImportedMaterials, findMatchingMaterial } from "../lib/materialImport.js";
import { orderProductRoute } from "../lib/productRoutes.js";
import { effectiveOrderStageId } from "../lib/mrp.js";
import { toLocalDateTimeInput, toUtcTimestamp } from "../lib/dateTime.js";

export function hasSupabaseConfig() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY));
}

export const supabaseRepository = {
  async getDataset() {
    if (!supabase) {
      throw new Error("Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.");
    }
    const requiredTables = ["flow_stages", "stage_activities", "stage_inventory", "ceco_activity_progress", "body_types", "product_routes", "inventory_items", "bom_items", "ceco_orders", "operation_logs", "warehouse_exits", "quality_checks", "inventory_movements", "material_categories", "measurement_units", "brands", "product_families", "production_lines"];
    // El módulo de Recursos debe recargarse como un conjunto: si se guarda un
    // trabajador, equipo, excepción, asignación o incidencia, getDataset()
    // devuelve de inmediato esa misma colección. Las instalaciones previas a
    // esta migración siguen siendo compatibles porque estas tablas son
    // opcionales hasta que existan en el proyecto remoto.
    const optionalTables = [
      "customers", "order_material_reservations", "work_shifts", "personnel", "personnel_work_shifts",
      "equipment", "work_calendar", "resource_assignments", "operational_incidents"
    ];
    const tables = [...requiredTables, ...optionalTables];
    const results = await Promise.all(tables.map((table) => supabase.from(table).select("*")));
    const failed = results.slice(0, requiredTables.length).find((result) => result.error);
    if (failed) throw failed.error;
    const optionalFailure = results.slice(requiredTables.length).find((result) => result.error && !["PGRST205", "42P01"].includes(result.error.code));
    if (optionalFailure) throw optionalFailure.error;
    const rows = Object.fromEntries(tables.map((table, index) => [table, results[index].error ? [] : results[index].data]));
    const flowStages = rows.flow_stages.map(mapStage);
    const stageActivities = rows.stage_activities.map(mapActivity);
    const activityProgress = rows.ceco_activity_progress.map(mapActivityProgress);
    const bodyTypes = rows.body_types.map((row) => mapBodyType(row, rows.product_routes));
    const orders = rows.ceco_orders.map(mapOrder).map((order) => ({
      ...order,
      stageId: effectiveOrderStageId(order, bodyTypes, stageActivities, activityProgress)
    }));

    return {
      flowStages,
      stageActivities,
      stageInventory: rows.stage_inventory.map(mapStageInventory),
      activityProgress,
      bodyTypes,
      inventory: rows.inventory_items.map(mapInventory),
      bom: rows.bom_items.map(mapBom),
      orders,
      customers: rows.customers.length ? rows.customers.map(mapCustomer) : legacyCustomers(rows.ceco_orders),
      orderMaterialReservations: rows.order_material_reservations.map(mapReservation),
      operations: rows.operation_logs.map(mapOperation),
      warehouse: rows.warehouse_exits.map(mapWarehouse),
      quality: rows.quality_checks.map(mapQuality),
      inventoryMovements: rows.inventory_movements.map(mapMovement),
      catalogs: { categories: rows.material_categories, units: rows.measurement_units, brands: rows.brands },
      productFamilies: rows.product_families,
      productionLines: rows.production_lines,
      shifts: rows.work_shifts.map(mapShift),
      personnel: (rows.personnel ?? []).map((row) => mapPerson(row, rows.personnel_work_shifts ?? [])),
      equipment: (rows.equipment ?? []).map(mapEquipment),
      workCalendar: (rows.work_calendar ?? []).map(mapCalendarDay),
      assignments: (rows.resource_assignments ?? []).map(mapAssignment),
      incidents: (rows.operational_incidents ?? []).map(mapIncident)
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
    const nextCeco = patch.ceco ? String(patch.ceco).trim() : ceco;
    if (!/^\d{6}$/.test(nextCeco)) throw new Error("El correlativo CECO debe tener 6 dígitos numéricos");
    const values = {};
    if (nextCeco !== ceco) values.ceco = nextCeco;
    if (Object.hasOwn(patch, "customerId")) { values.customer_id = patch.customerId || null; values.customer = customer?.data?.name || patch.customer; }
    if (Object.hasOwn(patch, "line")) values.line = patch.line;
    if (Object.hasOwn(patch, "plannedStartDate")) values.planned_start_date = patch.plannedStartDate || null;
    if (Object.hasOwn(patch, "dueDate")) values.due_date = patch.dueDate || null;
    if (Object.hasOwn(patch, "active")) values.active = Boolean(patch.active);
    if (Object.hasOwn(patch, "outputValue")) values.sale_amount_pen = nullableNumber(patch.outputValue);
    if (Object.hasOwn(patch, "outputValue")) values.output_value_basis = patch.outputValueBasis ?? "Registrado en CECO";
    if (Object.hasOwn(patch, "energyCost")) values.energy_cost = nullableNumber(patch.energyCost);
    if (Object.hasOwn(patch, "energyCost")) values.energy_cost_basis = patch.energyCostBasis ?? "Registrado en CECO";
    if (Object.hasOwn(patch, "capitalCost")) values.capital_cost = nullableNumber(patch.capitalCost);
    if (Object.hasOwn(patch, "capitalCost")) values.capital_cost_basis = patch.capitalCostBasis ?? "Registrado en CECO";
    if (Object.hasOwn(patch, "actualDeliveryDate")) values.actual_finish_date = patch.actualDeliveryDate || null;
    const { error } = await supabase.from("ceco_orders").update(values).eq("ceco", ceco);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteOrder(ceco) {
    const { error } = await supabase.rpc("delete_ceco_order", { p_ceco: ceco });
    if (error) throw error;
    return this.getDataset();
  },
  async updateOrderPriorities(entries) {
    const updates = entries.map((entry) => supabase.from("ceco_orders").update({ priority: Number(entry.priority) }).eq("ceco", entry.ceco));
    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    return this.getDataset();
  },
  async updateActivityProgress(ceco, activityId, patch) {
    const { error } = await supabase.rpc("set_order_activity_progress", {
      p_ceco: ceco,
      p_activity_id: activityId,
      p_status: patch.status,
      p_progress: Number(patch.progress),
      p_started_at: patch.updateTimestamps ? toUtcTimestamp(patch.startedAt) : null,
      p_finished_at: patch.updateTimestamps ? toUtcTimestamp(patch.finishedAt) : null,
      p_update_timestamps: Boolean(patch.updateTimestamps)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async updateActivitySchedules(ceco, entries) {
    const updates = entries.map((entry) => supabase.rpc("set_order_activity_schedule", {
      p_ceco: ceco,
      p_activity_id: entry.activityId,
      p_planned_start_date: entry.plannedStartDate,
      p_planned_end_date: entry.plannedEndDate
    }));
    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    return this.getDataset();
  },
  async createOrder(payload) {
    const { error } = await supabase.rpc("create_order_with_reservations", {
      p_customer_id: payload.customerId || "", p_customer_name: payload.customer || "",
      p_body_type_id: payload.bodyTypeId, p_planned_start_date: payload.plannedStartDate, p_due_date: payload.dueDate, p_ceco: payload.ceco || null
    });
    if (error) throw error;
    const values = {};
    if (payload.outputValue != null) { values.sale_amount_pen = Number(payload.outputValue); values.output_value_basis = "Registrado en CECO"; }
    if (payload.energyCost != null) { values.energy_cost = Number(payload.energyCost); values.energy_cost_basis = "Registrado en CECO"; }
    if (payload.capitalCost != null) { values.capital_cost = Number(payload.capitalCost); values.capital_cost_basis = "Registrado en CECO"; }
    if (Object.keys(values).length) {
      const { error: valueError } = await supabase.from("ceco_orders").update(values).eq("ceco", payload.ceco);
      if (valueError) throw valueError;
    }
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
      lead_time_days: nullableNumber(payload.leadTimeDays),
      average_demand: nullableNumber(payload.averageDemand),
      lead_time_std_dev: nullableNumber(payload.leadTimeStdDev),
      service_level: nullableNumber(payload.serviceLevel),
      unit_cost: nullableNumber(payload.unitCost),
      unit_cost_basis: payload.unitCost == null ? null : payload.unitCostBasis ?? "Registrado en Inventario",
      safety_parameters_basis: payload.safetyParametersBasis ?? "Registrado en Inventario"
    });
    if (error) throw error;
    await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: "ingreso", code, ceco: "", quantity: Number(payload.physical), note: "Alta inicial de insumo" });
    return this.getDataset();
  },
  async importCatalogData(payload) {
    const dataset = await this.getDataset();
    const stamp = Date.now();
    const slug = (value) => String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const ensureCatalog = async (type, name, symbol = "") => {
      if (!name) return null;
      const collection = dataset.catalogs[type];
      let current = collection.find((item) => item.name.toLowerCase() === name.toLowerCase() || (type === "units" && item.symbol === name));
      if (current) return current;
      const config = { categories: { table: "material_categories", prefix: "cat" }, units: { table: "measurement_units", prefix: "unit" }, brands: { table: "brands", prefix: "brand" } }[type];
      const row = { id: `${config.prefix}-import-${slug(name)}-${stamp}-${collection.length}`, name };
      if (type === "units") row.symbol = symbol || name;
      const { error } = await supabase.from(config.table).insert(row);
      if (error) throw error;
      current = { ...row };
      collection.push(current);
      return current;
    };
    const importedCodes = new Map();
    const materialRowsByCode = new Map();
    const movementRows = [];
    for (const row of consolidateImportedMaterials(payload.materials)) {
      const category = await ensureCatalog("categories", row.category);
      const unit = await ensureCatalog("units", row.unit, row.unit);
      const brand = await ensureCatalog("brands", row.brand);
      const existing = findMatchingMaterial(dataset.inventory, row);
      const generated = !existing && !row.code ? await supabase.rpc("next_inventory_code", { category_prefix: row.category || "MAT" }) : null;
      if (generated?.error) throw generated.error;
      const code = existing?.code || row.code || generated?.data;
      if (!code) throw new Error(`No se pudo generar el código para material fila ${row.row}.`);
      const previous = materialRowsByCode.get(code);
      const physical = previous
        ? Number(previous.physical || 0) + Number(row.physical || 0)
        : Number(existing?.physical || 0) + Number(row.physical || 0);
      const data = { category: category.name, category_id: category.id, description: row.description, physical, safety: Number(row.safety ?? existing?.safety ?? previous?.safety ?? 0), unit: unit.symbol, unit_id: unit.id, brand_id: brand?.id || null, location: row.location || null, service_factor: nullableNumber(row.serviceFactor ?? existing?.serviceFactor ?? previous?.service_factor), demand_std_dev: nullableNumber(row.demandStdDev ?? existing?.demandStdDev ?? previous?.demand_std_dev), lead_time_days: nullableNumber(row.leadTimeDays ?? existing?.leadTimeDays ?? previous?.lead_time_days), average_demand: nullableNumber(row.averageDemand ?? existing?.averageDemand ?? previous?.average_demand), lead_time_std_dev: nullableNumber(row.leadTimeStdDev ?? existing?.leadTimeStdDev ?? previous?.lead_time_std_dev), service_level: nullableNumber(row.serviceLevel ?? existing?.serviceLevel ?? previous?.service_level), unit_cost: nullableNumber(row.unitCost ?? existing?.unitCost ?? previous?.unit_cost), unit_cost_basis: row.unitCost == null ? existing?.unitCostBasis ?? previous?.unit_cost_basis ?? null : "Importado de Excel", safety_parameters_basis: row.averageDemand == null ? existing?.safetyParametersBasis ?? previous?.safety_parameters_basis ?? null : "Importado de Excel", currency: row.currency || "PEN" };
      materialRowsByCode.set(code, { id: existing?.id || previous?.id || `inv-${code}`, code, committed: Number(existing?.committed ?? previous?.committed ?? 0), ...data });
      for (const sourceCode of row.sourceCodes?.length ? row.sourceCodes : [row.code]) {
        importedCodes.set(sourceCode, code);
      }
      if (Number(row.physical) !== 0) {
        movementRows.push({ id: `mov-import-${stamp}-${row.row}`, type: "ingreso", code, ceco: "", quantity: Number(row.physical), note: "Carga inicial mediante Excel" });
      }
    }
    const materialRows = [...materialRowsByCode.values()];
    if (materialRows.length) {
      const { error } = await supabase.from("inventory_items").upsert(materialRows, { onConflict: "code" });
      if (error) throw error;
    }
    if (movementRows.length) {
      const { error } = await supabase.from("inventory_movements").insert(movementRows);
      if (error) throw error;
    }
    const refreshed = await this.getDataset();
    for (const row of payload.products || []) {
      const family = refreshed.productFamilies.find((item) => item.name.toLowerCase() === row.family.toLowerCase());
      const brand = await ensureCatalog("brands", row.brand || "Genérico");
      const unit = await ensureCatalog("units", row.outputUnit, row.outputUnit);
      const route = orderProductRoute(refreshed.flowStages, row.route.map((code) => refreshed.flowStages.find((stage) => stage.id === code || stage.code === code)?.id).filter(Boolean));
      const existing = refreshed.bodyTypes.find((item) => item.code === row.code);
      if (!row.code || !row.name || !family || !route.length) throw new Error(`Producto fila ${row.row}: código, nombre, familia y ruta válida son obligatorios.`);
      const { error } = await supabase.rpc("save_product_template", { p_id: existing?.id || "", p_code: row.code, p_family_id: family.id, p_brand_id: brand.id, p_name: row.name, p_target_days: Number(row.targetDays || 1), p_output_unit_id: unit.id, p_route: route });
      if (error) throw error;
    }
    const finalDataset = await this.getDataset();
    const bomRows = [];
    for (const row of payload.bom || []) {
      const product = finalDataset.bodyTypes.find((item) => item.code === row.productCode);
      const materialCode = importedCodes.get(row.materialCode) || row.materialCode;
      const material = finalDataset.inventory.find((item) => item.code === materialCode);
      const stage = finalDataset.flowStages.find((item) => item.id === row.stageCode || item.code === row.stageCode);
      if (!product || !material || !stage || !row.pieceCode || Number(row.quantity) <= 0) throw new Error(`BOM fila ${row.row}: producto, material, fase, código de pieza y cantidad deben ser válidos.`);
      const existing = finalDataset.bom.find((item) => item.bodyTypeId === product.id && item.pieceCode === row.pieceCode);
      const data = { body_type_id: product.id, stage_id: stage.id, source_phase_code: row.sourcePhaseCode || null, material_code: material.code, piece_code: row.pieceCode, description: row.description || material.description, length_mm: Number(row.lengthMm || 0), quantity: Number(row.quantity) };
      bomRows.push({ id: existing?.id || `bom-import-${slug(product.code)}-${slug(row.pieceCode)}`, ...data });
    }
    if (bomRows.length) {
      const { error } = await supabase.from("bom_items").upsert(bomRows, { onConflict: "id" });
      if (error) throw error;
      const affectedProducts = new Set(bomRows.map((row) => row.body_type_id));
      const affectedCecos = finalDataset.orders.filter((order) => affectedProducts.has(order.bodyTypeId)).map((order) => order.ceco);
      for (const ceco of affectedCecos) {
        const { error: reservationError } = await supabase.rpc("refresh_order_material_reservations", { p_ceco: ceco });
        if (reservationError) throw reservationError;
      }
    }
    return this.getDataset();
  },
  async createCatalogItem(payload) {
    const config = {
      categories: { table: "material_categories", prefix: "cat" },
      units: { table: "measurement_units", prefix: "unit" },
      brands: { table: "brands", prefix: "brand" },
      families: { table: "product_families", prefix: "family" }
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
    const config = { categories: { table: "material_categories" }, units: { table: "measurement_units" }, brands: { table: "brands" }, families: { table: "product_families" } }[payload.type];
    if (!config) throw new Error("Catálogo no válido");
    const row = { name: String(payload.name || "").trim() };
    if (payload.type === "units") row.symbol = String(payload.symbol || "").trim();
    const { error } = await supabase.from(config.table).update(row).eq("id", payload.id);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteCatalogItem(payload) {
    const config = { categories: "material_categories", units: "measurement_units", brands: "brands", families: "product_families" }[payload.type];
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
    const { error } = await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: payload.type, code: payload.code, ceco: payload.ceco || "", quantity, timestamp: toUtcTimestamp(payload.timestamp) || new Date().toISOString(), note: payload.note });
    if (error) throw error;
    return this.getDataset();
  },
  async updateInventoryMovementTimestamp(id, timestamp) {
    const { error } = await supabase.from("inventory_movements").update({ timestamp: toUtcTimestamp(timestamp) }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async refreshOrderReservations(ceco) {
    const { error } = await supabase.rpc("refresh_order_material_reservations", { p_ceco: ceco });
    if (error) throw error;
    return this.getDataset();
  },
  async replenishAndReserve(payload) {
    const { error } = await supabase.rpc("replenish_and_reserve_material", {
      p_ceco: payload.ceco,
      p_material_code: payload.code,
      p_quantity: Number(payload.quantity),
      p_movement_type: payload.type,
      p_note: payload.note || null,
      p_timestamp: toUtcTimestamp(payload.timestamp)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async createBodyType(payload) {
    const { error } = await supabase.rpc("save_product_template", { p_id: "", p_code: payload.code, p_family_id: payload.familyId, p_brand_id: payload.brandId, p_name: payload.name, p_target_days: Number(payload.targetDays), p_output_unit_id: payload.outputUnitId, p_route: payload.route });
    if (error) throw error;
    return this.getDataset();
  },
  async updateBodyType(id, payload) {
    const { error } = await supabase.rpc("save_product_template", { p_id: id, p_code: payload.code, p_family_id: payload.familyId, p_brand_id: payload.brandId, p_name: payload.name, p_target_days: Number(payload.targetDays), p_output_unit_id: payload.outputUnitId, p_route: payload.route });
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
      lead_time_days: nullableNumber(patch.leadTimeDays),
      average_demand: nullableNumber(patch.averageDemand),
      lead_time_std_dev: nullableNumber(patch.leadTimeStdDev),
      service_level: nullableNumber(patch.serviceLevel),
      unit_cost: nullableNumber(patch.unitCost),
      unit_cost_basis: patch.unitCost == null ? null : patch.unitCostBasis ?? "Registrado en Inventario",
      safety_parameters_basis: patch.safetyParametersBasis ?? "Registrado en Inventario"
    }).eq("code", code);
    if (error) throw error;
    return this.getDataset();
  },
  async updateMaterialPrices(entries) {
    for (let offset = 0; offset < entries.length; offset += 12) {
      const batch = entries.slice(offset, offset + 12);
      const results = await Promise.all(batch.map(({ code, unitCost }) =>
        supabase.from("inventory_items").update({ unit_cost: Number(unitCost), unit_cost_basis: "Importado de Excel" }).eq("code", code).select("code").single()
      ));
      const failed = results.find((result) => result.error);
      if (failed) throw new Error(`Falló la importación después de procesar hasta ${offset + batch.length} materiales. Revisa los precios guardados antes de repetirla: ${failed.error.message}`);
    }
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
    const { error } = await supabase.rpc("issue_material_to_activity", { p_ceco: payload.ceco, p_material_code: payload.materialCode, p_quantity: Number(payload.quantity), p_activity_id: payload.activityId });
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
    const { error } = await supabase.rpc("register_operation_activity", {
      p_date: payload.date,
      p_ceco: payload.ceco,
      p_worker: payload.worker,
      p_activity_id: payload.activityId,
      p_total_hours: Number(payload.totalHours)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async updateOperation(id, payload) {
    const { error } = await supabase.from("operation_logs").update({ date: payload.date, ceco: payload.ceco, worker: payload.worker, activity_id: payload.activityId, stage_id: payload.stageId, activity: payload.activity, total_hours: Number(payload.totalHours) }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteOperation(id) {
    const { error } = await supabase.from("operation_logs").delete().eq("id", id);
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
      source_phase_code: payload.sourcePhaseCode || null,
      material_code: payload.materialCode,
      piece_code: payload.pieceCode,
      description: payload.description,
      length_mm: Number(payload.lengthMm),
      quantity: Number(payload.quantity)
    });
    if (error) throw error;
    return this.getDataset();
  },
  async saveBomItems(payloads) {
    if (!Array.isArray(payloads) || !payloads.length) return this.getDataset();
    const dataset = await this.getDataset();
    const stamp = Date.now();
    const inserts = [];
    const updates = [];
    payloads.forEach((payload, index) => {
      if (!payload.bodyTypeId || !payload.stageId || !payload.materialCode || Number(payload.quantity) <= 0) throw new Error("Cada asignación requiere producto, fase, material y una cantidad válida.");
      const existing = dataset.bom.find((item) => item.id === payload.id || (item.bodyTypeId === payload.bodyTypeId && item.stageId === payload.stageId && item.materialCode === payload.materialCode));
      const data = { body_type_id: payload.bodyTypeId, stage_id: payload.stageId, source_phase_code: payload.sourcePhaseCode || existing?.sourcePhaseCode || null, material_code: payload.materialCode, piece_code: existing?.pieceCode || payload.pieceCode, description: payload.description, length_mm: Number(payload.lengthMm || 0), quantity: Number(payload.quantity) };
      if (existing) updates.push(supabase.from("bom_items").update(data).eq("id", existing.id));
      else inserts.push({ id: `bom-quick-${stamp}-${index}`, ...data });
    });
    const results = await Promise.all([...updates, ...(inserts.length ? [supabase.from("bom_items").insert(inserts)] : [])]);
    const error = results.find((result) => result.error)?.error;
    if (error) throw error;
    return this.getDataset();
  },
  async updateBomItem(id, patch) {
    const { error } = await supabase.from("bom_items").update({ material_code: patch.materialCode, piece_code: patch.pieceCode, description: patch.description, stage_id: patch.stageId, source_phase_code: patch.sourcePhaseCode || null, length_mm: Number(patch.lengthMm || 0), quantity: Number(patch.quantity) }).eq("id", id);
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
    const { error } = await supabase.from("work_shifts").insert({ id: `shift-${Date.now()}`, code: payload.code, name: payload.name, start_time: payload.startTime, end_time: payload.endTime, break_minutes: Number(payload.breakMinutes), days_per_week: Number(payload.daysPerWeek), active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async updateShift(id, payload) {
    const { error } = await supabase.from("work_shifts").update({ code: payload.code, name: payload.name, start_time: payload.startTime, end_time: payload.endTime, break_minutes: Number(payload.breakMinutes), days_per_week: Number(payload.daysPerWeek) }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async createPersonnel(payload) {
    const { error } = await supabase.rpc("save_personnel_with_shifts", { p_id: "", p_employee_code: payload.employeeCode, p_name: payload.name, p_role: payload.role, p_specialty: payload.specialty || null, p_shift_ids: payload.shiftIds, p_status: payload.status, p_efficiency: Number(payload.efficiency) });
    if (error) throw error;
    const { error: costError } = await supabase.from("personnel").update({ hourly_cost: nullableNumber(payload.hourlyCost), hourly_cost_basis: payload.hourlyCost == null ? null : payload.hourlyCostBasis ?? "Registrado en Personal" }).eq("employee_code", payload.employeeCode);
    if (costError) throw costError;
    return this.getDataset();
  },
  async updatePersonnel(id, payload) {
    const { error } = await supabase.rpc("save_personnel_with_shifts", { p_id: id, p_employee_code: payload.employeeCode, p_name: payload.name, p_role: payload.role, p_specialty: payload.specialty || null, p_shift_ids: payload.shiftIds, p_status: payload.status, p_efficiency: Number(payload.efficiency) });
    if (error) throw error;
    const { error: costError } = await supabase.from("personnel").update({ hourly_cost: nullableNumber(payload.hourlyCost), hourly_cost_basis: payload.hourlyCost == null ? null : payload.hourlyCostBasis ?? "Registrado en Personal" }).eq("id", id);
    if (costError) throw costError;
    return this.getDataset();
  },
  async createEquipment(payload) {
    const { error } = await supabase.from("equipment").insert({ id: `equipment-${Date.now()}`, code: payload.code, name: payload.name, stage_id: payload.stageId, status: payload.status, capacity_hours: Number(payload.capacityHours), maintenance_due: payload.maintenanceDue || null });
    if (error) throw error;
    return this.getDataset();
  },
  async updateEquipment(id, payload) {
    const { error } = await supabase.from("equipment").update({ code: payload.code, name: payload.name, stage_id: payload.stageId, status: payload.status, capacity_hours: Number(payload.capacityHours), maintenance_due: payload.maintenanceDue || null }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async createCalendarDay(payload) {
    const { error } = await supabase.from("work_calendar").upsert({ id: `calendar-${payload.date}`, calendar_date: payload.date, day_type: payload.dayType, available_hours: Number(payload.availableHours), note: payload.note }, { onConflict: "calendar_date" });
    if (error) throw error;
    return this.getDataset();
  },
  async updateCalendarDay(id, payload) {
    const { error } = await supabase.from("work_calendar").update({ calendar_date: payload.date, day_type: payload.dayType, available_hours: Number(payload.availableHours), note: payload.note || null }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async createAssignment(payload) {
    const { error } = await supabase.from("resource_assignments").insert({ id: `assignment-${Date.now()}`, personnel_id: payload.personnelId, ceco: payload.ceco, activity_id: payload.activityId, assigned_date: payload.assignedDate, planned_hours: Number(payload.plannedHours), status: payload.status });
    if (error) throw error;
    return this.getDataset();
  },
  async updateAssignment(id, payload) {
    const { error } = await supabase.from("resource_assignments").update({ personnel_id: payload.personnelId, ceco: payload.ceco, activity_id: payload.activityId, assigned_date: payload.assignedDate, planned_hours: Number(payload.plannedHours), status: payload.status }).eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async deleteAssignment(id) {
    const { error } = await supabase.from("resource_assignments").delete().eq("id", id);
    if (error) throw error;
    return this.getDataset();
  },
  async createIncident(payload) {
    const { error } = await supabase.from("operational_incidents").insert({ id: `incident-${Date.now()}`, occurred_at: payload.occurredAt, type: payload.type, severity: payload.severity, stage_id: payload.stageId, ceco: payload.ceco || null, equipment_id: payload.equipmentId || null, downtime_hours: Number(payload.downtimeHours), description: payload.description, status: "open" });
    if (error) throw error;
    return this.getDataset();
  },
  async updateIncident(id, payload) {
    const { error } = await supabase.from("operational_incidents").update({ occurred_at: payload.occurredAt, type: payload.type, severity: payload.severity, stage_id: payload.stageId, ceco: payload.ceco || null, equipment_id: payload.equipmentId || null, downtime_hours: Number(payload.downtimeHours), description: payload.description, status: payload.status }).eq("id", id);
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
  return { id: row.id, code: row.code, order: row.order, name: row.name, shortName: row.short_name, capacityHours: Number(row.capacity_hours), standardHours: Number(row.standard_hours), color: row.color, gatedByQuality: row.gated_by_quality };
}

function mapBodyType(row, routes) {
  return { id: row.id, code: row.code, family: row.family, familyId: row.family_id, brandId: row.brand_id, name: row.name, targetDays: Number(row.target_days), outputUnit: row.output_unit, outputUnitId: row.output_unit_id, route: routes.filter((item) => item.product_id === row.id).sort((a, b) => a.sequence - b.sequence).map((item) => item.stage_id) };
}

function mapInventory(row) {
  return { id: row.id, code: row.code, category: row.category, categoryId: row.category_id, brandId: row.brand_id, unitId: row.unit_id, description: row.description, physical: Number(row.physical), committed: Number(row.committed), safety: Number(row.safety), serviceFactor: row.service_factor == null ? null : Number(row.service_factor), demandStdDev: row.demand_std_dev == null ? null : Number(row.demand_std_dev), leadTimeDays: row.lead_time_days == null ? null : Number(row.lead_time_days), averageDemand: row.average_demand == null ? null : Number(row.average_demand), leadTimeStdDev: row.lead_time_std_dev == null ? null : Number(row.lead_time_std_dev), serviceLevel: row.service_level == null ? null : Number(row.service_level), unitCost: nullableNumber(row.unit_cost), unitCostBasis: row.unit_cost_basis ?? null, safetyParametersBasis: row.safety_parameters_basis ?? null, currency: row.currency || "PEN", unit: row.unit, location: row.location };
}

function mapBom(row) {
  return { id: row.id, bodyTypeId: row.body_type_id, stageId: row.stage_id, sourcePhaseCode: row.source_phase_code || "", materialCode: row.material_code, pieceCode: row.piece_code, description: row.description, lengthMm: Number(row.length_mm), quantity: Number(row.quantity) };
}

function mapActivity(row) {
  return { id: row.id, stageId: row.stage_id, sequence: row.sequence, name: row.name, standardMinutes: Number(row.standard_minutes), active: row.active };
}

function mapStageInventory(row) {
  return { id: row.id, stageId: row.stage_id, ceco: row.ceco, item: row.item, quantity: Number(row.quantity), unit: row.unit, status: row.status };
}

function mapActivityProgress(row) {
  return { id: row.id, ceco: row.ceco, activityId: row.activity_id, status: row.status, progress: Number(row.progress), startedAt: toLocalDateTimeInput(row.started_at) || null, finishedAt: toLocalDateTimeInput(row.finished_at) || null, plannedStartDate: row.planned_start_date || null, plannedEndDate: row.planned_end_date || null };
}

function mapOrder(row) {
  return { id: row.id, ceco: row.ceco, customerId: row.customer_id, customer: row.customer, bodyTypeId: row.body_type_id, productionLineId: row.production_line_id, progress: Number(row.progress), line: row.line, status: row.status, stageId: row.stage_id, plantState: row.plant_state, priority: row.priority, plannedStartDate: row.planned_start_date, dueDate: row.due_date, actualDeliveryDate: row.actual_finish_date ?? null, budgetNumber: row.budget_number ?? null, createdAt: row.created_at || null, active: row.active !== false, outputValue: nullableNumber(row.sale_amount_pen), outputValueBasis: row.output_value_basis ?? null, energyCost: nullableNumber(row.energy_cost), energyCostBasis: row.energy_cost_basis ?? null, capitalCost: nullableNumber(row.capital_cost), capitalCostBasis: row.capital_cost_basis ?? null };
}

function mapCustomer(row) { return { id: row.id, documentNumber: row.document_number, name: row.name, contactName: row.contact_name, phone: row.phone, email: row.email, active: row.active }; }
function mapReservation(row) { return { id: row.id, ceco: row.ceco, bomItemId: row.bom_item_id, stageId: row.stage_id, materialCode: row.material_code, requiredQuantity: Number(row.required_quantity), reservedQuantity: Number(row.reserved_quantity), issuedQuantity: Number(row.issued_quantity), consumedQuantity: Number(row.consumed_quantity), status: row.status }; }
function nullableNumber(value) { return value === "" || value == null ? null : Number(value); }
function legacyCustomers(orders) {
  return [...new Map(orders.map((row) => [row.customer, { id: `legacy-${String(row.customer).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: row.customer, documentNumber: null, contactName: null, phone: null, email: null, active: true }])).values()];
}

function mapOperation(row) {
  return { id: row.id, date: row.date, ceco: row.ceco, worker: row.worker, activityId: row.activity_id, stageId: row.stage_id, activity: row.activity, totalHours: Number(row.total_hours), hourlyCost: nullableNumber(row.hourly_cost) };
}

function mapWarehouse(row) {
  return { id: row.id, ticket: row.ticket, ceco: row.ceco, materialCode: row.material_code, stageId: row.stage_id, activityId: row.activity_id, quantity: Number(row.quantity), timestamp: String(row.timestamp).replace("T", " ").slice(0, 16) };
}

function mapQuality(row) {
  return { id: row.id, ceco: row.ceco, stageId: row.stage_id, inspector: row.inspector, approval: row.approval, observations: row.observations };
}

function mapMovement(row) {
  return { id: row.id, type: row.type, code: row.code, ceco: row.ceco || "", stageId: row.stage_id, activityId: row.activity_id, quantity: Number(row.quantity), timestamp: toLocalDateTimeInput(row.timestamp).replace("T", " "), note: row.note };
}

function mapShift(row) { return { id: row.id, code: row.code, name: row.name, startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), breakMinutes: Number(row.break_minutes), daysPerWeek: Number(row.days_per_week || 1), active: row.active }; }
function mapPerson(row, personnelShifts = []) { const shiftIds = personnelShifts.filter((item) => item.personnel_id === row.id).map((item) => item.shift_id); return { id: row.id, employeeCode: row.employee_code, name: row.name, role: row.role, specialty: row.specialty, shiftId: shiftIds[0] || row.shift_id, shiftIds: shiftIds.length ? shiftIds : row.shift_id ? [row.shift_id] : [], status: row.status, efficiency: Number(row.efficiency), hourlyCost: nullableNumber(row.hourly_cost), hourlyCostBasis: row.hourly_cost_basis ?? null, weeklyHours: Number(row.weekly_hours), active: row.active }; }
function mapEquipment(row) { return { id: row.id, code: row.code, name: row.name, stageId: row.stage_id, status: row.status, capacityHours: Number(row.capacity_hours), maintenanceDue: row.maintenance_due }; }
function mapCalendarDay(row) { return { id: row.id, date: row.calendar_date, dayType: row.day_type, availableHours: Number(row.available_hours), note: row.note }; }
function mapAssignment(row) { return { id: row.id, personnelId: row.personnel_id, ceco: row.ceco, activityId: row.activity_id, assignedDate: row.assigned_date, plannedHours: Number(row.planned_hours), status: row.status }; }
function mapIncident(row) { return { id: row.id, occurredAt: String(row.occurred_at).replace("T", " ").slice(0, 16), type: row.type, severity: row.severity, stageId: row.stage_id, ceco: row.ceco, equipmentId: row.equipment_id, downtimeHours: Number(row.downtime_hours), description: row.description, status: row.status }; }
