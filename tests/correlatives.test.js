import test from "node:test";
import assert from "node:assert/strict";
import { nextCecoCode, nextInventoryCode, nextWarehouseTicket } from "../src/lib/correlatives.js";

test("genera correlativo CECO por año y secuencia", () => {
  const orders = [{ ceco: "260180" }, { ceco: "260181" }, { ceco: "250999" }];
  assert.equal(nextCecoCode(orders, new Date("2026-07-12T00:00:00")), "260182");
});

test("genera correlativo de inventario por categoría", () => {
  const inventory = [{ code: "MAT-0042" }, { code: "MAT-0047" }, { code: "HER-0010" }];
  assert.equal(nextInventoryCode(inventory, "MAT"), "MAT-0048");
  assert.equal(nextInventoryCode(inventory, "HER"), "HER-0011");
});

test("genera ticket de salida de almacén", () => {
  assert.equal(nextWarehouseTicket([{ ticket: "SAL-7001" }, { ticket: "SAL-7008" }]), "SAL-7009");
});
