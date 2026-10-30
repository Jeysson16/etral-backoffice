import React, { useMemo, useState } from "react";
import { buildMaterialPlan } from "../lib/planning.js";
import { toLocalDateTimeInput } from "../lib/dateTime.js";

const number = (value) => Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 3 });
const labels = { requested: "Solicitud pendiente", ordered: "Orden de compra", received: "Recibida", cancelled: "Cancelada" };

export default function PurchaseWorkflow({ dataset, onMaterial, onSave }) {
  const today = toLocalDateTimeInput(new Date().toISOString()).slice(0, 10);
  const plan = useMemo(() => buildMaterialPlan(dataset, today), [dataset, today]);
  const requests = dataset.purchaseRequests || [];
  const [tab, setTab] = useState("suggestions");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const materials = new Map(dataset.inventory.map((item) => [item.code, item]));
  const matches = (code) => `${code} ${materials.get(code)?.description || ""}`.toLowerCase().includes(query.toLowerCase());
  const suggestions = plan.purchases.filter((item) => matches(item.code));
  const rows = requests.filter((item) => (tab === "history" ? ["received", "cancelled"].includes(item.status) : item.status === tab) && matches(item.material_code)).sort((a,b) => Number(b.request_number)-Number(a.request_number));
  function edit(mode, row) { setError(""); setForm({ mode, ...(mode === "create" ? { id: crypto.randomUUID() } : {}), ...row }); }
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      await onSave(form.mode, { ...form, ...values });
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
    <div className="purchase-filters" aria-label="Etapas de abastecimiento">{[["suggestions", `Sugerencias (${plan.purchases.length})`], ["requested", `Solicitudes (${requests.filter((r) => r.status === "requested").length})`], ["ordered", `Órdenes de compra (${requests.filter((r) => r.status === "ordered").length})`], ["history", "Historial"]].map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
    <input type="search" aria-label="Buscar en compras" placeholder="Buscar código o material" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className="form-info">{error}</p>}
    {form && <section className="panel procurement-form"><h3>{form.mode === "create" ? "Crear solicitud de material" : form.mode === "edit" ? "Editar solicitud" : form.mode === "order" ? "Registrar orden de compra" : "Registrar recepción"}</h3><form onSubmit={save}>
      {["create", "edit"].includes(form.mode) ? <>
        <label>Material<select name="material_code" defaultValue={form.material_code} disabled={form.mode === "edit"} required><option value="">Selecciona un material</option>{dataset.inventory.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select></label>
        <div className="form-row"><label>Cantidad solicitada<input name="quantity" type="number" min="0.001" step="0.001" defaultValue={form.quantity} required /></label><label>Fecha de necesidad<input name="needed_date" type="date" defaultValue={form.needed_date || today} required /></label></div>
        <label>Detalle de la solicitud<textarea name="note" defaultValue={form.note || ""} /></label>
      </> : <><p><strong>{form.material_code}</strong> · {materials.get(form.material_code)?.description} · Solicitud {form.request_number}</p>
        {form.mode === "order" ? <>
          <div className="form-row"><label>Número de orden de compra<input name="order_number" required /></label><label>Proveedor<input name="supplier" required /></label></div>
          <div className="form-row"><label>Fecha de emisión<input name="order_date" type="date" min={form.requested_date} defaultValue={today} required /></label><label>Fecha prevista de recepción<input name="expected_date" type="date" min={today} required /></label></div>
          <label>Precio unitario acordado (S/)<input name="unit_cost" type="number" min="0" step="0.01" required /></label><p>{number(form.quantity)} {materials.get(form.material_code)?.unit} solicitados. El stock aumenta al registrar la recepción.</p>
        </> : <>
          <div className="form-row"><label>Cantidad recibida<input name="quantity" type="number" min="0.001" max={Number(form.quantity)-Number(form.received_quantity)} step="0.001" defaultValue={Number(form.quantity)-Number(form.received_quantity)} required /></label><label>Fecha y hora de recepción<input name="receipt_at" type="datetime-local" defaultValue={toLocalDateTimeInput(new Date().toISOString())} required /></label></div>
          <label>Guía o documento de recepción<input name="receipt_reference" required /></label><p>Al guardar se registra el ingreso en Kardex y se actualiza el saldo pendiente de esta orden.</p>
        </>}
      </>}
      <div className="section-actions"><button className="planning-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button><button type="button" className="text-button" disabled={busy} onClick={() => setForm(null)}>Cerrar</button></div>
    </form></section>}
    <section className="panel"><div className="table-scroll"><table className="planning-table purchase-table"><thead>{tab === "suggestions" ? <tr><th>Material</th><th>Cantidad pendiente de solicitar</th><th>CECO</th><th>Fecha de necesidad</th><th>Acción</th></tr> : <tr><th>Solicitud</th><th>Material / CECO</th><th>Solicitado</th><th>Recibido</th><th>Pendiente</th><th>Estado</th><th>Orden / proveedor</th><th>Fechas</th><th>Acciones</th></tr>}</thead><tbody>
      {tab === "suggestions" ? suggestions.map((item) => <tr key={`${item.code}-${item.needed}`}><td><button className="row-action" onClick={() => onMaterial(item.code)}>{item.code}</button><small>{item.material.description}</small></td><td>{number(item.quantity)} {item.unit}</td><td>{item.cecos.join(" · ") || "Stock de seguridad"}</td><td>{item.needed}</td><td><button className="row-action" onClick={() => edit("create", { material_code: item.code, quantity: item.quantity, needed_date: item.needed, cecos: item.cecos, note: "Necesidad calculada por MRP" })}>Crear solicitud</button></td></tr>) : rows.map((item) => <tr key={item.id}><td>SC-{String(item.request_number).padStart(5,"0")}</td><td><button className="row-action" onClick={() => onMaterial(item.material_code)}>{item.material_code}</button><small>{materials.get(item.material_code)?.description}</small><small>{item.cecos?.join(" · ") || "Stock de seguridad"}</small></td><td>{number(item.quantity)}</td><td>{number(item.received_quantity)}</td><td>{number(Number(item.quantity)-Number(item.received_quantity))}</td><td>{labels[item.status]}</td><td>{item.order_number || "—"}<small>{item.supplier}</small><small>{item.unit_cost != null && `S/ ${number(item.unit_cost)} por unidad`}</small></td><td>Solicitud: {item.requested_date}<small>Necesidad: {item.needed_date || "—"}</small><small>{item.order_date && `OC: ${item.order_date}`}</small><small>{item.expected_date && `Prevista: ${item.expected_date}`}</small><small>{item.receipt_at && `Última recepción: ${toLocalDateTimeInput(item.receipt_at).replace("T", " ")}`}</small><small>{item.receipt_reference}</small></td><td><div className="procurement-actions">{item.status === "requested" && <><button className="row-action" onClick={() => edit("edit", item)}>Editar</button><button className="row-action" onClick={() => edit("order", item)}>Registrar OC</button></>}{item.status === "ordered" && <button className="row-action" onClick={() => edit("receive", item)}>Registrar recepción</button>}{["requested","ordered"].includes(item.status) && <button className="row-action" disabled={busy} onClick={() => cancel(item)}>Cancelar saldo</button>}</div></td></tr>)}
    </tbody></table></div>{(tab === "suggestions" ? suggestions : rows).length === 0 && <p className="planning-empty">{tab === "suggestions" ? "No hay necesidades nuevas por solicitar. Revisa las solicitudes y órdenes pendientes en sus pestañas." : "No hay registros para este filtro."}</p>}</section>
  </div>;
}
