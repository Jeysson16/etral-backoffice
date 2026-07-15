import { initialDataset } from "../data/seed.js";
import { nextCecoCode, nextInventoryCode, nextWarehouseTicket } from "../lib/correlatives.js";

const STORAGE_KEY = "etral.production.dataset.v5";

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(initialDataset);
  const stored = JSON.parse(raw);
  return {
    ...structuredClone(initialDataset),
    ...stored,
    stageActivities: stored.stageActivities || structuredClone(initialDataset.stageActivities),
    stageInventory: stored.stageInventory || structuredClone(initialDataset.stageInventory)
  };
}

function save(dataset) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
  window.dispatchEvent(new CustomEvent("etral:dataset", { detail: dataset }));
}

function addMovement(dataset, movement) {
  dataset.inventoryMovements = dataset.inventoryMovements || [];
  dataset.inventoryMovements.unshift({
    id: `mov-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    ...movement
  });
}

function reserveBom(dataset, order) {
  dataset.bom
    .filter((piece) => piece.bodyTypeId === order.bodyTypeId)
    .forEach((piece) => {
      dataset.inventory = dataset.inventory.map((item) => (
        item.code === piece.materialCode
          ? { ...item, committed: Number(item.committed) + Number(piece.quantity) }
          : item
      ));
      addMovement(dataset, { type: "reserva", code: piece.materialCode, ceco: order.ceco, quantity: Number(piece.quantity), note: "Reserva automática por apertura CECO" });
    });
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
      const stageIndex = sortedStages.findIndex((stage) => stage.id === stageId);
      order.stageId = stageId;
      order.progress = Math.min(100, Math.max(order.progress, (stageIndex + 1) * 15));
      order.plantState = order.status === "red" ? "Bloqueado MRP" : "En proceso";
    }
    save(dataset);
    return dataset;
  },
  async createOrder(payload) {
    const dataset = load();
    const ceco = nextCecoCode(dataset.orders, new Date("2026-07-12T12:00:00"));
    const order = {
      id: `order-${ceco}`,
      ceco,
      progress: 0,
      status: "orange",
      stageId: dataset.flowStages[0]?.id ?? "stage-supply",
      plantState: "En cola",
      priority: dataset.orders.length + 1,
      ...payload
    };
    dataset.orders.unshift(order);
    reserveBom(dataset, order);
    save(dataset);
    return dataset;
  },
  async createInventory(payload) {
    const dataset = load();
    const code = nextInventoryCode(dataset.inventory, payload.category || "MAT");
    dataset.inventory.unshift({ id: `inv-${code}`, code, committed: 0, ...payload });
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
  async createBodyType(payload) {
    const dataset = load();
    const id = `body-${String(payload.code).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    dataset.bodyTypes.push({ id, ...payload, targetDays: Number(payload.targetDays) });
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
  async updateInventory(code, patch) {
    const dataset = load();
    dataset.inventory = dataset.inventory.map((item) => (item.code === code ? { ...item, ...patch } : item));
    save(dataset);
    return dataset;
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
  subscribe(callback) {
    const listener = (event) => callback(event.detail);
    window.addEventListener("etral:dataset", listener);
    return () => window.removeEventListener("etral:dataset", listener);
  }
};
