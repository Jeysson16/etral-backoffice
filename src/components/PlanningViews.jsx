import React, { useMemo, useState } from "react";
import { buildMaterialPlan, buildProductionPlan } from "../lib/planning.js";

const today = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const shortDate = (value) => value ? new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";
const weekLabel = (week) => `${shortDate(week.start)}–${shortDate(week.end)}`;
const amount = (value) => Number.isInteger(value) ? String(value) : Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 2 });

function Heading({ eyebrow, title, subtitle, action }) {
  return <header className="planning-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>{action && <div className="planning-heading-actions">{action}</div>}</header>;
}

export function ProductionPlanView({ dataset, onRunMrp }) {
  const plan = useMemo(() => buildProductionPlan(dataset, today()), [dataset]);
  const products = [...new Map(plan.rows.map((row) => [row.product?.id, row.product]).filter(([id]) => id)).values()];
  return <div className="planning-workspace">
    <Heading eyebrow="Producción / Plan maestro" title="Plan Maestro de Producción" subtitle="Entregas por producto en las próximas 8 semanas, según los CECO abiertos." action={<><span className="planning-chip">Horizonte: 8 semanas</span><button className="planning-primary" onClick={onRunMrp}>Ejecutar MRP →</button></>} />
    <section className="panel planning-card"><div className="planning-card-title"><span className="eyebrow">Calendario de entregas</span><h3>{plan.rows.length} órdenes abiertas en el plan</h3></div>
      <div className="table-scroll"><table className="planning-table"><thead><tr><th>Producto</th>{plan.weeks.map((week) => <th key={week.start}>{weekLabel(week)}</th>)}<th>Total</th></tr></thead><tbody>{products.map((product) => {
        const productRows = plan.rows.filter((row) => row.product?.id === product.id);
        return <tr key={product.id}><th><strong>{product.name}</strong><small>{product.code} · {product.targetDays || "—"} días</small></th>{plan.weeks.map((week, index) => {
          const scheduled = productRows.filter((row) => row.week === index);
          return <td key={week.start} className={scheduled.length ? "planning-filled" : ""}>{scheduled.length ? <><strong>{scheduled.length}</strong><small>{scheduled.map((row) => `CECO ${row.order.ceco}`).join(" · ")}</small></> : ""}</td>;
        })}<td><strong>{productRows.length}</strong></td></tr>;
      })}</tbody><tfoot><tr><th>Órdenes por semana</th>{plan.weeks.map((week, index) => <td key={week.start}>{plan.rows.filter((row) => row.week === index).length}</td>)}<td>{plan.rows.length}</td></tr></tfoot></table></div>
      {products.length === 0 && <p className="planning-empty">No hay órdenes abiertas para mostrar.</p>}
      {plan.overdue.length > 0 && <p className="planning-footnote"><strong>{plan.overdue.length} entrega(s) vencida(s)</strong> se muestran en la primera semana para mantenerlas visibles.</p>}
      {plan.outside.length > 0 && <p className="planning-footnote">{plan.outside.length} orden(es) no tienen fecha dentro del horizonte y no se asignan a una semana.</p>}
    </section>
    <section className="panel planning-card"><div className="planning-card-title"><span className="eyebrow">Verificación de capacidad</span><h3>Horas estimadas para las entregas</h3><p>Suma de horas estándar de las fases de cada producto; capacidad semanal sumada de las fases.</p></div><div className="table-scroll"><table className="planning-table"><thead><tr><th>Concepto</th>{plan.weeks.map((week) => <th key={week.start}>{weekLabel(week)}</th>)}</tr></thead><tbody><tr><th>Horas requeridas</th>{plan.capacity.map((entry, index) => <td key={index}>{amount(entry.required)}</td>)}</tr><tr><th>Horas disponibles</th>{plan.capacity.map((entry, index) => <td key={index}>{amount(entry.available)}</td>)}</tr><tr><th>Utilización</th>{plan.capacity.map((entry, index) => <td key={index}><span className={`planning-status ${entry.utilization > 100 ? "late" : "covered"}`}>{entry.utilization}%</span></td>)}</tr></tbody></table></div><p className="planning-footnote">La capacidad es orientativa: agrupa el trabajo de cada CECO en su semana de entrega.</p></section>
  </div>;
}

export function MaterialMrpView({ dataset, initialCode, onPurchases }) {
  const plan = useMemo(() => buildMaterialPlan(dataset, today()), [dataset]);
  const [selectedCode, setSelectedCode] = useState(initialCode || "");
  const [query, setQuery] = useState("");
  const filtered = plan.rows.filter((row) => `${row.material.code} ${row.material.description}`.toLowerCase().includes(query.toLowerCase()));
  const selected = plan.rows.find((row) => row.material.code === selectedCode) || filtered[0];
  return <div className="planning-workspace">
    <Heading eyebrow="Planificación / MRP" title="Registro MRP por material" subtitle="Necesidades, stock proyectado y compras sugeridas semana a semana." action={<button className="planning-primary" onClick={onPurchases}>Ver compras sugeridas →</button>} />
    <div className="mrp-layout"><aside className="panel mrp-material-list"><label htmlFor="mrp-search">Buscar material</label><input id="mrp-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código o descripción" />
      <div>{filtered.map((row) => <button key={row.material.code} className={selected?.material.code === row.material.code ? "selected" : ""} onClick={() => setSelectedCode(row.material.code)}><span><strong>{row.material.code}</strong><small>{row.material.description}</small></span><em className={row.totalSuggested ? "needs-order" : "covered"}>{row.totalSuggested ? "Pedir" : "Cubierto"}</em></button>)}</div>{filtered.length === 0 && <p className="planning-empty">No se encontraron materiales.</p>}
    </aside><div className="mrp-detail">{selected ? <><section className="panel planning-card"><div className="mrp-material-heading"><div><span className="eyebrow">{selected.material.code}</span><h3>{selected.material.description}</h3><p>{selected.material.category} · unidad: {selected.material.unit}</p></div></div><div className="mrp-stats"><div><span>Stock físico</span><strong>{amount(selected.material.physical)} {selected.material.unit}</strong></div><div><span>Plazo de reposición</span><strong>{selected.leadTime ? `${selected.leadTime} días` : "Sin configurar"}</strong></div><div><span>Stock de seguridad</span><strong>{amount(selected.safety)} {selected.material.unit}</strong></div><div><span>Compra sugerida</span><strong>{amount(selected.totalSuggested)} {selected.material.unit}</strong></div></div></section>
      <section className="panel planning-card mrp-order-card"><div className="planning-card-title"><span className="eyebrow">Origen de la necesidad</span><h3>Órdenes que usan este material</h3><p>Cantidades del BOM para los CECO abiertos dentro del horizonte.</p></div>{selected.orders.length ? <div className="mrp-order-grid">{selected.orders.map((order) => <div key={order.ceco}><strong>CECO {order.ceco}</strong><span>{order.product}</span><b>{amount(order.quantity)} {selected.material.unit}</b><small>Se necesita {shortDate(order.needed)}</small></div>)}</div> : <p className="planning-empty">No hay CECO abiertos que requieran este material en las próximas 8 semanas.</p>}</section>
      <section className="panel planning-card"><div className="planning-card-title"><span className="eyebrow">Tabla MRP</span><h3>{selected.totalSuggested ? `Sugerido: ${amount(selected.totalSuggested)} ${selected.material.unit} en el horizonte` : "Stock cubierto en el horizonte"}</h3></div><div className="table-scroll"><table className="planning-table"><thead><tr><th>Concepto ({selected.material.unit})</th>{plan.weeks.map((week) => <th key={week.start}>{weekLabel(week)}</th>)}</tr></thead><tbody><tr><th>Necesidad bruta<small>Según BOM y CECO abiertos</small></th>{selected.cells.map((cell) => <td key={cell.week.start}>{amount(cell.gross)}</td>)}</tr><tr><th>Stock antes de la necesidad</th>{selected.cells.map((cell) => <td key={cell.week.start}>{amount(cell.opening)}</td>)}</tr><tr><th>Disponible proyectado<small>Antes de la compra sugerida</small></th>{selected.cells.map((cell) => <td key={cell.week.start} className={cell.afterDemand < selected.safety ? "planning-negative" : ""}>{amount(cell.afterDemand)}</td>)}</tr><tr><th>Necesidad neta<small>Para recuperar el mínimo</small></th>{selected.cells.map((cell) => <td key={cell.week.start}>{amount(cell.net)}</td>)}</tr><tr><th>Recepción sugerida</th>{selected.cells.map((cell) => <td key={cell.week.start} className={cell.receipt ? "planning-receipt" : ""}>{cell.receipt ? amount(cell.receipt) : "—"}</td>)}</tr><tr><th>Pedir antes de</th>{selected.cells.map((cell) => <td key={cell.week.start} className={cell.receipt ? "planning-order-date" : ""}>{cell.orderBy ? shortDate(cell.orderBy) : "—"}</td>)}</tr><tr><th>Stock final proyectado</th>{selected.cells.map((cell) => <td key={cell.week.start}>{amount(cell.closing)}</td>)}</tr></tbody></table></div><p className="planning-footnote">Cálculo orientativo con stock físico, BOM de CECO abiertos, plazo de reposición y stock de seguridad. Las recepciones son propuestas, no compras registradas.</p></section></> : <section className="panel planning-empty">No hay materiales en el inventario.</section>}</div></div>
  </div>;
}

export function SuggestedPurchasesView({ dataset, onMaterial }) {
  const plan = useMemo(() => buildMaterialPlan(dataset, today()), [dataset]);
  const [filter, setFilter] = useState("all");
  const current = today();
  const currentWeekEnd = plan.weeks[0]?.end;
  const status = (purchase) => purchase.orderBy < current ? "late" : purchase.orderBy <= currentWeekEnd ? "this-week" : "planned";
  const visible = plan.purchases.filter((purchase) => filter === "all" || status(purchase) === filter);
  const counts = { all: plan.purchases.length, late: 0, "this-week": 0, planned: 0 };
  plan.purchases.forEach((purchase) => { counts[status(purchase)] += 1; });
  return <div className="planning-workspace"><Heading eyebrow="Planificación / Compras" title="Órdenes de compra sugeridas" subtitle="Qué pedir, cuánto y antes de qué fecha, calculado a partir del MRP." action={<span className="planning-chip">Propuesta · sin órdenes emitidas</span>} />
    <div className="purchase-filters" aria-label="Filtrar compras sugeridas">{[["all", "Todas"], ["late", "Atrasadas"], ["this-week", "Esta semana"], ["planned", "Planificadas"]].map(([key, label]) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label} · {counts[key]}</button>)}</div>
    <section className="panel"><div className="table-scroll"><table className="planning-table purchase-table"><thead><tr><th>Estado</th><th>Material</th><th>Cantidad</th><th>Pedir antes de</th><th>Se necesita</th><th>Plazo</th><th>Origen</th><th>Cálculo</th></tr></thead><tbody>{visible.map((purchase) => <tr key={`${purchase.code}-${purchase.needed}`}><td><span className={`planning-status ${status(purchase)}`}>{status(purchase) === "late" ? "Atrasada" : status(purchase) === "this-week" ? "Esta semana" : "Planificada"}</span></td><td><strong>{purchase.code}</strong><small>{purchase.material.description}</small></td><td><strong>{amount(purchase.quantity)} {purchase.unit}</strong></td><td className={status(purchase) === "late" ? "planning-negative" : ""}>{shortDate(purchase.orderBy)}</td><td>{shortDate(purchase.needed)}</td><td>{purchase.leadTime ? `${purchase.leadTime} días` : "Sin configurar"}</td><td>{purchase.cecos.length ? purchase.cecos.map((ceco) => `CECO ${ceco}`).join(" · ") : "Stock de seguridad"}</td><td><details className="purchase-calculation"><summary>Ver cálculo</summary><div>Stock previo: {amount(purchase.opening)} {purchase.unit}<br />Necesidad bruta: {amount(purchase.gross)} {purchase.unit}<br />Saldo antes de comprar: {amount(purchase.afterDemand)} {purchase.unit}<br />Mínimo: {amount(purchase.safety)} {purchase.unit}<br /><button className="row-action" onClick={() => onMaterial(purchase.code)}>Ver por PMP →</button></div></details></td></tr>)}</tbody></table></div>{visible.length === 0 && <p className="planning-empty">No hay compras sugeridas para este filtro.</p>}</section>
    <p className="planning-footnote">Las cantidades se redondean a unidades enteras. No hay lote de compra configurado ni recepción automática.</p>
  </div>;
}
