import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioRecord, reuseScenario, changeSelectedDeliveries, reduceSelectedStock } from '../src/lib/supplyScenarios.js';

test('un escenario guarda opciones y resultados originales, sin referencias al dataset vivo', () => {
  const run = { options: { startDate: '2026-10-29', horizonDays: 30, deliveries: { a: { delayDays: 3 } } }, baseline: { inventory: [{ physical: 2 }] }, scenario: { inventory: [{ physical: 1 }] }, dataset: { private: 'not stored' } };
  const saved = scenarioRecord(' Retraso ', run);
  run.scenario.inventory[0].physical = 90;
  run.options.deliveries.a.delayDays = 9;
  assert.equal(saved.name, 'Retraso');
  assert.equal(saved.results.scenario.inventory[0].physical, 1);
  assert.equal(saved.parameters.deliveries.a.delayDays, 3);
  assert.equal(saved.dataset, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)).results, saved.results);
  assert.throws(() => scenarioRecord(' ', run));
});
test('reutiliza fechas relativas a hoy y omite pedidos cerrados o materiales eliminados', () => {
  const saved = { parameters: { kind: 'material_supply_v1', startDate: '2026-10-29', horizonDays: 7, deliveries: { a: { date: '2026-10-31', delayDays: 3 }, b: { percent: 0 } }, stockAdjustments: { M: -1, gone: -2 } } };
  const dataset = { inventory: [{ code: 'M' }], purchaseRequests: [{ id: 'a', status: 'ordered', quantity: 5, received_quantity: 2 }, { id: 'b', status: 'received', quantity: 3, received_quantity: 3 }] };
  const result = reuseScenario(saved, dataset, '2026-11-02');
  assert.equal(result.options.deliveries.a.date, '2026-11-04');
  assert.equal(result.options.deliveries.a.delayDays, 3);
  assert.equal(result.omitted, 2);
  assert.deepEqual(result.options.stockAdjustments, { M: -1 });
  assert.equal(saved.parameters.deliveries.a.date, '2026-10-31');
});
test('edición masiva cambia solo seleccionados y conserva fechas cuando el campo común está vacío', () => {
  const before = { a: { date: '2026-10-31', percent: 50 }, b: { missed: true }, c: { delayDays: 1 } };
  const after = changeSelectedDeliveries(before, ['a', 'b'], { delayDays: 3, percent: 0, date: '' });
  assert.equal(after.a.date, '2026-10-31');
  assert.equal(after.a.percent, 0);
  assert.equal(after.b.delayDays, 3);
  assert.equal(after.b.missed, false);
  assert.deepEqual(after.c, before.c);
  assert.equal(before.a.percent, 50);
});
test('reducción masiva respeta cantidad y unidad de cada material, sin inventario negativo', () => {
  const materials = [{ code: 'kg', physical: 2.4 }, { code: 'und', physical: 8 }];
  assert.deepEqual(reduceSelectedStock({ other: 1 }, materials, 50), { other: 1, kg: -1.2, und: -4 });
  assert.throws(() => reduceSelectedStock({}, materials, 101));
  assert.throws(() => reduceSelectedStock({}, materials, ''));
});
