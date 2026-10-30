import React, { useEffect, useState } from 'react';
import { compareSupply, pendingPurchases } from '../lib/supplySimulation.js';
import { scenarioRecord, reuseScenario, changeSelectedDeliveries, reduceSelectedStock } from '../lib/supplyScenarios.js';
import { toLocalDateTimeInput } from '../lib/dateTime.js';

const number = (value) => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });
const date = (value) => value ? new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Sin fecha';
const stamp = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const reference = (row) => `${row.order_number ? `OC ${row.order_number} · ` : ''}SC-${String(row.request_number).padStart(5, '0')}`;
const today = () => toLocalDateTimeInput(new Date().toISOString()).slice(0, 10);
const remove = (object, key) => Object.fromEntries(Object.entries(object).filter(([id]) => id !== key));

export default function SupplySimulator({ dataset, dataReady, repository }) {
  const [startDate, setStartDate] = useState(today);
  const [horizonDays, setHorizonDays] = useState(30);
  const [name, setName] = useState('');
  const [deliveries, setDeliveries] = useState({});
  const [stockAdjustments, setStockAdjustments] = useState({});
  const [query, setQuery] = useState('');
  const [ceco, setCeco] = useState('');
  const [editor, setEditor] = useState('purchases');
  const [page, setPage] = useState('configure');
  const [tab, setTab] = useState('cecos');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [batch, setBatch] = useState({ date: '', delayDays: '', percent: '' });
  const [loss, setLoss] = useState('');
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let live = true;
    repository.listSupplyScenarios().then((rows) => { if (live) setHistory(rows); }).catch((err) => { if (live) setHistoryError(err.message); }).finally(() => { if (live) setLoadingHistory(false); });
    return () => { live = false; };
  }, [repository]);
  const purchases = pendingPurchases(dataset);
  const materials = new Map(dataset.inventory.map((row) => [row.code, row]));
  const matches = (row, inventory = materials) => `${row.code || row.material_code} ${row.description || inventory.get(row.material_code)?.description || ''} ${row.request_number != null ? reference(row) : ''}`.toLowerCase().includes(query.toLowerCase());
  const activeOrders = dataset.orders.filter((row) => row.active !== false && Number(row.progress) < 100);
  const visiblePurchases = purchases.filter((row) => matches(row) && (!ceco || row.cecos?.includes(ceco)));
  const cecoMaterialCodes = new Set(dataset.bom.filter((row) => row.bodyTypeId === activeOrders.find((order) => order.ceco === ceco)?.bodyTypeId).map((row) => row.materialCode));
  const visibleMaterials = dataset.inventory.filter((row) => matches(row) && (!ceco || cecoMaterialCodes.has(row.code)));
  const options = { startDate, horizonDays, deliveries, stockAdjustments };
  const signature = JSON.stringify(options);
  const stale = run && !run.historical && (signature !== run.signature || dataset !== run.dataset);
  const selectedIds = Object.keys(deliveries);
  const selectedCodes = Object.keys(stockAdjustments);
  const selectedVisible = editor === 'purchases' ? visiblePurchases.map((row) => row.id) : visibleMaterials.map((row) => row.code);
  const allSelected = selectedVisible.length > 0 && selectedVisible.every((id) => editor === 'purchases' ? Object.hasOwn(deliveries, id) : Object.hasOwn(stockAdjustments, id));
  function selectVisible() {
    if (editor === 'purchases') setDeliveries((current) => allSelected ? Object.fromEntries(Object.entries(current).filter(([id]) => !selectedVisible.includes(id))) : { ...current, ...Object.fromEntries(selectedVisible.map((id) => [id, current[id] || {}])) });
    else setStockAdjustments((current) => allSelected ? Object.fromEntries(Object.entries(current).filter(([id]) => !selectedVisible.includes(id))) : { ...current, ...Object.fromEntries(selectedVisible.map((id) => [id, current[id] ?? 0])) });
  }
  function editDelivery(id, key, value) { setDeliveries((current) => ({ ...current, [id]: { ...current[id], [key]: value, missed: false } })); }
  function applyBatch() {
    try {
      if (editor === 'purchases') {
        if (!Object.values(batch).some((value) => value !== '')) throw new Error('Indica el cambio que quieres aplicar.');
        setDeliveries((current) => changeSelectedDeliveries(current, selectedIds, batch));
      } else setStockAdjustments((current) => reduceSelectedStock(current, dataset.inventory.filter((row) => selectedCodes.includes(row.code)), loss));
      setError('');
    } catch (err) { setError(err.message); }
  }
  async function saveResult(value) {
    const saved = await repository.saveSupplyScenario(scenarioRecord(value.name, value));
    setHistory((current) => [saved, ...current].slice(0, 20));
    setRun({ ...value, savedAt: saved.created_at, savedId: saved.id });
    setHistoryError('');
    return saved;
  }
  async function simulate() {
    if (busy) return;
    setError(''); setNotice('');
    let value;
    try {
      for (const row of purchases.filter((item) => selectedIds.includes(item.id))) {
        const change = deliveries[row.id];
        if (Number(change.percent ?? 100) > 0 && !change.missed && !(change.date || (row.status === 'ordered' && row.expected_date))) throw new Error(`${reference(row)}: indica la fecha de llegada o usa 0% si no ingresa.`);
      }
      value = { ...compareSupply(dataset, options), options: structuredClone(options), signature, dataset,
        name: name.trim() || `Escenario ${stamp(new Date().toISOString())}` };
      setRun(value); setPage('results'); setQuery(''); setOnlyIssues(false);
    } catch (err) { setError(err.message); return; }
    setBusy(true);
    try { await saveResult(value); } catch (err) { setError(`El resultado se calculó, pero no se guardó: ${err.message}`); }
    finally { setBusy(false); }
  }
  async function openSaved(id, reuse = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await repository.getSupplyScenario(id);
      if (reuse) loadAdjustments(saved);
      else {
        setRun({ ...saved.results, options: saved.parameters, name: saved.name, historical: true, savedAt: saved.created_at, savedId: saved.id });
        setPage('results'); setQuery(''); setCeco(''); setOnlyIssues(false);
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function loadAdjustments(saved) {
    const loaded = reuseScenario(saved, dataset, today());
    setStartDate(loaded.options.startDate); setHorizonDays(loaded.options.horizonDays); setDeliveries(loaded.options.deliveries); setStockAdjustments(loaded.options.stockAdjustments);
    setName(`Copia de ${saved.name}`.slice(0, 100)); setRun(null); setPage('configure'); setQuery(''); setCeco('');
    setNotice(`Ajustes cargados para hoy.${loaded.omitted ? ` ${loaded.omitted} registros ya no están disponibles y se omitieron.` : ''} Pulsa «Simular y guardar» para obtener un nuevo resultado.`);
  }
  function newScenario() { setStartDate(today()); setHorizonDays(30); setDeliveries({}); setStockAdjustments({}); setName(''); setRun(null); setPage('configure'); setQuery(''); setCeco(''); setBatch({ date: '', delayDays: '', percent: '' }); setLoss(''); setError(''); setNotice(''); }
  const result = run?.scenario;
  const resultMaterials = new Map((result?.inventory || []).map((row) => [row.code, row]));
  const cecoRows = result?.cecoMaterials.filter((row) => (!ceco || row.ceco === ceco) && matches(row, resultMaterials) && (!onlyIssues || row.state !== 'A tiempo')) || [];
  const inventoryRows = result?.inventory.filter((row) => matches(row, resultMaterials) && (!onlyIssues || row.replenish > 0 || row.missingOnDate > 0)) || [];
  const purchaseRows = result?.purchases.filter((row) => matches(row, resultMaterials) && (!ceco || row.cecos?.includes(ceco))) || [];
  return <div className="supply-simulator stack-lg">
    <section className="panel supply-config">
      <div className="planning-heading"><div><span className="eyebrow">Simulación</span><h2>Materiales y pedidos</h2><p>Prueba cambios sin modificar tus registros reales.</p></div><button className="text-button" onClick={newScenario} disabled={busy}>Nuevo escenario</button></div>
      <div className="purchase-filters">{[['configure', 'Ajustar escenario'], ['results', 'Resultados'], ['history', 'Escenarios guardados']].map(([key, label]) => <button key={key} disabled={busy || (key === 'results' && !run)} className={page === key ? 'active' : ''} onClick={() => { setPage(key); setQuery(''); setCeco(''); }}>{label}</button>)}</div>
      {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {page === 'configure' && <>
        <div className="supply-controls"><label>Nombre del escenario<input maxLength="100" value={name} placeholder="Ej. Retraso de materiales" onChange={(e) => setName(e.target.value)} /></label><label>Periodo<select value={horizonDays} onChange={(e) => setHorizonDays(Number(e.target.value))}>{[7,14,30,60,90].map((days) => <option key={days} value={days}>{days} días desde hoy</option>)}</select></label></div>
        <div className="purchase-filters"><button className={editor === 'purchases' ? 'active' : ''} onClick={() => setEditor('purchases')}>Pedidos ({selectedIds.length})</button><button className={editor === 'inventory' ? 'active' : ''} onClick={() => setEditor('inventory')}>Inventario ({selectedCodes.length})</button></div>
        <div className="supply-controls"><label>Buscar<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Material o pedido" /></label><label>CECO<select value={ceco} onChange={(e) => setCeco(e.target.value)}><option value="">Todos</option>{activeOrders.map((row) => <option key={row.ceco} value={row.ceco}>{row.ceco} · {dataset.bodyTypes.find((product) => product.id === row.bodyTypeId)?.name}</option>)}</select></label></div>
        <div className="supply-batch"><strong>Aplicar a {editor === 'purchases' ? selectedIds.length : selectedCodes.length} seleccionados</strong>
          {editor === 'purchases' ? <><label>Llegada<input type="date" aria-label="Llegada para seleccionados" min={startDate} value={batch.date} onChange={(e) => setBatch({ ...batch, date: e.target.value })} /></label><label>Retraso (días)<input type="number" min="0" step="1" aria-label="Retraso para seleccionados" value={batch.delayDays} onChange={(e) => setBatch({ ...batch, delayDays: e.target.value })} /></label><label>Llega (%)<input type="number" min="0" max="100" aria-label="Porcentaje para seleccionados" value={batch.percent} onChange={(e) => setBatch({ ...batch, percent: e.target.value })} /></label></> : <label>Reducir stock (%)<input type="number" min="0" max="100" value={loss} onChange={(e) => setLoss(e.target.value)} /></label>}
          <button className="planning-primary" disabled={!(editor === 'purchases' ? selectedIds.length : selectedCodes.length)} onClick={applyBatch}>Aplicar</button>
        </div>
        <p className="supply-hint">{editor === 'purchases' ? 'Selecciona pedidos y edita sus filas. Llega: 100% = todo · 50% = mitad · 0% = no ingresa.' : 'Selecciona materiales y cambia la cantidad: −5 resta cinco; +5 añade cinco, en la unidad de cada material.'}</p>
        <div className="table-scroll supply-edit-list"><table><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos los visibles" checked={allSelected} disabled={!selectedVisible.length} onChange={selectVisible} /></th>{editor === 'purchases' ? <><th>Pedido / material</th><th>CECO · pendiente</th><th>Llegada</th><th>Retraso (días)</th><th>Llega (%)</th></> : <><th>Material</th><th>Stock actual</th><th>Cambio de cantidad</th></>}</tr></thead><tbody>
          {editor === 'purchases' ? visiblePurchases.map((row) => { const selected = Object.hasOwn(deliveries, row.id); const change = deliveries[row.id] || {}; return <tr className={selected ? 'selected' : ''} key={row.id}><td><input type="checkbox" aria-label={`Seleccionar ${reference(row)}`} checked={selected} onChange={() => setDeliveries((current) => selected ? remove(current, row.id) : { ...current, [row.id]: {} })} /></td><td><strong>{reference(row)} · {row.material_code}</strong><small>{materials.get(row.material_code)?.description}</small></td><td>{row.cecos?.join(', ') || 'Inventario'}<small>{number(Number(row.quantity) - Number(row.received_quantity || 0))} {materials.get(row.material_code)?.unit}</small></td><td><input type="date" aria-label={`Llegada ${reference(row)}`} min={startDate} disabled={!selected} value={change.date ?? row.expected_date ?? ''} onChange={(e) => editDelivery(row.id, 'date', e.target.value)} />{!row.expected_date && !change.date && <small>Sin fecha</small>}</td><td><input type="number" aria-label={`Retraso ${reference(row)}`} min="0" step="1" disabled={!selected} value={change.delayDays ?? 0} onChange={(e) => editDelivery(row.id, 'delayDays', e.target.value)} /></td><td><input type="number" aria-label={`Porcentaje ${reference(row)}`} min="0" max="100" disabled={!selected} value={change.missed ? 0 : change.percent ?? 100} onChange={(e) => editDelivery(row.id, 'percent', e.target.value)} /></td></tr>; }) : visibleMaterials.map((row) => { const selected = Object.hasOwn(stockAdjustments, row.code); return <tr className={selected ? 'selected' : ''} key={row.code}><td><input type="checkbox" aria-label={`Seleccionar ${row.code}`} checked={selected} onChange={() => setStockAdjustments((current) => selected ? remove(current, row.code) : { ...current, [row.code]: 0 })} /></td><td><strong>{row.code}</strong><small>{row.description}</small></td><td>{number(row.physical)} {row.unit}</td><td><input type="number" aria-label={`Cambio ${row.code}`} step="0.001" min={-Number(row.physical)} disabled={!selected} value={stockAdjustments[row.code] ?? 0} onChange={(e) => setStockAdjustments((current) => ({ ...current, [row.code]: e.target.value }))} /></td></tr>; })}
        </tbody></table></div>{!selectedVisible.length && <p>No hay registros para este filtro.</p>}
        <div className="section-actions supply-run"><button className="planning-primary" disabled={!dataReady || busy} onClick={simulate}>{busy ? 'Guardando…' : 'Simular y guardar'}</button><button className="text-button" onClick={() => { setDeliveries({}); setStockAdjustments({}); }} disabled={busy}>Quitar ajustes</button></div>
      </>}
      {page === 'history' && <div className="supply-history"><h3>Últimos 20 escenarios</h3>{loadingHistory ? <p>Cargando…</p> : historyError ? <p role="alert">No se pudo cargar el historial: {historyError}</p> : !history.length ? <p>Tus escenarios aparecerán aquí después de simular.</p> : history.map((row) => <article key={row.id}><div><strong>{row.name}</strong><small>{stamp(row.created_at)} · {row.parameters.horizonDays} días</small></div><button className="text-button" disabled={busy} onClick={() => openSaved(row.id)}>Ver resultados</button><button className="planning-primary" disabled={busy} onClick={() => openSaved(row.id, true)}>Usar ajustes</button></article>)}</div>}
    </section>
    {page === 'results' && result && <>
      <section className="panel supply-results"><div className="planning-heading"><div><h2>{run.name}</h2><p>{date(result.startDate)} al {date(result.endDate)}{run.savedAt ? ` · Guardado ${stamp(run.savedAt)}` : ' · Sin guardar'}</p></div><button className="text-button" onClick={() => loadAdjustments({ name: run.name, parameters: { ...run.options, kind: 'material_supply_v1' } })}>Usar estos ajustes</button></div>
        {stale && <p role="status">Los ajustes cambiaron. Vuelve a simular para actualizar este resultado.</p>}
        {!run.savedAt && !busy && <button className="planning-primary" onClick={async () => { setBusy(true); try { await saveResult(run); setError(''); } catch (err) { setError(err.message); } finally { setBusy(false); } }}>Guardar resultado</button>}
        {run.historical && <p>Resultado guardado. «Usar estos ajustes» permite calcularlo de nuevo con los datos de hoy.</p>}
        <div className="supply-metrics" aria-label="Comparación de abastecimiento">{[
          ['CECO con faltantes', (value) => value.cecos.filter((row) => row.missing > 0).length],
          ['CECO con retraso de material', (value) => value.cecos.filter((row) => row.late > 0).length],
          ['Materiales por reponer', (value) => value.inventory.filter((row) => row.replenish > 0).length]
        ].map(([title, metric]) => <article className="panel" key={title}><span>{title}</span><div>Base <strong>{metric(run.baseline)}</strong> → Escenario <strong>{metric(result)}</strong></div></article>)}</div>
        <div className="purchase-filters">{[['cecos','Por CECO'],['inventory','Inventario'],['purchases','Pedidos']].map(([key,title]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{title}</button>)}</div>
        <div className="supply-controls"><label>Buscar resultado<input type="search" placeholder="Material o pedido" value={query} onChange={(e) => setQuery(e.target.value)} /></label>{tab !== 'inventory' && <label>CECO del resultado<select value={ceco} onChange={(e) => setCeco(e.target.value)}><option value="">Todos</option>{result.cecos.map((row) => <option key={row.ceco} value={row.ceco}>{row.ceco} · {row.product}</option>)}</select></label>}</div>
        {tab !== 'purchases' && <label className="supply-check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Solo faltantes o retrasos</label>}
        {tab === 'cecos' && <><div className="supply-cecos">{result.cecos.filter((row) => !ceco || row.ceco === ceco).map((row) => <article key={row.ceco}><strong>{row.ceco} · {row.product}</strong><p>{row.missing} materiales sin cubrir · {row.late} tardíos</p><small>Materiales completos: {row.readyDate ? date(row.readyDate) : 'sin fecha'}</small></article>)}</div>
          <div className="table-scroll procurement-table-frame"><table><thead><tr><th>CECO / material</th><th>Necesita</th><th>Falta a tiempo</th><th>Material completo</th><th>Resultado</th></tr></thead><tbody>{cecoRows.map((row) => <tr key={`${row.ceco}-${row.code}`}><td><strong>{row.ceco} · {row.code}</strong><small>{row.description}</small></td><td>{number(row.quantity)} {row.unit}<small>{date(row.needed)}</small></td><td>{number(row.missingOnDate)} {row.unit}</td><td>{row.coverageDate ? date(row.coverageDate) : `Faltan ${number(row.missing)} ${row.unit}`}</td><td>{row.state}{row.delayDays > 0 && <small>{row.delayDays} días de retraso</small>}<details><summary>Detalle</summary><small>Disponible a tiempo: {number(row.onTime)} {row.unit}</small>{row.purchases.map((purchase) => <small key={purchase.id}>{reference(purchase)} · {purchase.outcome}</small>)}</details></td></tr>)}</tbody></table></div>{!cecoRows.length && <p>No hay materiales para este filtro.</p>}</>}
        {tab === 'inventory' && <><div className="table-scroll procurement-table-frame"><table><thead><tr><th>Material</th><th>Stock inicial</th><th>Ingresos</th><th>Necesidad CECO</th><th>Saldo final</th><th>SS</th><th>Reponer</th></tr></thead><tbody>{inventoryRows.map((row) => <tr key={row.code}><td><strong>{row.code}</strong><small>{row.description} · {row.unit}</small></td><td>{number(row.physical)}</td><td>{number(row.receipts)}</td><td>{number(row.required)}</td><td>{number(row.closing)}</td><td>{number(row.safety)}</td><td>{number(row.replenish)}</td></tr>)}</tbody></table></div>{!inventoryRows.length && <p>No hay materiales para este filtro.</p>}</>}
        {tab === 'purchases' && <><div className="table-scroll procurement-table-frame"><table><thead><tr><th>Pedido / material</th><th>CECO</th><th>Pendiente</th><th>Llega</th><th>Fecha</th><th>Resultado</th></tr></thead><tbody>{purchaseRows.map((row) => <tr key={row.id}><td><strong>{reference(row)}</strong><small>{row.material_code} · {resultMaterials.get(row.material_code)?.description}</small></td><td>{row.cecos?.join(', ') || 'Inventario'}</td><td>{number(row.remaining)}</td><td>{number(row.quantity)}</td><td>{date(row.arrival)}</td><td>{row.outcome}</td></tr>)}</tbody></table></div>{!purchaseRows.length && <p>No hay pedidos para este filtro.</p>}</>}
        <details className="supply-method"><summary>Cómo leer el resultado</summary><p>Base: registros al calcular. Escenario: los mismos registros con tus ajustes. Una solicitud sin fecha no suma stock; 0% significa que no ingresa. Solo se suma el saldo de compra pendiente, sin repetir recepciones.</p><p>Se consideran materiales pendientes de los CECO abiertos, descontando entregas y fases completadas. El stock se comparte por fecha de necesidad y código CECO, sin duplicarlo. Los pedidos asociados a un CECO cubren sus materiales.</p><p>La necesidad parte del inicio PMP; si ya pasó, se evalúa desde el inicio de la simulación. «Material completo» es la disponibilidad del material, no la terminación del producto. SS es el stock de seguridad. El saldo final descuenta también compromisos ajenos a las necesidades CECO mostradas.</p><p>Al reutilizar, las fechas simuladas se desplazan a hoy conservando su separación original. Los pedidos ya cerrados se omiten. Los resultados guardados conservan sus valores originales.</p></details>
      </section>
    </>}
  </div>;
}
