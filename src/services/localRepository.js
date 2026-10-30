import { initialDataset } from "../data/seed.js";
import { calculateCecoProgress, calculateSafetyStock, effectiveOrderStageId } from "../lib/mrp.js";
import { nextCecoCode, nextInventoryCode, nextWarehouseTicket } from "../lib/correlatives.js";
import { consolidateImportedMaterials, findMatchingMaterial } from "../lib/materialImport.js";
import { orderProductRoute } from "../lib/productRoutes.js";
import { personnelWeeklyHours } from "../lib/workShifts.js";
import { toLocalDateTimeInput } from "../lib/dateTime.js";

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
  dataset.shifts = (dataset.shifts ?? []).map((shift) => ({ ...shift, daysPerWeek: Number(shift.daysPerWeek || 1) }));
  dataset.personnel = (dataset.personnel ?? []).map((person) => {
    const shiftIds = person.shiftIds?.length ? person.shiftIds : person.shiftId ? [person.shiftId] : [];
    return { ...person, shiftIds, shiftId: shiftIds[0] || null, weeklyHours: personnelWeeklyHours(dataset.shifts, shiftIds) };
  });
  dataset.bodyTypes = dataset.bodyTypes.map((product) => ({
    ...product,
    route: orderProductRoute(dataset.flowStages, product.route)
  }));
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
    ...movement,
    timestamp: toLocalDateTimeInput(movement.timestamp || new Date().toISOString()).replace("T", " ")
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

function syncOrderReservations(dataset, ceco) {
  const order = dataset.orders.find((item) => item.ceco === ceco);
  if (!order) throw new Error("CECO no encontrado");
  dataset.orderMaterialReservations = dataset.orderMaterialReservations || [];
  dataset.bom.filter((piece) => piece.bodyTypeId === order.bodyTypeId).forEach((piece) => {
    let reservation = dataset.orderMaterialReservations.find((item) => item.ceco === ceco && item.bomItemId === piece.id);
    if (!reservation) {
      reservation = { id: newInternalId("reservation"), ceco, bomItemId: piece.id, stageId: piece.stageId, materialCode: piece.materialCode, requiredQuantity: Number(piece.quantity), reservedQuantity: 0, issuedQuantity: 0, consumedQuantity: 0, status: "pending" };
      dataset.orderMaterialReservations.push(reservation);
    } else {
      Object.assign(reservation, { stageId: piece.stageId, materialCode: piece.materialCode, requiredQuantity: Number(piece.quantity) });
    }
    if (Number(reservation.reservedQuantity) >= Number(reservation.requiredQuantity)) return;
    const material = dataset.inventory.find((item) => item.code === reservation.materialCode);
    if (!material) return;
    const missing = Number(reservation.requiredQuantity) - Number(reservation.reservedQuantity);
    const available = Math.max(0, Number(material.physical || 0) - Number(material.committed || 0));
    const added = Math.min(missing, available);
    if (added <= 0) return;
    reservation.reservedQuantity = Number(reservation.reservedQuantity) + added;
    reservation.status = reservation.reservedQuantity >= reservation.requiredQuantity ? "reserved" : "partial";
    material.committed = Number(material.committed || 0) + added;
    addMovement(dataset, { type: "reserva", code: reservation.materialCode, ceco, stageId: reservation.stageId, quantity: added, note: "Reserva sincronizada con la BOM de la orden" });
  });
  recalculateOrder(dataset, ceco);
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
  order.stageId = effectiveOrderStageId(order, dataset.bodyTypes, dataset.stageActivities, dataset.activityProgress);
  order.status = shortage || blocked ? "red" : completed ? "green" : "orange";
  order.plantState = shortage ? "Bloqueado por material" : blocked ? "Actividad bloqueada" : completed ? "Completado" : "En proceso";
}

function recalculateAllOrders(dataset) {
  (dataset.orders ?? []).forEach((order) => recalculateOrder(dataset, order.ceco));
}

function setActivityProgress(dataset, ceco, activityId, patch) {
  dataset.activityProgress = dataset.activityProgress || [];
  const activity = dataset.stageActivities.find((item) => item.id === activityId && item.active !== false);
  const order = dataset.orders.find((item) => item.ceco === ceco);
  const product = dataset.bodyTypes.find((item) => item.id === order?.bodyTypeId);
  if (!activity || !order || !product?.route.includes(activity.stageId)) throw new Error("La actividad no pertenece a la ruta de esta orden");
  const index = dataset.activityProgress.findIndex((item) => item.ceco === ceco && item.activityId === activityId);
  const current = index >= 0 ? dataset.activityProgress[index] : { id: `progress-${ceco}-${activityId}`, ceco, activityId, status: "pending", progress: 0, startedAt: null, finishedAt: null };
  const progress = Math.max(0, Math.min(100, Number(patch.progress ?? current.progress)));
  const status = patch.status ?? (progress === 100 ? "completed" : progress > 0 ? "in_progress" : "pending");
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  if (patch.updateTimestamps && !patch.startedAt) throw new Error("La fecha y hora de inicio son obligatorias");
  if (patch.updateTimestamps && status === "completed" && !patch.finishedAt) throw new Error("La fecha y hora de fin son obligatorias para una actividad completada");
  if (patch.updateTimestamps && patch.finishedAt && patch.finishedAt < patch.startedAt) throw new Error("La fecha y hora de fin no pueden ser anteriores al inicio");
  const next = { ...current, ...patch, progress, status, startedAt: status === "pending" ? null : patch.updateTimestamps ? patch.startedAt : current.startedAt || now, finishedAt: status === "completed" ? patch.updateTimestamps ? patch.finishedAt : current.finishedAt || now : null };
  delete next.updateTimestamps;
  if (index >= 0) dataset.activityProgress[index] = next; else dataset.activityProgress.push(next);
  const currentStageIndex = product.route.indexOf(order.stageId);
  const activityStageIndex = product.route.indexOf(activity.stageId);
  if (status !== "pending" && activityStageIndex > currentStageIndex) order.stageId = activity.stageId;
  recalculateOrder(dataset, ceco);
  return next;
}

export const localRepository = {
  async savePurchaseRequest(action, payload) {
    const dataset = load();
    dataset.purchaseRequests ||= [];
    const today = toLocalDateTimeInput(new Date().toISOString()).slice(0, 10);
    let row = dataset.purchaseRequests.find((item) => item.id === payload.id);
    if (action === "create") {
      if (payload.id && dataset.purchaseRequests.some((item) => item.id === payload.id)) return dataset;
      if (!(Number(payload.quantity) > 0) || !dataset.inventory.some((item) => item.code === payload.material_code)) throw new Error("Revisa el material y la cantidad");
      dataset.purchaseRequests.push({ id: payload.id || newInternalId("request"), request_number: dataset.purchaseRequests.length + 1, material_code: payload.material_code, quantity: Number(payload.quantity), received_quantity: 0, status: "requested", requested_date: today, needed_date: payload.needed_date || null, cecos: payload.cecos || [], note: payload.note || "" });
    } else {
      if (!row || ["received", "cancelled"].includes(row.status)) throw new Error("Registro cerrado o inexistente");
      if (action === "edit" && row.status === "requested") {
        if (!(Number(payload.quantity) > 0)) throw new Error("Cantidad no válida");
        Object.assign(row, { quantity: Number(payload.quantity), needed_date: payload.needed_date, note: payload.note });
      } else if (action === "order" && row.status === "requested") {
        if (!payload.supplier?.trim() || !payload.order_number?.trim() || !payload.order_date || payload.order_date < row.requested_date || !payload.expected_date || payload.expected_date < payload.order_date || payload.unit_cost === "" || Number(payload.unit_cost) < 0) throw new Error("Completa los datos y revisa las fechas de la orden");
        Object.assign(row, { status: "ordered", supplier: payload.supplier, order_number: payload.order_number, order_date: payload.order_date, expected_date: payload.expected_date, unit_cost: Number(payload.unit_cost) });
      } else if (action === "receive" && row.status === "ordered") {
        const quantity = Number(payload.quantity);
        if (!(quantity > 0) || quantity > row.quantity - row.received_quantity || !payload.receipt_at || payload.receipt_at.slice(0,10) < row.order_date || new Date(payload.receipt_at) > new Date() || !payload.receipt_reference?.trim()) throw new Error("Revisa la cantidad, fecha y documento de recepción");
        row.received_quantity += quantity;
        row.status = row.received_quantity === row.quantity ? "received" : "ordered";
        row.receipt_at = payload.receipt_at;
        row.receipt_reference = payload.receipt_reference;
        dataset.inventory.find((item) => item.code === row.material_code).physical += quantity;
        dataset.inventoryMovements.unshift({ id: newInternalId("mov"), type: "ingreso", code: row.material_code, quantity, timestamp: payload.receipt_at, ceco: "", note: `OC ${row.order_number} · Solicitud ${row.request_number} · ${payload.receipt_reference}` });
      } else if (action === "cancel") row.status = "cancelled";
      else throw new Error("Transición no válida");
    }
    save(dataset);
    return dataset;
  },
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
    Object.assign(order, { ...patch, ceco: nextCeco,
      outputValueBasis: Object.hasOwn(patch, "outputValue") ? patch.outputValueBasis ?? "Registrado en CECO" : order.outputValueBasis,
      energyCostBasis: Object.hasOwn(patch, "energyCost") ? patch.energyCostBasis ?? "Registrado en CECO" : order.energyCostBasis,
      capitalCostBasis: Object.hasOwn(patch, "capitalCost") ? patch.capitalCostBasis ?? "Registrado en CECO" : order.capitalCostBasis });
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
    setActivityProgress(dataset, ceco, activityId, patch);
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
      ...payload,
      outputValueBasis: payload.outputValue == null ? null : "Registrado en CECO",
      energyCostBasis: payload.energyCost == null ? null : "Registrado en CECO",
      capitalCostBasis: payload.capitalCost == null ? null : "Registrado en CECO"
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
    const safety = calculateSafetyStock(payload);
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
    for (const row of consolidateImportedMaterials(payload.materials)) {
      const category = ensureCatalog("categories", row.category);
      const unit = ensureCatalog("units", row.unit, row.unit);
      const brand = ensureCatalog("brands", row.brand);
      const existing = findMatchingMaterial(dataset.inventory, row);
      const code = existing?.code || row.code || nextInventoryCode(dataset.inventory, row.category || "MAT");
      const material = { id: existing?.id || `inv-${code}`, code, category: category.name, categoryId: category.id, description: row.description, physical: Number(existing?.physical || 0) + Number(row.physical || 0), committed: existing?.committed || 0, safety: Number(row.safety ?? existing?.safety ?? 0), unit: unit.symbol, unitId: unit.id, brandId: brand?.id || null, location: row.location || null, serviceFactor: row.serviceFactor ?? existing?.serviceFactor, demandStdDev: row.demandStdDev ?? existing?.demandStdDev, leadTimeDays: row.leadTimeDays ?? existing?.leadTimeDays, averageDemand: row.averageDemand ?? existing?.averageDemand, leadTimeStdDev: row.leadTimeStdDev ?? existing?.leadTimeStdDev, serviceLevel: row.serviceLevel ?? existing?.serviceLevel, unitCost: row.unitCost ?? existing?.unitCost ?? null, unitCostBasis: row.unitCost == null ? existing?.unitCostBasis ?? null : "Importado de Excel", safetyParametersBasis: row.averageDemand == null ? existing?.safetyParametersBasis ?? null : "Importado de Excel", currency: row.currency || "PEN" };
      material.safety = calculateSafetyStock(material);
      if (existing) Object.assign(existing, material); else dataset.inventory.unshift(material);
      for (const sourceCode of row.sourceCodes?.length ? row.sourceCodes : [row.code]) {
        importedCodes.set(sourceCode, code);
      }
    }
    for (const row of payload.products || []) {
      const family = dataset.productFamilies.find((item) => item.name.toLowerCase() === row.family.toLowerCase());
      const brand = ensureCatalog("brands", row.brand || "Genérico");
      const unit = ensureCatalog("units", row.outputUnit, row.outputUnit);
      const route = orderProductRoute(dataset.flowStages, row.route.map((code) => dataset.flowStages.find((stage) => stage.id === code || stage.code === code)?.id).filter(Boolean));
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
      const data = { bodyTypeId: product.id, stageId: stage.id, sourcePhaseCode: row.sourcePhaseCode || "", materialCode: material.code, pieceCode: row.pieceCode, description: row.description || material.description, lengthMm: Number(row.lengthMm || 0), quantity: Number(row.quantity) };
      if (existing) Object.assign(existing, data); else dataset.bom.unshift({ id: `bom-import-${slug(product.code)}-${slug(row.pieceCode)}`, ...data });
    }
    const importedProductCodes = new Set((payload.bom || []).map((row) => row.productCode));
    dataset.orders.filter((order) => importedProductCodes.has(dataset.bodyTypes.find((item) => item.id === order.bodyTypeId)?.code)).forEach((order) => syncOrderReservations(dataset, order.ceco));
    save(dataset);
    return dataset;
  },
  async createCatalogItem(payload) {
    const dataset = load();
    const collection = payload.type === "families" ? dataset.productFamilies : dataset.catalogs[payload.type];
    if (!collection) throw new Error("Catálogo no válido");
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Ingresa un nombre para la opción");
    if (collection.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("Esta opción ya existe en el catálogo");
    }
    const prefix = payload.type === "categories" ? "cat" : payload.type === "units" ? "unit" : payload.type === "brands" ? "brand" : "family";
    const id = `${prefix}-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now()}`;
    const item = { id, name, ...(payload.type === "units" ? { symbol: String(payload.symbol || "").trim() || name.toLowerCase() } : {}) };
    collection.push(item);
    save(dataset);
    return dataset;
  },
  async updateCatalogItem(payload) {
    const dataset = load();
    const item = (payload.type === "families" ? dataset.productFamilies : dataset.catalogs[payload.type])?.find((entry) => entry.id === payload.id);
    if (!item) throw new Error("Opción no encontrada");
    item.name = String(payload.name || "").trim() || item.name;
    if (payload.type === "units") item.symbol = String(payload.symbol || "").trim() || item.symbol;
    save(dataset);
    return dataset;
  },
  async deleteCatalogItem(payload) {
    const dataset = load();
    const collection = payload.type === "families" ? dataset.productFamilies : dataset.catalogs[payload.type];
    if (!collection?.some((item) => item.id === payload.id)) throw new Error("Opción no encontrada");
    const linked = payload.type === "families"
      ? dataset.bodyTypes.some((item) => item.familyId === payload.id || item.family === collection.find((entry) => entry.id === payload.id)?.name)
      : dataset.inventory.some((item) => item[payload.type === "categories" ? "categoryId" : payload.type === "units" ? "unitId" : "brandId"] === payload.id);
    if (linked) throw new Error(`No se puede eliminar una ${payload.type === "families" ? "familia" : "opción"} que está en uso`);
    if (payload.type === "families") dataset.productFamilies = collection.filter((item) => item.id !== payload.id);
    else dataset.catalogs[payload.type] = collection.filter((item) => item.id !== payload.id);
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
  async updateInventoryMovementTimestamp(id, timestamp) {
    const dataset = load();
    const movement = (dataset.inventoryMovements ?? []).find((item) => item.id === id);
    if (!movement) throw new Error("Movimiento de inventario no encontrado");
    movement.timestamp = toLocalDateTimeInput(timestamp).replace("T", " ");
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
    syncOrderReservations(dataset, ceco);
    save(dataset);
    return dataset;
  },
  async createBodyType(payload) {
    const dataset = load();
    const id = `body-${String(payload.code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    dataset.bodyTypes.push({ id, ...payload, route: orderProductRoute(dataset.flowStages, payload.route), targetDays: Number(payload.targetDays) });
    save(dataset);
    return dataset;
  },
  async updateBodyType(id, payload) {
    const dataset = load();
    const item = dataset.bodyTypes.find((entry) => entry.id === id);
    if (!item) throw new Error("Producto no encontrado");
    Object.assign(item, payload, { route: orderProductRoute(dataset.flowStages, payload.route), targetDays: Number(payload.targetDays) });
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
    const calculatedSafety = calculateSafetyStock(patch);
    dataset.inventory = dataset.inventory.map((item) => (item.code === code ? { ...item, ...patch, safety: calculatedSafety,
      unitCostBasis: patch.unitCost == null ? null : patch.unitCostBasis ?? "Registrado en Inventario", safetyParametersBasis: patch.safetyParametersBasis ?? "Registrado en Inventario" } : item));
    save(dataset);
    return dataset;
  },
  async updateMaterialPrices(entries) {
    const dataset = load();
    const prices = new Map(entries.map(({ code, unitCost }) => [code, Number(unitCost)]));
    for (const [code, price] of prices) {
      if (!dataset.inventory.some((item) => item.code === code) || !Number.isFinite(price) || price <= 0) {
        throw new Error(`Precio no válido para el material ${code}.`);
      }
    }
    dataset.inventory = dataset.inventory.map((item) => prices.has(item.code) ? { ...item, unitCost: prices.get(item.code), unitCostBasis: "Importado de Excel" } : item);
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
    const activity = dataset.stageActivities.find((item) => item.id === payload.activityId);
    if (!activity) throw new Error("Selecciona una actividad válida");
    const reservations = dataset.orderMaterialReservations?.filter((item) => item.ceco === payload.ceco && item.materialCode === payload.materialCode && item.stageId === activity.stageId) || [];
    const pending = reservations.reduce((sum, item) => sum + Number(item.reservedQuantity) - Number(item.issuedQuantity || 0), 0);
    if (pending < Number(payload.quantity)) throw new Error("La cantidad supera la reserva pendiente de la orden");
    let left = Number(payload.quantity);
    reservations.forEach((item) => { const take = Math.min(left, Number(item.reservedQuantity) - Number(item.issuedQuantity || 0)); item.issuedQuantity = Number(item.issuedQuantity || 0) + take; item.status = item.issuedQuantity >= item.requiredQuantity ? "issued" : "partial"; left -= take; });
    const ticket = nextWarehouseTicket(dataset.warehouse);
    dataset.warehouse.unshift({ id: `wh-${ticket}`, ticket, timestamp: new Date().toISOString().slice(0, 16).replace("T", " "), ...payload, stageId: activity.stageId });
    dataset.inventory = dataset.inventory.map((item) => (
      item.code === payload.materialCode
        ? {
            ...item,
            physical: Math.max(0, Number(item.physical) - Number(payload.quantity)),
            committed: Math.max(0, Number(item.committed) - Number(payload.quantity))
          }
        : item
    ));
    addMovement(dataset, { type: "salida", code: payload.materialCode, ceco: payload.ceco, stageId: activity.stageId, activityId: activity.id, quantity: Number(payload.quantity), note: `Ticket ${ticket} · ${activity.name}` });
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
    const current = dataset.activityProgress?.find((item) => item.ceco === payload.ceco && item.activityId === payload.activityId);
    if (current?.status !== "completed") setActivityProgress(dataset, payload.ceco, payload.activityId, { status: "in_progress", progress: Number(current?.progress || 0) });
    save(dataset);
    return dataset;
  },
  async updateOperation(id, payload) {
    const dataset = load();
    const row = dataset.operations.find((item) => item.id === id);
    if (!row) throw new Error("Parte diario no encontrado.");
    Object.assign(row, payload, { totalHours: Number(payload.totalHours) });
    save(dataset); return dataset;
  },
  async deleteOperation(id) {
    const dataset = load();
    if (!dataset.operations.some((item) => item.id === id)) throw new Error("Parte diario no encontrado.");
    dataset.operations = dataset.operations.filter((item) => item.id !== id);
    save(dataset); return dataset;
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
    dataset.shifts.unshift({ id: `shift-${Date.now()}`, ...payload, breakMinutes: Number(payload.breakMinutes), daysPerWeek: Number(payload.daysPerWeek), active: true });
    save(dataset); return dataset;
  },
  async updateShift(id, payload) {
    const dataset = load();
    const row = dataset.shifts.find((item) => item.id === id);
    if (!row) throw new Error("Turno no encontrado.");
    Object.assign(row, payload, { breakMinutes: Number(payload.breakMinutes), daysPerWeek: Number(payload.daysPerWeek) });
    dataset.personnel.forEach((person) => { person.weeklyHours = personnelWeeklyHours(dataset.shifts, person.shiftIds || []); });
    save(dataset); return dataset;
  },
  async createPersonnel(payload) {
    const dataset = load();
    const normalizedName = String(payload.name).trim().toLocaleLowerCase("es");
    if (dataset.personnel.some((item) => String(item.name).trim().toLocaleLowerCase("es") === normalizedName)) throw new Error("Ya existe un trabajador con ese nombre. Edítalo para cambiar o agregar turnos.");
    const shiftIds = [...new Set(payload.shiftIds || [])];
    dataset.personnel.unshift({ id: `person-${Date.now()}`, ...payload, hourlyCostBasis: payload.hourlyCost == null ? null : payload.hourlyCostBasis ?? "Registrado en Personal", shiftIds, shiftId: shiftIds[0] || null, efficiency: Number(payload.efficiency), weeklyHours: personnelWeeklyHours(dataset.shifts, shiftIds), active: true });
    save(dataset); return dataset;
  },
  async updatePersonnel(id, payload) {
    const dataset = load();
    const row = dataset.personnel.find((item) => item.id === id);
    if (!row) throw new Error("Trabajador no encontrado.");
    const normalizedName = String(payload.name).trim().toLocaleLowerCase("es");
    if (dataset.personnel.some((item) => item.id !== id && String(item.name).trim().toLocaleLowerCase("es") === normalizedName)) throw new Error("Ya existe otro trabajador con ese nombre.");
    const shiftIds = [...new Set(payload.shiftIds || [])];
    Object.assign(row, payload, { hourlyCostBasis: payload.hourlyCost == null ? null : payload.hourlyCostBasis ?? "Registrado en Personal", shiftIds, shiftId: shiftIds[0] || null, efficiency: Number(payload.efficiency), weeklyHours: personnelWeeklyHours(dataset.shifts, shiftIds) });
    save(dataset); return dataset;
  },
  async createEquipment(payload) {
    const dataset = load();
    dataset.equipment.unshift({ id: `equipment-${Date.now()}`, ...payload, capacityHours: Number(payload.capacityHours) });
    save(dataset); return dataset;
  },
  async updateEquipment(id, payload) {
    const dataset = load();
    const row = dataset.equipment.find((item) => item.id === id);
    if (!row) throw new Error("Equipo no encontrado.");
    Object.assign(row, payload, { capacityHours: Number(payload.capacityHours) });
    save(dataset); return dataset;
  },
  async createCalendarDay(payload) {
    const dataset = load();
    const row = { id: `calendar-${payload.date}`, ...payload, availableHours: Number(payload.availableHours) };
    dataset.workCalendar = [row, ...dataset.workCalendar.filter((item) => item.date !== payload.date)];
    save(dataset); return dataset;
  },
  async updateCalendarDay(id, payload) {
    const dataset = load();
    const row = dataset.workCalendar.find((item) => item.id === id);
    if (!row) throw new Error("Excepción de calendario no encontrada.");
    Object.assign(row, payload, { availableHours: Number(payload.availableHours) });
    save(dataset); return dataset;
  },
  async createAssignment(payload) {
    const dataset = load();
    dataset.assignments.unshift({ id: `assignment-${Date.now()}`, ...payload, plannedHours: Number(payload.plannedHours) });
    save(dataset); return dataset;
  },
  async updateAssignment(id, payload) {
    const dataset = load();
    const row = dataset.assignments.find((item) => item.id === id);
    if (!row) throw new Error("Asignación no encontrada.");
    Object.assign(row, payload, { plannedHours: Number(payload.plannedHours) });
    save(dataset); return dataset;
  },
  async deleteAssignment(id) {
    const dataset = load();
    if (!dataset.assignments.some((item) => item.id === id)) throw new Error("Asignación no encontrada.");
    dataset.assignments = dataset.assignments.filter((item) => item.id !== id);
    save(dataset); return dataset;
  },
  async createIncident(payload) {
    const dataset = load();
    dataset.incidents.unshift({ id: `incident-${Date.now()}`, ...payload, downtimeHours: Number(payload.downtimeHours), status: "open" });
    save(dataset); return dataset;
  },
  async updateIncident(id, payload) {
    const dataset = load();
    const row = dataset.incidents.find((item) => item.id === id);
    if (!row) throw new Error("Incidencia no encontrada.");
    Object.assign(row, payload, { downtimeHours: Number(payload.downtimeHours) });
    save(dataset); return dataset;
  },
  subscribe(callback) {
    const listener = (event) => callback(event.detail);
    window.addEventListener("etral:dataset", listener);
    return () => window.removeEventListener("etral:dataset", listener);
  }
};
