import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSupply, simulateSupply } from '../src/lib/supplySimulation.js';

const options = { startDate: '2026-10-29', horizonDays: 7 };
function fixture() {
  return {
    inventory: [{ code: 'M1', description: 'Plancha', unit: 'und', physical: 2, committed: 6, safety: 1 }],
    bodyTypes: [{ id: 'P1', name: 'Furgón' }],
    orders: [{ ceco: 'C1', bodyTypeId: 'P1', progress: 0, plannedStartDate: '2026-10-30' }],
    bom: [{ id: 'B1', bodyTypeId: 'P1', materialCode: 'M1', stageId: 'S1', quantity: 6 }],
    purchaseRequests: [{ id: 'R1', request_number: 1, status: 'ordered', material_code: 'M1', quantity: 6, received_quantity: 2, expected_date: '2026-10-30', cecos: ['C1'] }]
  };
}
test('saldo de OC y compromisos no duplican recepciones ni consumos', () => {
  const result = simulateSupply(fixture(), options);
  assert.equal(result.purchases[0].quantity, 4);
  assert.equal(result.cecoMaterials[0].onTime, 6);
  assert.equal(result.inventory[0].closing, 0);
  assert.equal(result.inventory[0].replenish, 1);
});
test('retraso cambia fecha de cobertura, manteniendo saldo final', () => {
  const result = compareSupply(fixture(), { ...options, deliveries: { R1: { delayDays: 3 } } });
  assert.equal(result.baseline.cecoMaterials[0].state, 'A tiempo');
  assert.equal(result.scenario.cecoMaterials[0].missingOnDate, 4);
  assert.equal(result.scenario.cecoMaterials[0].coverageDate, '2026-11-02');
  assert.equal(result.scenario.cecoMaterials[0].delayDays, 3);
  assert.equal(result.scenario.inventory[0].closing, 0);
});
test('no ingreso y recepción parcial producen faltantes reales en el escenario', () => {
  assert.equal(simulateSupply(fixture(), { ...options, deliveries: { R1: { missed: true } } }).cecoMaterials[0].missing, 4);
  assert.equal(simulateSupply(fixture(), { ...options, deliveries: { R1: { percent: 50 } } }).cecoMaterials[0].missing, 2);
});
test('la cantidad exacta de un pedido determina el ingreso parcial', () => {
  const result = simulateSupply(fixture(), { ...options, deliveries: { R1: { quantity: 3 } } });
  assert.equal(result.purchases[0].quantity, 3);
  assert.equal(result.purchases[0].outcome, 'Ingreso parcial');
  assert.equal(result.cecoMaterials[0].missing, 1);
  assert.throws(() => simulateSupply(fixture(), { ...options, deliveries: { R1: { quantity: 5 } } }), /cantidad que llega/);
  assert.throws(() => simulateSupply(fixture(), { ...options, deliveries: { R1: { quantity: '' } } }), /indica la cantidad/);
});
test('solicitud sin OC requiere fecha hipotética y no afecta la base', () => {
  const data = fixture(); data.purchaseRequests[0].status = 'requested';
  const result = compareSupply(data, { ...options, deliveries: { R1: { date: '2026-10-30' } } });
  assert.equal(result.baseline.cecoMaterials[0].missing, 4);
  assert.equal(result.scenario.cecoMaterials[0].missing, 0);
});
test('OC vencida no se presume recibida y se puede reprogramar solo en escenario', () => {
  const data = fixture(); data.purchaseRequests[0].expected_date = '2026-10-28';
  assert.equal(simulateSupply(data, options).purchases[0].quantity, 0);
  assert.equal(simulateSupply(data, { ...options, deliveries: { R1: { date: '2026-10-30' } } }).cecoMaterials[0].missing, 0);
});
test('ingreso fuera del horizonte puede dar fecha de cobertura pero no saldo final positivo', () => {
  const result = simulateSupply(fixture(), { ...options, deliveries: { R1: { delayDays: 10 } } });
  assert.equal(result.inventory[0].receipts, 0);
  assert.equal(result.cecoMaterials[0].missingInHorizon, 4);
  assert.equal(result.cecoMaterials[0].coverageDate, '2026-11-09');
});
test('stock compartido y compra ligada a CECO no se reutilizan', () => {
  const data = fixture(); data.orders.push({ ...data.orders[0], ceco: 'C2' });
  const result = simulateSupply(data, options);
  assert.equal(result.cecoMaterials[0].missing, 0);
  assert.equal(result.cecoMaterials[1].missing, 6);
  assert.equal(result.cecoMaterials.reduce((sum, row) => sum + row.onTime, 0), 6);
});
test('fases completadas, materiales entregados y CECO cerrados no vuelven a demandar', () => {
  const data = fixture();
  data.orderMaterialReservations = [{ ceco: 'C1', bomItemId: 'B1', issuedQuantity: 2 }];
  assert.equal(simulateSupply(data, options).cecoMaterials[0].quantity, 4);
  data.stageActivities = [{ id: 'A1', stageId: 'S1', active: true }];
  data.activityProgress = [{ ceco: 'C1', activityId: 'A1', status: 'completed' }];
  assert.equal(simulateSupply(data, options).cecoMaterials.length, 0);
  data.stageActivities = []; data.orders[0].progress = 100;
  assert.equal(simulateSupply(data, options).cecos.length, 0);
});
test('inventario mantiene faltantes sin CECO y los ajustes no mutan datos', () => {
  const data = fixture(); data.inventory.push({ code: 'M2', physical: 0, safety: 3 });
  const original = structuredClone(data);
  const result = simulateSupply(data, { ...options, stockAdjustments: { M1: -2 } });
  assert.equal(result.cecoMaterials[0].missing, 2);
  assert.equal(result.inventory[1].replenish, 3);
  assert.deepEqual(data, original);
  assert.throws(() => simulateSupply(data, { ...options, stockAdjustments: { M1: -3 } }));
});
test('recepciones cerradas/canceladas y necesidad posterior al horizonte no se cuentan', () => {
  const data = fixture(); data.purchaseRequests[0].status = 'received';
  assert.equal(simulateSupply(data, options).purchases.length, 0);
  data.orders[0].plannedStartDate = '2026-12-01';
  assert.equal(simulateSupply(data, options).cecoMaterials.length, 0);
});
