import test from "node:test";
import assert from "node:assert/strict";
import { buildMaterialPlan, buildProductionPlan, materialOrderLinks } from "../src/lib/planning.js";

const dataset = {
  flowStages: [{ id: "cut", standardHours: 4, capacityHours: 10 }],
  bodyTypes: [{ id: "product", name: "Producto", targetDays: 2, route: ["cut"] }],
  orders: [{ ceco: "260001", bodyTypeId: "product", plannedStartDate: "2026-10-21", dueDate: "2026-10-22", progress: 0, active: true }],
  bom: [{ bodyTypeId: "product", materialCode: "MAT-1", quantity: 7 }],
  inventory: [{ code: "MAT-1", description: "Material", physical: 3, safety: 2, leadTimeDays: 7, unit: "und" }]
};

test("calendario PMP ubica la entrega y estima capacidad semanal", () => {
  const plan = buildProductionPlan(dataset, "2026-10-21");
  assert.equal(plan.rows[0].week, 0);
  assert.equal(plan.capacity[0].required, 4);
  assert.equal(plan.capacity[0].utilization, 40);
});

test("MRP propone una recepción y fecha de pedido trazables", () => {
  const plan = buildMaterialPlan(dataset, "2026-10-21");
  const cell = plan.rows[0].cells[0];
  assert.equal(cell.gross, 7);
  assert.equal(cell.afterDemand, -4);
  assert.equal(cell.receipt, 6);
  assert.equal(cell.closing, 2);
  assert.deepEqual(cell.cecos, ["260001"]);
  assert.deepEqual(plan.rows[0].orders.map((order) => [order.ceco, order.product, order.quantity]), [["260001", "Producto", 7]]);
  assert.equal(plan.purchases[0].orderBy, "2026-10-14");
});

test("inventario identifica el CECO y producto asociados a cada material", () => {
  const links = materialOrderLinks(dataset).get("MAT-1");
  assert.deepEqual(links.map((link) => [link.ceco, link.product, link.quantity]), [["260001", "Producto", 7]]);
});
