import test from "node:test";
import assert from "node:assert/strict";
import { groupProcurementRows } from "../src/lib/procurementGroups.js";

test("agrupa solicitudes por CECO y orden de fase, priorizando los abiertos", () => {
  const dataset = {
    orders: [{ ceco: "260500", bodyTypeId: "p", progress: 0 }, { ceco: "260440", bodyTypeId: "p", progress: 100 }],
    bodyTypes: [{ id: "p", name: "Furgón", route: ["cut", "paint"] }],
    flowStages: [{ id: "cut", name: "Corte" }, { id: "paint", name: "Pintura" }],
    bom: [{ bodyTypeId: "p", stageId: "cut", materialCode: "A" }, { bodyTypeId: "p", stageId: "paint", materialCode: "B" }]
  };
  const rows = [
    { id: "old", cecos: ["260440"], material_code: "A" },
    { id: "paint", cecos: ["260500"], material_code: "B" },
    { id: "cut", cecos: ["260500"], material_code: "A" }
  ];
  assert.deepEqual(groupProcurementRows(dataset, rows).map((group) => [group.ceco, group.phaseName, group.rows.map((row) => row.id)]), [
    ["260500", "Corte", ["cut"]], ["260500", "Pintura", ["paint"]], ["260440", "Corte", ["old"]]
  ]);
});
