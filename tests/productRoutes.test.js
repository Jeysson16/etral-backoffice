import test from "node:test";
import assert from "node:assert/strict";
import { orderProductRoute } from "../src/lib/productRoutes.js";

test("ordena una ruta importada según la secuencia productiva", () => {
  const stages = [
    { id: "supply", order: 0 },
    { id: "prepaint", order: 1 },
    { id: "cut", order: 2 },
    { id: "assembly", order: 3 }
  ];

  assert.deepEqual(
    orderProductRoute(stages, ["supply", "cut", "prepaint", "assembly"]),
    ["supply", "prepaint", "cut", "assembly"]
  );
});

test("elimina fases repetidas o inexistentes de una ruta importada", () => {
  const stages = [{ id: "supply", order: 0 }, { id: "cut", order: 2 }];

  assert.deepEqual(orderProductRoute(stages, ["cut", "missing", "supply", "cut"]), ["supply", "cut"]);
});
