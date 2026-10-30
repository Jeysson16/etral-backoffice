import React, { useState } from 'react';
import { compareSupply, pendingPurchases } from '../lib/supplySimulation.js';
import { toLocalDateTimeInput } from '../lib/dateTime.js';

const number = (value) => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });
const date = (value) => value ? new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Sin fecha';
const reference = (row) => `${row.order_number ? `OC ${row.order_number} · ` : ''}SC-${String(row.request_number).padStart(5, '0')}`;

export default function SupplySimulator({ dataset, dataReady }) {
  const [startDate, setStartDate] = useState(() => toLocalDateTimeInput(new Date().toISOString()).slice(0, 10));
  const [horizonDays, setHorizonDays] = useState(30);
  const [deliveries, setDeliveries] = useState({});
  const [stockAdjustments, setStockAdjustments] = useState({});
  const [selectedPurchase, setSelectedPurchase] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [query, setQuery] = useState('');
  const [ceco, setCeco] = useState('');
  const [tab, setTab] = useState('cecos');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const purchases = pendingPurchases(dataset);
  const activeOrders = dataset.orders.filter((row) => row.active !== false && Number(row.progress) < 100);
  const matches = (row) => `${row.code || row.material_code} ${row.description || dataset.inventory.find((item) => item.code === row.material_code)?.description || ''} ${row.order_number || ''} ${row.request_number || ''}`.toLowerCase().includes(query.toLowerCase());
  const selected = purchases.find((row) => row.id === selectedPurchase);
  const selectedStock = dataset.inventory.find((row) => row.code === selectedMaterial);
  const options = { startDate, horizonDays, deliveries, stockAdjustments };
  const signature = JSON.stringify(options);
  const stale = run && (signature !== run.signature || dataset !== run.dataset);
  function editDelivery(id, key, value) { setDeliveries((current) => ({ ...current, [id]: { ...current[id], [key]: value } })); }
  function simulate() {
    try { setRun({ ...compareSupply(dataset, options), signature, dataset }); setError(''); }
    catch (err) { setError(err.message); }
  }
  function reset() { setDeliveries({}); setStockAdjustments({}); setError(''); }
  const result = run?.scenario;
  const cecoRows = result?.cecoMaterials.filter((row) => (!ceco || row.ceco === ceco) && matches(row) && (!onlyIssues || row.state !== 'A tiempo')) || [];
  const inventoryRows = result?.inventory.filter((row) => matches(row) && (!onlyIssues || row.replenish > 0 || row.missingOnDate > 0)) || [];
  const purchaseRows = result?.purchases.filter((row) => matches(row) && (!ceco || row.cecos?.includes(ceco))) || [];
  return <div className="supply-simulator stack-lg">
    <section className="panel supply-config">
      <span className="eyebrow">Simulador de abastecimiento</span><h2>¿Qué pasa si el material no llega a tiempo?</h2>
      <p>Compara los ingresos registrados en las órdenes de compra con un escenario de retraso, entrega parcial o falta de ingreso. Verás el efecto en inventario y en cada CECO. La simulación no guarda movimientos reales.</p>
      <div className="supply-controls">
        <label>Inicio de la simulación<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /><small>Usa el stock actual como saldo inicial; cambiar la fecha no reconstruye inventario histórico.</small></label>
        <label>Días a evaluar<select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))}>{[7,14,30,60,90].map((days) => <option key={days} value={days}>{days} días</option>)}</select><small>Desde la fecha de inicio, inclusive.</small></label>
        <label>Consultar CECO<select value={ceco} onChange={(e) => setCeco(e.target.value)}><option value="">Todos los CECO abiertos</option>{activeOrders.map((row) => <option key={row.ceco} value={row.ceco}>{row.ceco} · {dataset.bodyTypes.find((product) => product.id === row.bodyTypeId)?.name}</option>)}</select><small>Filtra la consulta; el cálculo siempre comparte el stock entre todos los CECO.</small></label>
      </div>
      <label className="supply-search">Buscar material, solicitud u OC<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Código, nombre del material o número de compra" /></label>
      <div className="supply-editors">
        <section><h3>1. Simular una entrega</h3><p>Selecciona una solicitud o una OC pendiente. Solo se evalúa la cantidad que todavía no ingresó.</p>
          <label>Solicitud / orden de compra<select value={selectedPurchase} onChange={(e) => setSelectedPurchase(e.target.value)}><option value="">Selecciona un pedido</option>{purchases.filter((row) => matches(row) && (!ceco || row.cecos?.includes(ceco))).map((row) => <option key={row.id} value={row.id}>{reference(row)} · {row.material_code} · {dataset.inventory.find((item) => item.code === row.material_code)?.description}</option>)}</select></label>
          {!purchases.length && <p>No hay solicitudes ni órdenes con saldo pendiente.</p>}
          {selected && <div className="supply-editor">
            <p><strong>{reference(selected)}</strong> · {selected.status === 'requested' ? 'Solicitud sin OC' : 'Orden emitida'}<br />CECO: {selected.cecos?.join(', ') || 'Reposición de inventario'}<br />Pendiente: {number(Number(selected.quantity)-Number(selected.received_quantity || 0))} {dataset.inventory.find((item) => item.code === selected.material_code)?.unit} · Fecha prevista: {date(selected.expected_date)}</p>
            {selected.status === 'requested' && <small>Esta solicitud no tiene una entrega confirmada. Para evaluar qué ocurriría si se compra, indica una fecha de ingreso en el escenario.</small>}
            <label>Fecha de ingreso en el escenario<input type="date" min={startDate} value={deliveries[selected.id]?.date ?? selected.expected_date ?? ''} onChange={(e) => editDelivery(selected.id, 'date', e.target.value)} /><small>Reemplaza la fecha prevista solo dentro de esta simulación.</small></label>
            <div className="supply-controls"><label>Días adicionales de retraso<input type="number" min="0" step="1" value={deliveries[selected.id]?.delayDays ?? 0} onChange={(e) => editDelivery(selected.id, 'delayDays', e.target.value)} /><small>Ejemplo: 3 desplaza el ingreso tres días.</small></label>
            <label>Porcentaje del saldo que llega<input type="number" min="0" max="100" value={deliveries[selected.id]?.percent ?? 100} onChange={(e) => editDelivery(selected.id, 'percent', e.target.value)} /><small>100 = todo; 50 = mitad; 0 = nada.</small></label></div>
            <label className="supply-check"><input type="checkbox" checked={!!deliveries[selected.id]?.missed} onChange={(e) => editDelivery(selected.id, 'missed', e.target.checked)} />No ingresa este pedido</label>
          </div>}
        </section>
        <section><h3>2. Simular una diferencia de stock</h3><p>Conserva la prueba de faltantes de inventario. Úsala para una pérdida o un ajuste inicial; las entregas de pedidos se configuran en el paso 1.</p>
          <label>Material de inventario<select value={selectedMaterial} onChange={(e) => setSelectedMaterial(e.target.value)}><option value="">Selecciona un material</option>{dataset.inventory.filter(matches).map((row) => <option key={row.code} value={row.code}>{row.code} · {row.description}</option>)}</select></label>
          {selectedStock && <div className="supply-editor"><p>Stock físico actual: <strong>{number(selectedStock.physical)} {selectedStock.unit}</strong></p><label>Cambio de cantidad inicial ({selectedStock.unit})<input type="number" step="0.001" min={-Number(selectedStock.physical)} value={stockAdjustments[selectedMaterial] ?? 0} onChange={(e) => setStockAdjustments((current) => ({ ...current, [selectedMaterial]: e.target.value }))} /><small>Ejemplo: −5 retira cinco unidades; +5 añade cinco al escenario.</small></label></div>}
        </section>
      </div>
      {(Object.keys(deliveries).length > 0 || Object.keys(stockAdjustments).length > 0) && <div className="supply-changes"><strong>Cambios del escenario</strong>{Object.entries(deliveries).map(([id, change]) => { const row = purchases.find((item) => item.id === id); return row && <span key={id}>{reference(row)} · {row.material_code}: {change.missed ? 'no ingresa' : `${date(change.date || row.expected_date)} + ${change.delayDays || 0} días · ${change.percent ?? 100}%`} <button type="button" aria-label={`Quitar cambio ${reference(row)}`} onClick={() => setDeliveries((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))}>×</button></span>; })}{Object.entries(stockAdjustments).map(([code, quantity]) => <span key={code}>{code}: {Number(quantity) > 0 ? '+' : ''}{quantity || 0} en stock inicial</span>)}</div>}
      <div className="section-actions"><button className="planning-primary" disabled={!dataReady} onClick={simulate}>Comparar escenario</button><button className="text-button" onClick={reset}>Restablecer cambios</button></div>
      {error && <p role="alert">{error}</p>}{stale && <p role="status" className="form-info">Hay cambios sin calcular. Pulsa «Comparar escenario» para actualizar los resultados.</p>}
    </section>
    {result ? <>
      <section className="supply-metrics" aria-label="Comparación de abastecimiento">{[
        ['CECO con faltantes sin cubrir', (value) => value.cecos.filter((row) => row.missing > 0).length],
        ['CECO con material tardío', (value) => value.cecos.filter((row) => row.late > 0).length],
        ['Materiales bajo stock de seguridad al cierre', (value) => value.inventory.filter((row) => row.replenish > 0).length]
      ].map(([title, metric]) => <article className="panel" key={title}><span>{title}</span><div>Base <strong>{metric(run.baseline)}</strong><span>→</span> Escenario <strong>{metric(result)}</strong></div></article>)}</section>
      <section className="panel supply-results"><h2>Resultado: {date(result.startDate)} al {date(result.endDate)}</h2><p>Base = stock actual y OC con fecha vigente. Escenario = la misma base más tus cambios. Una solicitud sin fecha no aporta existencias.</p>
        <div className="purchase-filters">{[['cecos','Materiales por CECO'],['inventory','Inventario general'],['purchases','Pedidos e ingresos']].map(([key,title]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{title}</button>)}</div>
        {tab !== 'purchases' && <label className="supply-check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Mostrar solo faltantes o retrasos</label>}
        {tab === 'cecos' && <>
          <div className="supply-cecos">{result.cecos.filter((row) => !ceco || row.ceco === ceco).map((row) => <article key={row.ceco}><strong>CECO {row.ceco} · {row.product}</strong><p>{row.materials} materiales · {row.missing} sin cobertura · {row.late} tardíos</p><small>Materiales completos: {row.readyDate ? date(row.readyDate) : 'sin fecha calculable'}. Esta fecha no es la terminación del producto.</small></article>)}</div>
          <div className="table-scroll procurement-table-frame"><table><thead><tr><th>CECO / producto</th><th>Material</th><th>Pendiente de usar</th><th>Necesario desde</th><th>Disponible a tiempo</th><th>Falta en esa fecha</th><th>Cobertura completa</th><th>Resultado</th><th>Pedido asociado</th></tr></thead><tbody>{cecoRows.map((row) => <tr key={`${row.ceco}-${row.code}`}><td><strong>{row.ceco}</strong><small>{row.product}</small></td><td><strong>{row.code}</strong><small>{row.description}</small></td><td>{number(row.quantity)} {row.unit}</td><td>{date(row.needed)}{row.originalNeeded && row.originalNeeded < result.startDate && <small>PMP original: {date(row.originalNeeded)}</small>}</td><td>{number(row.onTime)} {row.unit}</td><td>{number(row.missingOnDate)} {row.unit}</td><td>{row.coverageDate ? date(row.coverageDate) : `Faltan ${number(row.missing)} ${row.unit}`}</td><td>{row.state}{row.delayDays > 0 && <small>{row.delayDays} días después de la necesidad</small>}{row.missingInHorizon > 0 && <small>{number(row.missingInHorizon)} {row.unit} sin cubrir al cierre</small>}</td><td>{row.purchases.map((purchase) => <small key={purchase.id}>{reference(purchase)} · {purchase.outcome}</small>)}{!row.purchases.length && 'Sin pedido pendiente'}</td></tr>)}</tbody></table></div>{!cecoRows.length && <p>No hay necesidades de CECO para estos filtros y horizonte.</p>}
        </>}
        {tab === 'inventory' && <><p>Saldo al cierre = físico inicial − otros compromisos + ingresos del horizonte − necesidades CECO. Reposición = lo que falta para conservar el stock de seguridad. Esta vista incluye todos los materiales, sin filtrar por CECO.</p><div className="table-scroll procurement-table-frame"><table><thead><tr><th>Material</th><th>Físico inicial</th><th>Otros compromisos</th><th>Ingresos</th><th>Necesidad CECO</th><th>Saldo al cierre</th><th>Stock de seguridad</th><th>Reponer para SS</th></tr></thead><tbody>{inventoryRows.map((row) => <tr key={row.code}><td><strong>{row.code}</strong><small>{row.description} · {row.unit}</small></td><td>{number(row.physical)}</td><td>{number(row.externalCommitted)}</td><td>{number(row.receipts)}</td><td>{number(row.required)}</td><td>{number(row.closing)}</td><td>{number(row.safety)}</td><td>{number(row.replenish)}</td></tr>)}</tbody></table></div>{!inventoryRows.length && <p>No hay materiales para este filtro.</p>}</>}
        {tab === 'purchases' && <><div className="table-scroll procurement-table-frame"><table><thead><tr><th>Pedido / material</th><th>CECO</th><th>Estado real</th><th>Saldo pendiente</th><th>Ingreso en escenario</th><th>Fecha simulada</th><th>Resultado</th></tr></thead><tbody>{purchaseRows.map((row) => <tr key={row.id}><td><strong>{reference(row)}</strong><small>{row.material_code} · {dataset.inventory.find((item) => item.code === row.material_code)?.description}</small></td><td>{row.cecos?.join(', ') || 'Inventario'}</td><td>{row.status === 'requested' ? 'Solicitud sin OC' : 'OC emitida'}</td><td>{number(row.remaining)}</td><td>{number(row.quantity)}</td><td>{date(row.arrival)}</td><td>{row.outcome}</td></tr>)}</tbody></table></div>{!purchaseRows.length && <p>No hay pedidos pendientes para este filtro.</p>}</>}
        <details className="supply-method"><summary>Cómo se calcula</summary><p>Se utilizan los materiales pendientes del BOM, descontando entregas o consumos vinculados y fases completadas. Los CECO terminados no generan nuevas necesidades. Se utiliza el inicio PMP como fecha de necesidad; si ya pasó, la necesidad pendiente se evalúa desde el inicio del escenario.</p><p>El stock se distribuye por fecha de necesidad y, en empates, por código CECO. No se modifica la prioridad real. Una entrega asociada a CECO solo se asigna a esos CECO; las reposiciones generales pueden cubrir cualquier necesidad. El stock compartido se utiliza una sola vez.</p><p>Los compromisos que exceden la demanda pendiente total se descuentan aparte. El stock de seguridad se muestra como reserva objetivo y no como consumo. Las OC vencidas sin recepción necesitan una nueva fecha de escenario; las recepciones ya registradas están incluidas en el físico y no se vuelven a sumar.</p></details>
      </section>
    </> : <section className="panel supply-results"><h3>Prueba un caso</h3><p>1. Elige un pedido y su fecha de ingreso. 2. Añade tres días de retraso o marca «No ingresa este pedido». 3. Pulsa «Comparar escenario» y revisa «Materiales por CECO». También puedes simular una pérdida de stock sin seleccionar un pedido.</p></section>}
  </div>;
}
