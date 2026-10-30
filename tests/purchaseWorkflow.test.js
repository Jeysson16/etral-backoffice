import test from "node:test";
import assert from "node:assert/strict";
import { initialDataset } from "../src/data/seed.js";
import { localRepository } from "../src/services/localRepository.js";

test("confirmar una llegada histórica guarda la fecha sin duplicar inventario", async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  const sample = structuredClone(initialDataset);
  sample.historicalPurchases = [{ id: "historic-1", ceco: "260440", material_code: sample.inventory[0].code, purchased_quantity: 1, received_on: null }];
  values.set("etral.production.dataset.v5", JSON.stringify(sample));
  const beforeStock = sample.inventory[0].physical;
  const beforeMovements = sample.inventoryMovements.length;

  const confirmed = await localRepository.savePurchaseRequest("historicalReceipt", { id: "historic-1", received_on: "2026-08-20" });
  assert.equal(confirmed.historicalPurchases[0].received_on, "2026-08-20");
  assert.equal(confirmed.inventory[0].physical, beforeStock);
  assert.equal(confirmed.inventoryMovements.length, beforeMovements);

  const corrected = await localRepository.savePurchaseRequest("historicalReceipt", { id: "historic-1", received_on: null });
  assert.equal(corrected.historicalPurchases[0].received_on, null);
});
