import React, { useMemo, useState } from "react";
import { buildMaterialPlan } from "../lib/planning.js";
import { toLocalDateTimeInput } from "../lib/dateTime.js";

const number = (value) => Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 3 });
const labels = { requested: "Solicitud pendiente", ordered: "Orden de compra", received: "Recibida", cancelled: "Cancelada" };

function ReceiptCheck({ item, today, onSave, onError }) {
  const confirmed = item.historical ? Boolean(item.received_on) : item.status === "received";
  const [checked, setChecked] = useState(confirmed);
  const [date, setDate] = useState(item.received_on || item.receipt_at?.slice(0, 10) || today);
  const [busy, setBusy] = useState(false);
  const editable = item.historical || !confirmed;
  const changed = checked !== confirmed || (checked && date !== (item.received_on || item.receipt_at?.slice(0, 10)));

  async function confirm() {
    if (checked && (!date || date > today || (!item.historical && date < item.order_date))) {
      onError("Indica la fecha real de llegada entre la emisión de la OC y hoy.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      if (item.historical) await onSave("historicalReceipt", { id: item.id, received_on: checked ? date : null });
      else if (checked) await onSave("receive", {
        id: item.id,
        quantity: Number(item.quantity) - Number(item.received_quantity || 0),
        receipt_at: `${date}T12:00`,
        receipt_reference: "Confirmación de llegada en la aplicación"
      });
    } catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }

  return <div className="receipt-check">
    <label><input type="checkbox" checked={checked} disabled={!editable || busy} onChange={(event) => setChecked(event.target.checked)} /> Llegó</label>
    {checked && <input type="date" aria-label={`Fecha real de recepción de ${item.material_code} CECO ${item.cecos?.join(", ")}`} value={date} max={today} min={item.historical ? undefined : item.order_date} disabled={!editable || busy} onChange={(event) => setDate(event.target.value)} />}
    {editable && changed && <button className="row-action" disabled={busy} onClick={confirm}>{busy ? "Guardando…" : "Guardar"}</button>}
  </div>;
}

export default function PurchaseWorkflow({ dataset, onMaterial, onSave }) {
  const today = toLocalDateTimeInput(new Date().toISOString()).slice(0, 10);
  const plan = useMemo(() => buildMaterialPlan(dataset, today), [dataset, today]);
  const openCecos = (dataset.orders || []).filter((order) => order.active !== false && Number(order.progress) < 100).map((order) => order.ceco);
  const openCecoSet = new Set(openCecos);
  const requests = (dataset.purchaseRequests || []).filter((item) => ["received", "cancelled"].includes(item.status) || item.cecos?.some((ceco) => openCecoSet.has(ceco)));
  const historical = dataset.historicalPurchases || [];
  const [historyCeco, setHistoryCeco] = useState("");
  const [tab, setTab] = useState("suggestions");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const materials = new Map(dataset.inventory.map((item) => [item.code, item]));
  const matches = (code) => `${code} ${materials.get(code)?.description || ""}`.toLowerCase().includes(query.toLowerCase());
  const suggestions = plan.purchases.filter((item) => item.cecos.some((ceco) => openCecoSet.has(ceco)) && matches(item.code));
  const historicalRows = historical.filter((item) => (!historyCeco || item.ceco === historyCeco) && matches(item.material_code)).sort((a,b) => a.ceco.localeCompare(b.ceco) || a.material_code.localeCompare(b.material_code));
  const historicalOrders = historical.map((item) => ({ id: item.id, historical: true, material_code: item.material_code, cecos: [item.ceco], quantity: item.purchased_quantity ?? item.bom_quantity, received_quantity: item.received_on ? (item.purchased_quantity ?? item.bom_quantity) : 0, received_on: item.received_on, status: item.received_on ? "received" : "ordered", order_number: `Histórica · CECO ${item.ceco}`, order_date: item.purchase_date, needed_date: item.purchase_date, supplier: item.supplier, receipt_reference: item.document_number }));
  const rows = [...requests.filter((item) => (tab === "history" ? item.status === "cancelled" : tab === "ordered" ? ["ordered", "received"].includes(item.status) : item.status === tab) && matches(item.material_code)), ...(tab === "ordered" ? historicalOrders.filter((item) => matches(item.material_code)) : [])].sort((a,b) => Number(b.request_number || 0)-Number(a.request_number || 0));
  function edit(mode, row) { setError(""); setForm({ mode, ...(mode === "create" ? { id: crypto.randomUUID() } : {}), ...row }); }
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const cecos = form.mode === "create" ? new FormData(event.currentTarget).getAll("cecos") : form.cecos;
      if (form.mode === "create" && !cecos.length) throw new Error("Selecciona al menos un CECO abierto");
      await onSave(form.mode, { ...form, ...values, cecos });
      setTab(form.mode === "create" || form.mode === "edit" ? "requested" : form.mode === "order" || Number(values.quantity) < Number(form.quantity) - Number(form.received_quantity || 0) ? "ordered" : "history");
      setForm(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function cancel(row) {
    setBusy(true); setError("");
    try { await onSave("cancel", { id: row.id }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="planning-workspace">
    <header className="planning-heading"><div><span className="eyebrow">Abastecimiento</span><h2>Solicitudes y compras</h2><p>Necesidad MRP → solicitud de material → orden de compra → recepción en almacén.</p></div><button className="planning-primary" onClick={() => edit("create", { material_code: "", quantity: "", needed_date: today, cecos: [] })}>Nueva solicitud</button></header>
    <div className="purchase-filters" aria-label="Etapas de abastecimiento">{[["suggestions", `Sugerencias (${suggestions.length})`], ["requested", `Solicitudes (${requests.filter((r) => r.status === "requested").length})`], ["ordered", `Órdenes de compra (${requests.filter((r) => ["ordered", "received"].includes(r.status)).length + historicalOrders.length})`], ["history", "Historial"]].map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
    <input type="search" aria-label="Buscar en compras" placeholder="Buscar código o material" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className="form-info">{error}</p>}
    {form && <section className="panel procurement-form"><h3>{form.mode === "create" ? "Crear solicitud de material" : form.mode === "edit" ? "Editar solicitud" : "Registrar orden de compra"}</h3><form onSubmit={save}>
      {["create", "edit"].includes(form.mode) ? <>
        <label>Material<select name="material_code" defaultValue={form.material_code} disabled={form.mode === "edit"} required><option value="">Selecciona un material</option>{dataset.inventory.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select></label>
        {form.mode === "create" && <fieldset><legend>CECOs abiertos</legend>{openCecos.map((ceco) => <label key={ceco}><input type="checkbox" name="cecos" value={ceco} defaultChecked={form.cecos?.includes(ceco)} /> {ceco}</label>)}</fieldset>}
        <div className="form-row"><label>Cantidad solicitada<input name="quantity" type="number" min="0.001" step="0.001" defaultValue={form.quantity} required /></label><label>Fecha de necesidad<input name="needed_date" type="date" defaultValue={form.needed_date || today} required /></label></div>
        <label>Detalle de la solicitud<textarea name="note" defaultValue={form.note || ""} /></label>
      </> : <><p><strong>{form.material_code}</strong> · {materials.get(form.material_code)?.description} · Solicitud {form.request_number}</p>
          <div className="form-row"><label>Número de orden de compra<input name="order_number" required /></label><label>Proveedor<input name="supplier" required /></label></div>
          <div className="form-row"><label>Fecha de emisión<input name="order_date" type="date" min={form.requested_date} defaultValue={today} required /></label><label>Fecha prevista de recepción<input name="expected_date" type="date" min={today} required /></label></div>
          <label>Precio unitario acordado (S/)<input name="unit_cost" type="number" min="0" step="0.01" required /></label><p>{number(form.quantity)} {materials.get(form.material_code)?.unit} solicitados. El stock aumenta al registrar la recepción.</p>
      </>}
      <div className="section-actions"><button className="planning-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button><button type="button" className="text-button" disabled={busy} onClick={() => setForm(null)}>Cerrar</button></div>
    </form></section>}
    {(tab !== "history" || rows.length > 0) && <section className="panel"><div className="table-scroll procurement-table-frame"><table className="planning-table purchase-table"><thead>{tab === "suggestions" ? <tr><th>Material</th><th>Cantidad pendiente de solicitar</th><th>CECO</th><th>Fecha de necesidad</th><th>Acción</th></tr> : <tr><th>Solicitud</th><th>Material / CECO</th><th>Solicitado</th><th>Recibido</th><th>Pendiente</th><th>Estado</th><th>Orden / proveedor</th><th>Fechas</th><th>Acciones</th></tr>}</thead><tbody>
      {tab === "suggestions" ? suggestions.map((item) => <tr key={`${item.code}-${item.needed}`}><td><button className="row-action" onClick={() => onMaterial(item.code)}>{item.code}</button><small>{item.material.description}</small></td><td>{number(item.quantity)} {item.unit}</td><td>{item.cecos.join(" · ")}</td><td>{item.needed}</td><td><button className="row-action" onClick={() => edit("create", { material_code: item.code, quantity: item.quantity, needed_date: item.needed, cecos: item.cecos, note: "Necesidad calculada por MRP" })}>Crear solicitud</button></td></tr>) : rows.map((item) => <tr key={item.id}><td>{item.historical ? "Histórica" : `SC-${String(item.request_number).padStart(5,"0")}`}</td><td><button className="row-action" onClick={() => onMaterial(item.material_code)}>{item.material_code}</button><small>{materials.get(item.material_code)?.description}</small><small>{item.cecos?.join(" · ") || "Stock de seguridad"}</small></td><td>{number(item.quantity)}</td><td>{number(item.received_quantity)}</td><td>{number(Number(item.quantity)-Number(item.received_quantity))}</td><td>{item.status === "received" ? "Recibida" : item.historical ? "Por confirmar" : labels[item.status]}</td><td>{item.order_number || "—"}<small>{item.supplier}</small><small>{item.unit_cost != null && `S/ ${number(item.unit_cost)} por unidad`}</small></td><td>{item.historical ? `Compra estimada: ${item.order_date || "sin fecha"}` : `Solicitud: ${item.requested_date}`}<small>{!item.historical && `Necesidad: ${item.needed_date || "—"}`}</small><small>{!item.historical && item.order_date && `OC: ${item.order_date}`}</small><small>{!item.historical && item.expected_date && `Prevista: ${item.expected_date}`}</small><small>{item.historical && item.received_on && `Llegada real: ${item.received_on}`}</small><small>{!item.historical && item.receipt_at && `Última recepción: ${toLocalDateTimeInput(item.receipt_at).replace("T", " ")}`}</small><small>{item.receipt_reference}</small></td><td><div className="procurement-actions">{tab === "ordered" && <ReceiptCheck item={item} today={today} onSave={onSave} onError={setError} />}{!item.historical && item.status === "ordered" && <button className="row-action" disabled={busy} onClick={() => cancel(item)}>Cancelar saldo</button>}</div></td></tr>)}
    </tbody></table></div>{(tab === "suggestions" ? suggestions : rows).length === 0 && <p className="planning-empty">{tab === "suggestions" ? "No hay necesidades nuevas por solicitar. Revisa las solicitudes y órdenes pendientes en sus pestañas." : "No hay registros para este filtro."}</p>}</section>}
    {tab === "history" && <section className="panel">
      <header className="section-header"><div><span className="eyebrow">CECO completados</span><h2>Compras históricas reconstruidas</h2><p>Cantidades estimadas desde el BOM y fechas de compra estimadas desde el cronograma. Confirma la llegada y su fecha real en Órdenes de compra. Estos registros no duplican el stock actual.</p></div></header>
      <div className="coverage-controls"><label>CECO<select aria-label="Filtrar compras históricas por CECO" value={historyCeco} onChange={(event) => setHistoryCeco(event.target.value)}><option value="">Todos los CECO completados</option>{[...new Set(historical.map((item) => item.ceco))].sort().map((ceco) => <option key={ceco} value={ceco}>{ceco}</option>)}</select></label><span>{historicalRows.length} registros de materiales</span></div>
      <div className="table-scroll procurement-table-frame"><table className="planning-table purchase-table"><thead><tr><th>CECO / producto</th><th>Material</th><th>Cantidad de referencia (BOM)</th><th>Cantidad de compra estimada</th><th>Estado</th><th>Fecha de compra estimada</th><th>Proveedor / comprobante</th></tr></thead><tbody>{historicalRows.map((item) => {
        const order = dataset.orders.find((order) => order.ceco === item.ceco);
        const product = dataset.bodyTypes.find((product) => product.id === order?.bodyTypeId);
        const material = materials.get(item.material_code);
        return <tr key={item.id}><td><strong>CECO {item.ceco}</strong><small>{product?.name}</small></td><td><button className="row-action" onClick={() => onMaterial(item.material_code)}>{item.material_code}</button><small>{material?.description}</small></td><td>{number(item.bom_quantity)} {material?.unit}</td><td>{item.purchased_quantity == null ? "Sin documentar" : `${number(item.purchased_quantity)} ${material?.unit} · estimada`}</td><td>{item.received_on ? "Recibida" : "Por confirmar"}</td><td>{item.purchase_date ? `${item.purchase_date} · estimada` : "Sin documentar"}<small>{item.received_on && `Llegada real: ${item.received_on}`}</small></td><td>{item.supplier || "Sin documentar"}<small>{item.document_number || "Sin comprobante registrado"}</small></td></tr>;
      })}</tbody></table></div>{historicalRows.length === 0 && <p className="planning-empty">No hay compras históricas para este filtro.</p>}
    </section>}
  </div>;
}
