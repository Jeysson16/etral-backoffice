import { initialDataset } from "../data/seed.js";
import { calculateCecoProgress } from "../lib/mrp.js";
import { nextCecoCode, nextInventoryCode, nextWarehouseTicket } from "../lib/correlatives.js";

const STORAGE_KEY = "etral.production.dataset.v5";

function newInternalId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const dataset = structuredClone(initialDataset);
    recalculateAllOrders(dataset);
    return dataset;
  }
  const stored = JSON.parse(raw);
  const dataset = {
    ...structuredClone(initialDataset),
    ...stored,
    stageActivities: stored.stageActivities || structuredClone(initialDataset.stageActivities),
    stageInventory: stored.stageInventory || structuredClone(initialDataset.stageInventory)
  };
  recalculateAllOrders(dataset);
  return dataset;
}

function save(dataset) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
  window.dispatchEvent(new CustomEvent("etral:dataset", { detail: dataset }));
}

function addMovement(dataset, movement) {
  dataset.inventoryMovements = dataset.inventoryMovements || [];
  dataset.inventoryMovements.unshift({
    id: newInternalId("mov"),
    timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    ...movement
  });
}

function reserveBom(dataset, order) {
  dataset.orderMaterialReservations = dataset.orderMaterialReservations || [];
  dataset.bom
    .filter((piece) => piece.bodyTypeId === order.bodyTypeId)
    .forEach((piece) => {
      const item = dataset.inventory.find((entry) => entry.code === piece.materialCode);
      const available = Math.max(0, Number(item?.physical || 0) - Number(item?.committed || 0));
      const reserved = Math.min(Number(piece.quantity), available);
      dataset.orderMaterialReservations.push({ id: newInternalId("reservation"), ceco: order.ceco, bomItemId: piece.id, stageId: piece.stageId, materialCode: piece.materialCode, requiredQuantity: Number(piece.quantity), reservedQuantity: reserved, issuedQuantity: 0, consumedQuantity: 0, status: reserved === 0 ? "pending" : reserved < Number(piece.quantity) ? "partial" : "reserved" });
      if (reserved > 0) {
        dataset.inventory = dataset.inventory.map((entry) => entry.code === piece.materialCode ? { ...entry, committed: Number(entry.committed) + reserved } : entry);
        addMovement(dataset, { type: "reserva", code: piece.materialCode, ceco: order.ceco, quantity: reserved, note: "Reserva automática por apertura CECO" });
      }
    });
}

function recalculateOrder(dataset, ceco) {
  const order = dataset.orders.find((item) => item.ceco === ceco);
  if (!order) return;
  const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
  const route = product?.route ?? [];
  const activities = dataset.stageActivities.filter((item) => route.includes(item.stageId) && item.active !== false);
  const progresses = activities.map((activity) => dataset.activityProgress?.find((item) => item.ceco === ceco && item.activityId === activity.id) || { progress: 0, status: "pending" });
  order.progress = calculateCecoProgress(order, dataset.bodyTypes, dataset.stageActivities, dataset.activityProgress).progress;
  const shortage = dataset.orderMaterialReservations?.some((item) => item.ceco === ceco && item.reservedQuantity < item.requiredQuantity);
  const blocked = progresses.some((item) => item.status === "blocked");
  const completed = activities.length > 0 && progresses.every((item) => item.status === "completed");
  order.status = shortage || blocked ? "red" : completed ? "green" : "orange";
  order.plantState = shortage ? "Bloqueado por material" : blocked ? "Actividad bloqueada" : completed ? "Completado" : "En proceso";
}

function recalculateAllOrders(dataset) {
  (dataset.orders ?? []).forEach((order) => recalculateOrder(dataset, order.ceco));
}

export const localRepository = {
  async getDataset() {
    return load();
  },
  async reset() {
    const dataset = structuredClone(initialDataset);
    save(dataset);
    return dataset;
  },
  async saveFlowStages(flowStages) {
    const dataset = load();
    dataset.flowStages = flowStages.map((stage, index) => ({ ...stage, order: index }));
    save(dataset);
    return dataset;
  },
  async moveOrder(ceco, stageId) {
    const dataset = load();
    const sortedStages = [...dataset.flowStages].sort((a, b) => a.order - b.order);
    const order = dataset.orders.find((item) => item.ceco === ceco);
    if (order) {
      const product = dataset.bodyTypes.find((item) => item.id === order.bodyTypeId);
      const currentIndex = product?.route.indexOf(order.stageId) ?? -1;
      const targetIndex = product?.route.indexOf(stageId) ?? -1;
      if (targetIndex < 0) throw new Error("La fase no pertenece a la ruta del producto");
      if (targetIndex > currentIndex + 1) throw new Error("La orden solo puede avanzar a la siguiente fase");
      if (targetIndex === currentIndex + 1) {
        const incomplete = dataset.stageActivities.filter((item) => item.stageId === order.stageId && item.active !== false).some((activity) => dataset.activityProgress?.find((item) => item.ceco === ceco && item.activityId === activity.id)?.status !== "completed");
        if (incomplete) throw new Error("Completa todas las actividades de la fase actual antes de avanzar");
      }
      order.stageId = stageId;
      order.plantState = order.status === "red" ? "Bloqueado MRP" : "En proceso";
    }
    save(dataset);
    return dataset;
  },
  async updateOrder(ceco, patch) {
    const dataset = load();
    const order = dataset.orders.find((item) => item.ceco === ceco);
    if (!order) throw new Error("CECO no encontrado");
    const nextCeco = patch.ceco ? String(patch.ceco).trim() : ceco;
    if (!/^\d{6}$/.test(nextCeco)) throw new Error("El correlativo CECO debe tener 6 dígitos numéricos");
    if (nextCeco !== ceco) {
      if (dataset.orders.some((item) => item.ceco === nextCeco)) throw new Error(`El CECO ${nextCeco} ya existe`);
      ["stageInventory", "activityProgress", "orderMaterialReservations", "operations", "warehouse", "quality", "inventoryMovements", "assignments", "incidents"].forEach((collection) => {
        (dataset[collection] ?? []).forEach((item) => { if (item.ceco === ceco) item.ceco = nextCeco; });
      });
      order.ceco = nextCeco;
    }
    Object.assign(order, { ...patch, ceco: nextCeco });
    save(dataset);
    return dataset;
  },
  async deleteOrder(ceco) {
    const dataset = load();
    const order = dataset.orders.find((item) => item.ceco === ceco);
    if (!order) throw new Error("CECO no encontrado");
    const reservations = (dataset.orderMaterialReservations ?? []).filter((item) => item.ceco === ceco);
    reservations.forEach((reservation) => {
      const toRelease = Math.max(0, Number(reservation.reservedQuantity) - Number(reservation.issuedQuantity || 0));
      if (toRelease > 0) dataset.inventory = dataset.inventory.map((item) => item.code === reservation.materialCode ? { ...item, committed: Math.max(0, Number(item.committed) - toRelease) } : item);
    });
    ["stageInventory", "activityProgress", "orderMaterialReservations", "operations", "warehouse", "quality", "inventoryMovements", "assignments", "incidents"].forEach((collection) => {
      dataset[collection] = (dataset[collection] ?? []).filter((item) => item.ceco !== ceco);
    });
    dataset.orders = dataset.orders.filter((item) => item.ceco !== ceco);
    save(dataset);
    return dataset;
  },
  async updateOrderPriorities(entries) {
    const dataset = load();
    entries.forEach((entry) => {
      const order = dataset.orders.find((item) => item.ceco === entry.ceco);
      if (!order) throw new Error(`CECO ${entry.ceco} no encontrado`);
      order.priority = Number(entry.priority);
    });
    save(dataset);
    return dataset;
  },
  async updateActivityProgress(ceco, activityId, patch) {
    const dataset = load();
    dataset.activityProgress = dataset.activityProgress || [];
    const index = dataset.activityProgress.findIndex((item) => item.ceco === ceco && item.activityId === activityId);
    const current = index >= 0 ? dataset.activityProgress[index] : { id: `progress-${ceco}-${activityId}`, ceco, activityId, status: "pending", progress: 0, startedAt: null, finishedAt: null };
    const progress = Math.max(0, Math.min(100, Number(patch.progress ?? current.progress)));
    const status = patch.status ?? (progress === 100 ? "completed" : progress > 0 ? "in_progress" : "pending");
    const next = { ...current, ...patch, progress, status, startedAt: status === "pending" ? null : current.startedAt || new Date().toISOString().slice(0, 16).replace("T", " "), finishedAt: status === "completed" ? new Date().toISOString().slice(0, 16).replace("T", " ") : null };
    if (index >= 0) dataset.activityProgress[index] = next; else dataset.activityProgress.push(next);
    recalculateOrder(dataset, ceco);
    save(dataset);
    return dataset;
  },
  async updateActivitySchedules(ceco, entries) {
    const dataset = load();
    if (!dataset.orders.some((order) => order.ceco === ceco)) throw new Error("CECO no encontrado");
    dataset.activityProgress = dataset.activityProgress || [];
    entries.forEach((entry) => {
      if (!entry.plannedStartDate || !entry.plannedEndDate || entry.plannedStartDate > entry.plannedEndDate) throw new Error("El rango programado no es válido");
      const index = dataset.activityProgress.findIndex((item) => item.ceco === ceco && item.activityId === entry.activityId);
      const current = index >= 0 ? dataset.activityProgress[index] : { id: entry.id || `progress-${ceco}-${entry.activityId}`, ceco, activityId: entry.activityId, status: "pending", progress: 0, startedAt: null, finishedAt: null };
      const next = { ...current, plannedStartDate: entry.plannedStartDate, plannedEndDate: entry.plannedEndDate };
      if (index >= 0) dataset.activityProgress[index] = next; else dataset.activityProgress.push(next);
    });
    save(dataset);
    return dataset;
  },
  async createOrder(payload) {
    const dataset = load();
    const ceco = String(payload.ceco || nextCecoCode(dataset.orders, new Date("2026-07-26T12:00:00"))).trim();
    if (!/^\d{6}$/.test(ceco)) throw new Error("El correlativo CECO debe tener 6 dígitos numéricos");
    if (dataset.orders.some((item) => item.ceco === ceco)) throw new Error(`El CECO ${ceco} ya existe`);
    const order = {
      id: newInternalId("order"),
      ceco,
      customerId: payload.customerId || null,
      customer: dataset.customers?.find((item) => item.id === payload.customerId)?.name || payload.customer,
      progress: 0,
      status: "orange",
      stageId: dataset.flowStages[0]?.id ?? "stage-supply",
      plantState: "En cola",
      line: null,
      priority: dataset.orders.length + 1,
      active: true,
      createdAt: new Date().toISOString(),
      ...payload
    };
    dataset.orders.unshift(order);
    reserveBom(dataset, order);
    recalculateOrder(dataset, ceco);
    save(dataset);
    return dataset;
  },
  async createInventory(payload) {
    const dataset = load();
    const code = nextInventoryCode(dataset.inventory, payload.category || "MAT");
    const safety = payload.serviceFactor && payload.demandStdDev && payload.leadTimeDays ? Math.ceil(Number(payload.serviceFactor) * Number(payload.demandStdDev) * Math.sqrt(Number(payload.leadTimeDays))) : Number(payload.safety || 0);
    dataset.inventory.unshift({ id: `inv-${code}`, code, committed: 0, ...payload, safety });
    save(dataset);
    return dataset;
  },
  async importCatalogData(payload) {
    const dataset = load();
    const slug = (value) => String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const ensureCatalog = (type, name, symbol = "") => {
      if (!name) return null;
      const existing = dataset.catalogs[type].find((item) => item.name.toLowerCase() === name.toLowerCase() || (type === "units" && item.symbol === name));
      if (existing) return existing;
      const id = `${type === "categories" ? "cat" : type === "units" ? "unit" : "brand"}-import-${slug(name)}`;
      const item = { id, name, ...(type === "units" ? { symbol: symbol || name } : {}) };
      dataset.catalogs[type].push(item);
      return item;
    };
    const importedCodes = new Map();
    for (const row of payload.materials || []) {
      const category = ensureCatalog("categories", row.category);
      const unit = ensureCatalog("units", row.unit, row.unit);
      const brand = ensureCatalog("brands", row.brand);
      const existing = dataset.inventory.find((item) => (row.code && item.code === row.code) || item.description.toLowerCase() === row.description.toLowerCase());
      const code = existing?.code || row.code || nextInventoryCode(dataset.inventory, row.category || "MAT");
      const material = { id: existing?.id || `inv-${code}`, code, category: category.name, categoryId: category.id, description: row.description, physical: Number(row.physical || 0), committed: existing?.committed || 0, safety: Number(row.safety || 0), unit: unit.symbol, unitId: unit.id, brandId: brand?.id || null, location: row.location || null, serviceFactor: row.serviceFactor, demandStdDev: row.demandStdDev, leadTimeDays: row.leadTimeDays, unitCost: row.unitCost, currency: row.currency || "PEN" };
      if (existing) Object.assign(existing, material); else dataset.inventory.unshift(material);
      importedCodes.set(row.code, code);
    }
    for (const row of payload.products || []) {
      const family = dataset.productFamilies.find((item) => item.name.toLowerCase() === row.family.toLowerCase());
      const brand = ensureCatalog("brands", row.brand || "Genérico");
      const unit = ensureCatalog("units", row.outputUnit, row.outputUnit);
      const route = row.route.map((code) => dataset.flowStages.find((stage) => stage.id === code || stage.code === code)?.id).filter(Boolean);
      if (!row.code || !row.name || !family || !route.length) throw new Error(`Producto fila ${row.row}: código, nombre, familia y ruta válida son obligatorios.`);
      const product = dataset.bodyTypes.find((item) => item.code === row.code);
      const data = { code: row.code, name: row.name, family: family.name, familyId: family.id, brandId: brand.id, outputUnit: unit.symbol, outputUnitId: unit.id, targetDays: Number(row.targetDays || 1), route };
      if (product) Object.assign(product, data); else dataset.bodyTypes.push({ id: `body-import-${slug(row.code)}`, ...data });
    }
    for (const row of payload.bom || []) {
      const product = dataset.bodyTypes.find((item) => item.code === row.productCode);
      const materialCode = importedCodes.get(row.materialCode) || row.materialCode;
      const material = dataset.inventory.find((item) => item.code === materialCode);
      const stage = dataset.flowStages.find((item) => item.id === row.stageCode || item.code === row.stageCode);
      if (!product || !material || !stage || !row.pieceCode || Number(row.quantity) <= 0) throw new Error(`BOM fila ${row.row}: producto, material, fase, código de pieza y cantidad deben ser válidos.`);
      const existing = dataset.bom.find((item) => item.bodyTypeId === product.id && item.pieceCode === row.pieceCode);
      const data = { bodyTypeId: product.id, stageId: stage.id, materialCode: material.code, pieceCode: row.pieceCode, description: row.description || material.description, lengthMm: Number(row.lengthMm || 0), quantity: Number(row.quantity) };
      if (existing) Object.assign(existing, data); else dataset.bom.unshift({ id: `bom-import-${slug(product.code)}-${slug(row.pieceCode)}`, ...data });
    }
    save(dataset);
    return dataset;
  },
  async createCatalogItem(payload) {
    const dataset = load();
    const collection = dataset.catalogs[payload.type];
    if (!collection) throw new Error("Catálogo no válido");
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Ingresa un nombre para la opción");
    if (collection.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Esta opción ya existe en el catálogo");
    }
    const prefix = payload.type === "categories" ? "cat" : payload.type === "units" ? "unit" : "brand";
    const id = `${prefix}-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    const item = { id, name, ...(payload.type === "units" ? { symbol: String(payload.symbol || "").trim() || name.toLowerCase() } : {}) };
    collection.push(item);
    save(dataset);
    return dataset;
  },
  async updateCatalogItem(payload) {
    const dataset = load();
    const item = dataset.catalogs[payload.type]?.find((entry) => entry.id === payload.id);
    if (!item) throw new Error("Opción no encontrada");
    item.name = String(payload.name || "").trim() || item.name;
    if (payload.type === "units") item.symbol = String(payload.symbol || "").trim() || item.symbol;
    save(dataset);
    return dataset;
  },
  async deleteCatalogItem(payload) {
    const dataset = load();
    const collection = dataset.catalogs[payload.type];
    if (!collection?.some((item) => item.id === payload.id)) throw new Error("Opción no encontrada");
    const linked = dataset.inventory.some((item) => item[payload.type === "categories" ? "categoryId" : payload.type === "units" ? "unitId" : "brandId"] === payload.id);
    if (linked) throw new Error("No se puede eliminar una opción que está asignada a materiales");
    dataset.catalogs[payload.type] = collection.filter((item) => item.id !== payload.id);
    save(dataset);
    return dataset;
  },
  async createInventoryMovement(payload) {
    const dataset = load();
    const quantity = Number(payload.quantity);
    dataset.inventory = dataset.inventory.map((item) => {
      if (item.code !== payload.code) return item;
      if (payload.type === "ingreso") return { ...item, physical: Number(item.physical) + quantity };
      if (payload.type === "salida") return { ...item, physical: Math.max(0, Number(item.physical) - quantity), committed: Math.max(0, Number(item.committed) - quantity) };
      if (payload.type === "reserva") return { ...item, committed: Number(item.committed) + quantity };
      if (payload.type === "ajuste") return { ...item, physical: Math.max(0, Number(item.physical) + quantity) };
      return item;
    });
    addMovement(dataset, { ...payload, quantity });
    save(dataset);
    return dataset;
  },
  async replenishAndReserve(payload) {
    const dataset = load();
    const quantity = Number(payload.quantity);
    const ceco = String(payload.ceco || "").trim();
    const material = dataset.inventory.find((item) => item.code === payload.code);
    if (!dataset.orders.some((item) => item.ceco === ceco)) throw new Error("CECO no encontrado");
    if (!material) throw new Error("Material no encontrado");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("La cantidad debe ser mayor que cero");
    if (!['ingreso', 'ajuste'].includes(payload.type)) throw new Error("La reposición debe ser un ingreso o ajuste positivo");

    material.physical = Number(material.physical || 0) + quantity;
    addMovement(dataset, { ...payload, ceco, quantity });

    (dataset.orderMaterialReservations ?? [])
      .filter((item) => item.ceco === ceco && item.materialCode === payload.code && Number(item.reservedQuantity) < Number(item.requiredQuantity))
      .forEach((reservation) => {
        const missing = Number(reservation.requiredQuantity) - Number(reservation.reservedQuantity);
        const available = Math.max(0, Number(material.physical || 0) - Number(material.committed || 0));
        const reserved = Math.min(missing, available);
        if (reserved <= 0) return;
        reservation.reservedQuantity = Number(reservation.reservedQuantity) + reserved;
        reservation.status = reservation.reservedQuantity >= reservation.requiredQuantity ? "reserved" : "partial";
        material.committed = Number(material.committed || 0) + reserved;
        addMovement(dataset, { type: "reserva", code: reservation.materialCode, ceco, quantity: reserved, note: "Reserva complementaria tras reposición rápida" });
      });

    recalculateOrder(dataset, ceco);
    save(dataset);
    return dataset;
  },
  async refreshOrderReservations(ceco) {
    const dataset = load();
    const reservations = (dataset.orderMaterialReservations ?? []).filter((item) => item.ceco === ceco && Number(item.reservedQuantity) < Number(item.requiredQuantity));
    reservations.forEach((reservation) => {
      const material = dataset.inventory.find((item) => item.code === reservation.materialCode);
      const missing = Number(reservation.requiredQuantity) - Number(reservation.reservedQuantity);
      const available = Math.max(0, Number(material?.physical || 0) - Number(material?.committed || 0));
      const added = Math.min(missing, available);
      if (added <= 0 || !material) return;
      reservation.reservedQuantity = Number(reservation.reservedQuantity) + added;
      reservation.status = reservation.reservedQuantity >= reservation.requiredQuantity ? "reserved" : "partial";
      material.committed = Number(material.committed || 0) + added;
      addMovement(dataset, { type: "reserva", code: reservation.materialCode, ceco, quantity: added, note: "Reserva complementaria tras reposición rápida" });
    });
    recalculateOrder(dataset, ceco);
    save(dataset);
    return dataset;
  },
  async createBodyType(payload) {
    const dataset = load();
    const id = `body-${String(payload.code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    dataset.bodyTypes.push({ id, ...payload, targetDays: Number(payload.targetDays) });
    save(dataset);
    return dataset;
  },
  async updateBodyType(id, payload) {
    const dataset = load();
    const item = dataset.bodyTypes.find((entry) => entry.id === id);
    if (!item) throw new Error("Producto no encontrado");
    Object.assign(item, payload, { targetDays: Number(payload.targetDays) });
    save(dataset);
    return dataset;
  },
  async createStageActivity(payload) {
    const dataset = load();
    const sequence = dataset.stageActivities.filter((item) => item.stageId === payload.stageId).length + 1;
    dataset.stageActivities.push({ id: `act-${Date.now()}`, sequence, active: true, ...payload, standardMinutes: Number(payload.standardMinutes) });
    save(dataset);
    return dataset;
  },
  async updateStageActivity(id, payload) {
    const dataset = load();
    const item = dataset.stageActivities.find((entry) => entry.id === id);
    if (!item) throw new Error("Actividad no encontrada");
    Object.assign(item, payload, { standardMinutes: Number(payload.standardMinutes) });
    save(dataset); return dataset;
  },
  async updateInventory(code, patch) {
    const dataset = load();
    const calculatedSafety = patch.serviceFactor && patch.demandStdDev && patch.leadTimeDays ? Math.ceil(Number(patch.serviceFactor) * Number(patch.demandStdDev) * Math.sqrt(Number(patch.leadTimeDays))) : Number(patch.safety || 0);
    dataset.inventory = dataset.inventory.map((item) => (item.code === code ? { ...item, ...patch, safety: calculatedSafety } : item));
    save(dataset);
    return dataset;
  },
  async createCustomer(payload) {
    const dataset = load();
    dataset.customers = dataset.customers || [];
    dataset.customers.push({ id: `customer-${Date.now()}`, active: true, ...payload });
    save(dataset); return dataset;
  },
  async updateCustomer(id, payload) {
    const dataset = load();
    const customer = dataset.customers?.find((item) => item.id === id);
    if (!customer) throw new Error("Cliente no encontrado");
    Object.assign(customer, payload);
    dataset.orders.filter((item) => item.customerId === id).forEach((item) => { item.customer = customer.name; });
    save(dataset); return dataset;
  },
  async registerPurchase(code, quantity) {
    const dataset = load();
    dataset.inventory = dataset.inventory.map((item) => (
      item.code === code ? { ...item, physical: Number(item.physical) + Number(quantity) } : item
    ));
    addMovement(dataset, { type: "ingreso", code, ceco: "", quantity: Number(quantity), note: "Ingreso por compra" });
    save(dataset);
    return dataset;
  },
  async createWarehouseExit(payload) {
    const dataset = load();
    const reservations = dataset.orderMaterialReservations?.filter((item) => item.ceco === payload.ceco && item.materialCode === payload.materialCode) || [];
    const pending = reservations.reduce((sum, item) => sum + Number(item.reservedQuantity) - Number(item.issuedQuantity || 0), 0);
    if (pending < Number(payload.quantity)) throw new Error("La cantidad supera la reserva pendiente de la orden");
    let left = Number(payload.quantity);
    reservations.forEach((item) => { const take = Math.min(left, Number(item.reservedQuantity) - Number(item.issuedQuantity || 0)); item.issuedQuantity = Number(item.issuedQuantity || 0) + take; item.status = item.issuedQuantity >= item.requiredQuantity ? "issued" : "partial"; left -= take; });
    const ticket = nextWarehouseTicket(dataset.warehouse);
    dataset.warehouse.unshift({ id: `wh-${ticket}`, ticket, timestamp: new Date().toISOString().slice(0, 16).replace("T", " "), ...payload });
    dataset.inventory = dataset.inventory.map((item) => (
      item.code === payload.materialCode
        ? {
            ...item,
            physical: Math.max(0, Number(item.physical) - Number(payload.quantity)),
            committed: Math.max(0, Number(item.committed) - Number(payload.quantity))
          }
        : item
    ));
    addMovement(dataset, { type: "salida", code: payload.materialCode, ceco: payload.ceco, quantity: Number(payload.quantity), note: `Ticket ${ticket}` });
    save(dataset);
    return dataset;
  },
  async consumeMaterial(payload) {
    const dataset = load();
    addMovement(dataset, { type: "consumo", code: payload.materialCode, ceco: payload.ceco, quantity: Number(payload.quantity), note: payload.note || "Uso de material en planta" });
    save(dataset);
    return dataset;
  },
  async createOperation(payload) {
    const dataset = load();
    dataset.operations.unshift({ id: `op-${Date.now()}`, ...payload, totalHours: Number(payload.totalHours) });
    save(dataset);
    return dataset;
  },
  async createQualityCheck(payload) {
    const dataset = load();
    dataset.quality.unshift({ id: `qa-${Date.now()}`, ...payload });
    save(dataset);
    return dataset;
  },
  async createBomItem(payload) {
    const dataset = load();
    dataset.bom.unshift({ id: `bom-${Date.now()}`, ...payload, quantity: Number(payload.quantity), lengthMm: Number(payload.lengthMm) });
    save(dataset);
    return dataset;
  },
  async saveBomItems(payloads) {
    const dataset = load();
    if (!Array.isArray(payloads) || !payloads.length) return dataset;
    payloads.forEach((payload, index) => {
      if (!payload.bodyTypeId || !payload.stageId || !payload.materialCode || Number(payload.quantity) <= 0) throw new Error("Cada asignación requiere producto, fase, material y una cantidad válida.");
      const existing = dataset.bom.find((item) => item.id === payload.id || (item.bodyTypeId === payload.bodyTypeId && item.stageId === payload.stageId && item.materialCode === payload.materialCode));
      const data = { ...payload, quantity: Number(payload.quantity), lengthMm: Number(payload.lengthMm || 0) };
      if (existing) Object.assign(existing, data, { pieceCode: existing.pieceCode || data.pieceCode });
      else dataset.bom.unshift({ id: `bom-quick-${Date.now()}-${index}`, ...data });
    });
    save(dataset);
    return dataset;
  },
  async updateBomItem(id, patch) {
    const dataset = load();
    const item = dataset.bom.find((entry) => entry.id === id);
    if (!item) throw new Error("Componente no encontrado");
    Object.assign(item, { ...patch, quantity: Number(patch.quantity), lengthMm: Number(patch.lengthMm || 0) });
    save(dataset);
    return dataset;
  },
  async deleteBomItem(id) {
    const dataset = load();
    dataset.bom = dataset.bom.filter((item) => item.id !== id);
    save(dataset);
    return dataset;
  },
  async createShift(payload) {
    const dataset = load();
    dataset.shifts.unshift({ id: `shift-${Date.now()}`, ...payload, breakMinutes: Number(payload.breakMinutes), active: true });
    save(dataset); return dataset;
  },
  async createPersonnel(payload) {
    const dataset = load();
    dataset.personnel.unshift({ id: `person-${Date.now()}`, ...payload, efficiency: Number(payload.efficiency), weeklyHours: Number(payload.weeklyHours), active: true });
    save(dataset); return dataset;
  },
  async createEquipment(payload) {
    const dataset = load();
    dataset.equipment.unshift({ id: `equipment-${Date.now()}`, ...payload, capacityHours: Number(payload.capacityHours) });
    save(dataset); return dataset;
  },
  async createCalendarDay(payload) {
    const dataset = load();
    const row = { id: `calendar-${payload.date}`, ...payload, availableHours: Number(payload.availableHours) };
    dataset.workCalendar = [row, ...dataset.workCalendar.filter((item) => item.date !== payload.date)];
    save(dataset); return dataset;
  },
  async createAssignment(payload) {
    const dataset = load();
    dataset.assignments.unshift({ id: `assignment-${Date.now()}`, ...payload, plannedHours: Number(payload.plannedHours) });
    save(dataset); return dataset;
  },
  async createIncident(payload) {
    const dataset = load();
    dataset.incidents.unshift({ id: `incident-${Date.now()}`, ...payload, downtimeHours: Number(payload.downtimeHours), status: "open" });
    save(dataset); return dataset;
  },
  subscribe(callback) {
    const listener = (event) => callback(event.detail);
    window.addEventListener("etral:dataset", listener);
    return () => window.removeEventListener("etral:dataset", listener);
  }
};
