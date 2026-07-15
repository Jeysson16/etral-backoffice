import { supabase } from "../supabase/client.js";

export function hasSupabaseConfig() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export const supabaseRepository = {
  async getDataset() {
    if (!supabase) {
      throw new Error("Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY o usa npm run dev:mocks.");
    }
    const tables = ["flow_stages", "stage_activities", "stage_inventory", "ceco_activity_progress", "body_types", "product_routes", "inventory_items", "bom_items", "ceco_orders", "operation_logs", "warehouse_exits", "quality_checks", "inventory_movements"];
    const results = await Promise.all(tables.map((table) => supabase.from(table).select("*")));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;

    return {
      flowStages: results[0].data.map(mapStage),
      stageActivities: results[1].data.map(mapActivity),
      stageInventory: results[2].data.map(mapStageInventory),
      activityProgress: results[3].data.map(mapActivityProgress),
      bodyTypes: results[4].data.map((row) => mapBodyType(row, results[5].data)),
      inventory: results[6].data.map(mapInventory),
      bom: results[7].data.map(mapBom),
      orders: results[8].data.map(mapOrder),
      operations: results[9].data.map(mapOperation),
      warehouse: results[10].data.map(mapWarehouse),
      quality: results[11].data.map(mapQuality),
      inventoryMovements: results[12].data.map(mapMovement)
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
    const { error } = await supabase.from("ceco_orders").update({ stage_id: stageId, plant_state: "En proceso" }).eq("ceco", ceco);
    if (error) throw error;
    return this.getDataset();
  },
  async createOrder(payload) {
    const { data: ceco, error: rpcError } = await supabase.rpc("next_ceco_code");
    if (rpcError) throw rpcError;
    const { error } = await supabase.from("ceco_orders").insert({
      id: `order-${ceco}`,
      ceco,
      customer: payload.customer,
      body_type_id: payload.bodyTypeId,
      progress: 0,
      line: payload.line,
      status: "orange",
      stage_id: payload.stageId,
      plant_state: "En cola",
      priority: 999,
      due_date: payload.dueDate
    });
    if (error) throw error;
    const dataset = await this.getDataset();
    const pieces = dataset.bom.filter((piece) => piece.bodyTypeId === payload.bodyTypeId);
    await Promise.all(pieces.map(async (piece) => {
      const item = dataset.inventory.find((entry) => entry.code === piece.materialCode);
      await supabase.from("inventory_items").update({ committed: Number(item?.committed || 0) + Number(piece.quantity) }).eq("code", piece.materialCode);
      await supabase.from("inventory_movements").insert({
        id: `mov-${Date.now()}-${piece.id}`,
        type: "reserva",
        code: piece.materialCode,
        ceco,
        quantity: Number(piece.quantity),
        note: "Reserva automática por apertura CECO"
      });
    }));
    return this.getDataset();
  },
  async createInventory(payload) {
    const { data: code, error: rpcError } = await supabase.rpc("next_inventory_code", { category_prefix: payload.category || "MAT" });
    if (rpcError) throw rpcError;
    const { error } = await supabase.from("inventory_items").insert({
      id: `inv-${code}`,
      code,
      category: payload.category || "MAT",
      description: payload.description,
      physical: Number(payload.physical),
      committed: Number(payload.committed || 0),
      safety: Number(payload.safety),
      unit: payload.unit,
      location: payload.location
    });
    if (error) throw error;
    await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: "ingreso", code, ceco: "", quantity: Number(payload.physical), note: "Alta inicial de insumo" });
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
    const id = `body-${String(payload.code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const { error } = await supabase.from("body_types").insert({ id, code: payload.code, family: payload.family, name: payload.name, target_days: Number(payload.targetDays), output_unit: payload.outputUnit });
    if (error) throw error;
    const routes = payload.route.map((stageId, index) => ({ product_id: id, stage_id: stageId, sequence: index + 1 }));
    const { error: routeError } = await supabase.from("product_routes").insert(routes);
    if (routeError) throw routeError;
    return this.getDataset();
  },
  async createStageActivity(payload) {
    const dataset = await this.getDataset();
    const sequence = dataset.stageActivities.filter((item) => item.stageId === payload.stageId).length + 1;
    const { error } = await supabase.from("stage_activities").insert({ id: `act-${Date.now()}`, stage_id: payload.stageId, sequence, name: payload.name, standard_minutes: Number(payload.standardMinutes), active: true });
    if (error) throw error;
    return this.getDataset();
  },
  async updateInventory(code, patch) {
    const { error } = await supabase.from("inventory_items").update({
      description: patch.description,
      physical: patch.physical,
      committed: patch.committed,
      safety: patch.safety,
      unit: patch.unit
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
    const { data, error: rpcError } = await supabase.rpc("next_warehouse_ticket");
    if (rpcError) throw rpcError;
    const ticket = data || `SAL-${Date.now()}`;
    const { error } = await supabase.from("warehouse_exits").insert({
      id: `wh-${ticket}`,
      ticket,
      ceco: payload.ceco,
      material_code: payload.materialCode,
      quantity: Number(payload.quantity)
    });
    if (error) throw error;
    const dataset = await this.getDataset();
    const item = dataset.inventory.find((entry) => entry.code === payload.materialCode);
    if (item) await supabase.from("inventory_items").update({
      physical: Math.max(0, Number(item.physical) - Number(payload.quantity)),
      committed: Math.max(0, Number(item.committed) - Number(payload.quantity))
    }).eq("code", payload.materialCode);
    await supabase.from("inventory_movements").insert({ id: `mov-${Date.now()}`, type: "salida", code: payload.materialCode, ceco: payload.ceco, quantity: Number(payload.quantity), note: `Ticket ${ticket}` });
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
  return { id: row.id, code: row.code, category: row.category, description: row.description, physical: Number(row.physical), committed: Number(row.committed), safety: Number(row.safety), serviceFactor: Number(row.service_factor), demandStdDev: Number(row.demand_std_dev), leadTimeDays: Number(row.lead_time_days), unit: row.unit, location: row.location };
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
  return { id: row.id, ceco: row.ceco, customer: row.customer, bodyTypeId: row.body_type_id, progress: Number(row.progress), line: row.line, status: row.status, stageId: row.stage_id, plantState: row.plant_state, priority: row.priority, dueDate: row.due_date };
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
