import test from "node:test";
import assert from "node:assert/strict";
import { effectiveOrderStageId } from "../src/lib/mrp.js";

const bodyTypes = [{ id: "body-1", route: ["stage-1", "stage-2", "stage-3", "stage-4"] }];
const activities = [
  { id: "a1", stageId: "stage-1", active: true },
  { id: "a2", stageId: "stage-2", active: true },
  { id: "a3", stageId: "stage-3", active: true },
  { id: "a4", stageId: "stage-4", active: true }
];

test("ubica la orden en la primera fase con actividades pendientes", () => {
  const order = { ceco: "260370", bodyTypeId: "body-1", stageId: "stage-2" };
  const progress = activities.map((activity, index) => ({
    ceco: order.ceco,
    activityId: activity.id,
    status: index < 3 ? "completed" : "pending"
  }));

  assert.equal(effectiveOrderStageId(order, bodyTypes, activities, progress), "stage-4");
});

test("mantiene una orden totalmente completada en la última fase", () => {
  const order = { ceco: "260370", bodyTypeId: "body-1", stageId: "stage-2" };
  const progress = activities.map((activity) => ({ ceco: order.ceco, activityId: activity.id, status: "completed" }));

  assert.equal(effectiveOrderStageId(order, bodyTypes, activities, progress), "stage-4");
});
