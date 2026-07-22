import React, { useEffect, useMemo, useState } from "react";
import { initialDataset } from "./data/seed.js";
import { evaluateMrp, inventoryHeatmap } from "./lib/mrp.js";
import { calculateKpis } from "./lib/simulator.js";
import { getRepository } from "./services/repository.js";
import { getTwinEngine, runTwinSimulation } from "./services/twinApi.js";

const views = {
  overview: { label: "Inicio", icon: "⌂", subtitle: "Situación operativa de la planta" },
  orders: { label: "Producción", icon: "▤", subtitle: "Órdenes CECO, ejecución y liberaciones de calidad" },
  products: { label: "Productos", icon: "◇", subtitle: "Productos en planta por fase, actividades y materiales" },
  stages: { label: "Fases y actividades", icon: "⇥", subtitle: "Procesos, actividades e inventario en proceso" },
  inventory: { label: "Inventario", icon: "▦", subtitle: "Materiales, existencias y movimientos de almacén" },
  twin: { label: "Simulación", icon: "◎", subtitle: "Escenarios comparables sin alterar los datos reales" }
};

const statusText = { green: "En curso", orange: "Atención", red: "Bloqueado" };
const twinEngine = getTwinEngine();
const twinEngineLabel = twinEngine === "python" ? "Motor Python avanzado" : "Motor ligero JS";

function normalizeDataset(value) {
  return {
    ...initialDataset,
    ...value,
    flowStages: value?.flowStages?.length ? value.flowStages : initialDataset.flowStages,
    stageActivities: value?.stageActivities?.length ? value.stageActivities : initialDataset.stageActivities,
    stageInventory: value?.stageInventory?.length ? value.stageInventory : initialDataset.stageInventory,
    bodyTypes: value?.bodyTypes?.length ? value.bodyTypes : initialDataset.bodyTypes,
    catalogs: value?.catalogs?.categories?.length ? value.catalogs : initialDataset.catalogs
  };
}

function byOrder(dataset) {
  return [...dataset.flowStages].sort((a, b) => a.order - b.order);
}

function productOf(dataset, id) {
  return dataset.bodyTypes.find((item) => item.id === id);
}

function stageOf(dataset, id) {
  return dataset.flowStages.find((item) => item.id === id);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}

export default function App() {
  const [dataset, setDataset] = useState(initialDataset);
  const [view, setView] = useState("overview");
  const [drawer, setDrawer] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [simDraft, setSimDraft] = useState({
    horizonDays: 14,
    laborAvailability: 85,
    shiftsPerDay: 1,
    demandPercent: 100,
    materialCode: initialDataset.inventory[0].code,
    stockAdjustment: 0,
    expediteCeco: ""
  });
  const [simParams, setSimParams] = useState(simDraft);
  const [twin, setTwin] = useState(null);
  const [simulationTime, setSimulationTime] = useState("Escenario inicial");
  const [dataReady, setDataReady] = useState(false);
  const repo = useMemo(() => getRepository(), []);

  useEffect(() => {
    repo.getDataset()
      .then((loaded) => {
        const normalized = normalizeDataset(loaded);
        setDataset(normalized);
        setSimDraft((current) => normalized.inventory.some((item) => item.code === current.materialCode)
          ? current
          : { ...current, materialCode: normalized.inventory[0]?.code ?? "" });
        setDataReady(true);
      })
      .catch((err) => { setDataReady(false); setError(err.message); });
    return repo.subscribe?.((fresh) => {
      if (fresh) {
        setDataset(normalizeDataset(fresh));
        setDataReady(true);
      }
    });
  }, [repo]);

  const heatmap = useMemo(() => inventoryHeatmap(dataset.inventory, dataset.orders, dataset.bom), [dataset]);
  const mrp = useMemo(() => evaluateMrp(dataset.orders, dataset.bodyTypes, dataset.bom, dataset.inventory), [dataset]);
  const kpis = useMemo(() => calculateKpis(dataset), [dataset]);

  async function persist(action, message) {
    try {
      const updated = await action();
      setDataset(normalizeDataset(updated));
      setDrawer(null);
      setError("");
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2800);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createCatalogItem(payload) {
    try {
      const updated = await repo.createCatalogItem(payload);
      setDataset(normalizeDataset(updated));
      setError("");
      setNotice("Opción agregada al catálogo.");
      window.setTimeout(() => setNotice(""), 2800);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function advanceOrder(order) {
    const product = productOf(dataset, order.bodyTypeId);
    const current = product?.route.indexOf(order.stageId) ?? -1;
    const nextStage = product?.route[current + 1];
    if (!nextStage) return setNotice("La orden ya está en su última fase.");
    await persist(() => repo.moveOrder(order.ceco, nextStage), `CECO ${order.ceco} avanzó a ${stageOf(dataset, nextStage)?.name}.`);
  }

  async function submitDrawer(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    if (drawer.type === "material") {
      return persist(() => repo.createInventory({
        category: dataset.catalogs.categories.find((item) => item.id === values.categoryId)?.name || "Sin categoría",
        categoryId: values.categoryId,
        description: values.description,
        physical: Number(values.physical),
        committed: 0,
        safety: Number(values.safety),
        unit: dataset.catalogs.units.find((item) => item.id === values.unitId)?.symbol || "und",
        unitId: values.unitId,
        brandId: values.brandId || null,
        location: values.location
      }), "Material registrado correctamente.");
    }
    if (drawer.type === "movement") {
      return persist(() => repo.createInventoryMovement({
        type: values.movementType,
        code: values.code,
        quantity: Number(values.quantity),
        ceco: values.ceco || "",
        note: values.note
      }), "Movimiento aplicado al inventario.");
    }
    if (drawer.type === "order") {
      const selectedProduct = productOf(dataset, values.bodyTypeId);
      return persist(() => repo.createOrder({
        customer: values.customer,
        bodyTypeId: values.bodyTypeId,
        line: values.line,
        dueDate: values.dueDate,
        stageId: selectedProduct?.route[0] ?? dataset.flowStages[0]?.id
      }), "Orden CECO creada y materiales reservados.");
    }
    if (drawer.type === "product") {
      return persist(() => repo.createBodyType({
        code: values.code,
        name: values.name,
        family: values.family,
        targetDays: Number(values.targetDays),
        outputUnit: values.outputUnit,
        route: form.getAll("route")
      }), "Producto y ruta registrados.");
    }
    if (drawer.type === "activity") {
      return persist(() => repo.createStageActivity({
        stageId: values.stageId,
        name: values.name,
        standardMinutes: Number(values.standardMinutes)
      }), "Actividad agregada a la fase.");
    }
    if (drawer.type === "bom") {
      return persist(() => repo.createBomItem({
        bodyTypeId: values.bodyTypeId,
        stageId: values.stageId,
        materialCode: values.materialCode,
        pieceCode: values.pieceCode,
        description: values.description,
        lengthMm: Number(values.lengthMm || 0),
        quantity: Number(values.quantity)
      }), "Componente agregado a la BOM.");
    }
    if (drawer.type === "operation") {
      return persist(() => repo.createOperation({
        date: values.date,
        ceco: values.ceco,
        worker: values.worker,
        activity: values.activity,
        totalHours: Number(values.totalHours)
      }), "Parte diario registrado.");
    }
  }

  async function executeSimulation() {
    try {
      const result = await runTwinSimulation(dataset, simDraft);
      setSimParams({ ...simDraft });
      setTwin(result);
      setError("");
      setSimulationTime(`Ejecutado ${new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
    } catch (err) {
      setError(`No se pudo ejecutar la simulación: ${err.message}`);
    }
  }

  const page = views[view];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => { setView("overview"); setMenuOpen(false); }} aria-label="Ir al inicio">
          <img src="/assets/etral-logo.png" alt="ETRAL" />
          <span><strong>ETRAL</strong><small>Control de planta</small></span>
        </button>
        <nav aria-label="Navegación principal">
          {Object.entries(views).map(([key, item]) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => { setView(key); setMenuOpen(false); }}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={`connection-dot ${import.meta.env.VITE_SUPABASE_URL ? "online" : "demo"}`} />
          <div><strong>{dataReady ? "Supabase sincronizado" : "Sincronizando datos"}</strong><small>{dataset.orders.length} CECO · {dataset.inventory.length} materiales · {twinEngineLabel}</small></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Abrir menú">☰</button>
          <div><p className="breadcrumb">Operaciones / {page.label}</p><h1>{page.label}</h1><p>{page.subtitle}</p></div>
          <div className="topbar-context"><span>Actualizado ahora</span><strong>Planta ETRAL</strong></div>
        </header>
        {error && <div className="message error"><strong>No se pudo sincronizar.</strong> {error}</div>}
        {notice && <div className="toast">✓ {notice}</div>}

        <div className="page-content">
          {view === "overview" && <Overview dataset={dataset} kpis={kpis} heatmap={heatmap} mrp={mrp} setView={setView} />}
          {view === "twin" && <TwinView dataset={dataset} draft={simDraft} setDraft={setSimDraft} result={twin} execute={executeSimulation} simulationTime={simulationTime} dataReady={dataReady} />}
          {view === "orders" && <OrdersView dataset={dataset} openDrawer={setDrawer} advanceOrder={advanceOrder} />}
          {view === "products" && <ProductsView dataset={dataset} openDrawer={setDrawer} />}
          {view === "stages" && <StagesView dataset={dataset} openDrawer={setDrawer} />}
          {view === "inventory" && <InventoryView dataset={dataset} heatmap={heatmap} openDrawer={setDrawer} />}
        </div>
      </main>
      <RecordDrawer drawer={drawer} dataset={dataset} onClose={() => setDrawer(null)} onSubmit={submitDrawer} onCreateCatalog={createCatalogItem} />
    </div>
  );
}

function PageActions({ children }) {
  return <div className="page-actions">{children}</div>;
}

function Button({ children, variant = "primary", ...props }) {
  return <button className={`button ${variant}`} {...props}>{children}</button>;
}

function SectionHeader({ eyebrow, title, detail, action }) {
  return <div className="section-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>;
}

function Metric({ label, value, detail, tone = "neutral" }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status}`}>{statusText[status] ?? status}</span>;
}

function Overview({ dataset, kpis, heatmap, mrp, setView }) {
  const critical = heatmap.filter((item) => item.tone !== "ok");
  const priorityOrders = [...dataset.orders].sort((a, b) => a.priority - b.priority).slice(0, 4);
  return <div className="stack-xl">
    <section className="metric-grid four">
      <Metric label="Órdenes activas" value={kpis.activeOrders} detail={`${kpis.dueSoon} vencen en 7 días`} />
      <Metric label="CECO bloqueados" value={kpis.blocked} detail="Requieren intervención" tone={kpis.blocked ? "danger" : "success"} />
      <Metric label="Materiales en riesgo" value={critical.length} detail={`${mrp.alerts.length} afectaciones por CECO`} tone={critical.length ? "warning" : "success"} />
      <Metric label="Horas reportadas" value={`${dataset.operations.reduce((sum, item) => sum + item.totalHours, 0)} h`} detail="Últimos partes diarios" />
    </section>

    <section className="split-grid overview-grid">
      <div className="panel">
        <SectionHeader eyebrow="Prioridad de hoy" title="Órdenes que requieren seguimiento" action={<button className="text-button" onClick={() => setView("orders")}>Ver producción →</button>} />
        <div className="order-list">
          {priorityOrders.map((order) => <article key={order.ceco}>
            <div className="order-index">{String(order.priority).padStart(2, "0")}</div>
            <div className="order-main"><strong>CECO {order.ceco}</strong><span>{productOf(dataset, order.bodyTypeId)?.name}</span></div>
            <div className="order-stage"><span>{stageOf(dataset, order.stageId)?.name}</span><small>Entrega {formatDate(order.dueDate)}</small></div>
            <StatusPill status={order.status} />
          </article>)}
        </div>
      </div>
      <div className="panel">
        <SectionHeader eyebrow="Excepciones MRP" title="Stock que limita el plan" action={<button className="text-button" onClick={() => setView("inventory")}>Abrir inventario →</button>} />
        <div className="risk-list">
          {critical.length === 0 && <EmptyState text="No hay materiales bajo el stock de seguridad." />}
          {critical.slice(0, 5).map((item) => <article key={item.code}>
            <span className={`risk-marker ${item.tone}`} />
            <div><strong>{item.code} · {item.description}</strong><small>Físico {item.physical} · Requerido {item.required} · Proyección {item.projected} {item.unit}</small></div>
            <b>{item.projected < 0 ? `Faltan ${Math.abs(item.projected)}` : "Bajo mínimo"}</b>
          </article>)}
        </div>
      </div>
    </section>

    <section className="panel">
      <SectionHeader eyebrow="Flujo real" title="Carga actual por fase" detail="Cada CECO se muestra únicamente en las fases definidas por la ruta de su producto." />
      <div className="stage-pipeline">
        {byOrder(dataset).map((stage) => {
          const orders = dataset.orders.filter((order) => order.stageId === stage.id);
          return <article key={stage.id} style={{ "--stage-color": stage.color }}><div><span>{stage.shortName}</span><b>{orders.length}</b></div><strong>{stage.name}</strong><small>{orders.length ? orders.map((item) => item.ceco).join(" · ") : "Sin WIP"}</small></article>;
        })}
      </div>
    </section>

    <section className="panel">
      <SectionHeader eyebrow="Trazabilidad" title="Últimos movimientos de inventario" />
      <MovementsTable rows={dataset.inventoryMovements.slice(0, 5)} />
    </section>
  </div>;
}

function TwinView({ dataset, draft, setDraft, result, execute, simulationTime, dataReady }) {
  const [tab, setTab] = useState("capacity");
  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  const comparisons = result ? [
    ["Órdenes terminables", result.baseline.throughput, result.scenario.throughput, "órdenes"],
    ["Cumplimiento PMP", result.baseline.pmpCompliance, result.scenario.pmpCompliance, "%"],
    ["Lead time estimado", result.baseline.estimatedLeadDays, result.scenario.estimatedLeadDays, "días"],
    ["Quiebres proyectados", result.baseline.stockouts, result.scenario.stockouts, "materiales"]
  ] : [];
  return <div className="twin-layout">
    <aside className="scenario-panel panel">
      <SectionHeader eyebrow="Escenario" title="Configurar simulación" detail="Los cambios no modifican inventario ni órdenes reales." />
      <div className={`twin-feed ${dataReady ? "ready" : "loading"}`}>
        <span>{dataReady ? "✓" : "…"}</span>
        <div><strong>{dataReady ? "Gemelo alimentado con Supabase" : "Cargando alimentación del gemelo"}</strong><small>{dataset.flowStages.length} fases · {dataset.stageActivities.length} actividades · {dataset.orders.length} CECO · {dataset.inventory.length} materiales · {dataset.bom.length} componentes BOM</small></div>
      </div>
      <div className="form-stack">
        <Field label="Horizonte de planificación" hint="Período sobre el que se distribuye la capacidad."><select value={draft.horizonDays} onChange={(e) => update("horizonDays", Number(e.target.value))}><option value="7">7 días</option><option value="14">14 días</option><option value="21">21 días</option><option value="30">30 días</option></select></Field>
        <Field label="Personal disponible" hint={`${draft.laborAvailability}% de la dotación planificada.`}><input type="range" min="40" max="100" value={draft.laborAvailability} onChange={(e) => update("laborAvailability", Number(e.target.value))} /></Field>
        <Field label="Turnos por día"><div className="segmented">{[1, 2, 3].map((value) => <button type="button" key={value} className={draft.shiftsPerDay === value ? "active" : ""} onClick={() => update("shiftsPerDay", value)}>{value}</button>)}</div></Field>
        <Field label="Variación de demanda" hint="Aplica a las horas requeridas por las órdenes abiertas."><div className="input-suffix"><input type="number" min="50" max="180" value={draft.demandPercent} onChange={(e) => update("demandPercent", Number(e.target.value))} /><span>%</span></div></Field>
        <div className="field-group"><span>Ajuste extraordinario de material</span><div className="inline-fields"><select value={draft.materialCode} onChange={(e) => update("materialCode", e.target.value)}>{dataset.inventory.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.description}</option>)}</select><input aria-label="Ajuste de stock" type="number" value={draft.stockAdjustment} onChange={(e) => update("stockAdjustment", Number(e.target.value))} /></div><small>Use un valor positivo para un ingreso y negativo para una pérdida simulada.</small></div>
        <Field label="CECO a priorizar" hint="Cambia la lectura de la cola, no el consumo total."><select value={draft.expediteCeco} onChange={(e) => update("expediteCeco", e.target.value)}><option value="">Mantener prioridad actual</option>{dataset.orders.map((order) => <option key={order.ceco} value={order.ceco}>CECO {order.ceco} · {productOf(dataset, order.bodyTypeId)?.name}</option>)}</select></Field>
      </div>
      <Button onClick={execute} disabled={!dataReady}>{dataReady ? "Ejecutar simulación" : "Esperando datos…"}</Button>
      <p className="run-stamp">{simulationTime}</p>
    </aside>

    <div className="simulation-results stack-lg">
      {!result && <section className="panel"><EmptyState text={`Ejecuta el escenario para calcularlo con ${twinEngineLabel.toLowerCase()}.`} /></section>}
      {result && <>
      <div className="simulation-note"><span>i</span><div><strong>Lectura del escenario</strong><p>Se compara el plan vigente con los parámetros elegidos. El resultado es una proyección determinística de capacidad, stock y fechas.</p></div></div>
      <section className="comparison-grid">
        {comparisons.map(([label, base, scenario, unit]) => {
          const delta = Number((scenario - base).toFixed(1));
          return <article key={label}><span>{label}</span><div><small>Base</small><strong>{base}</strong><em>→</em><small>Escenario</small><strong>{scenario}</strong></div><p className={delta === 0 ? "flat" : delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta} {unit}</p></article>;
        })}
      </section>
      <SimulationAlerts notifications={result.notifications} />
      <section className="panel simulation-main">
        <div className="tabs"><button className={tab === "capacity" ? "active" : ""} onClick={() => setTab("capacity")}>Capacidad por fase</button><button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}>Impacto en materiales</button><button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")}>Supuestos</button></div>
        {tab === "capacity" && <CapacityChart rows={result.scenario.stageCapacity} bottleneck={result.scenario.bottleneck} />}
        {tab === "materials" && <MaterialSimulation rows={result.scenario.materials} />}
        {tab === "trace" && <div className="assumption-list">{result.changes.map((item, index) => <article key={item}><span>{index + 1}</span><p>{item}</p></article>)}</div>}
      </section>
      </>}
    </div>
  </div>;
}

function CapacityChart({ rows, bottleneck }) {
  return <div className="chart-block"><div className="chart-summary"><div><span>Cuello de botella</span><strong>{bottleneck}</strong></div><p>Una fase supera 100% cuando las horas requeridas son mayores que las horas disponibles en el horizonte.</p></div><div className="capacity-list">{rows.map((row) => <article key={row.stageId}><div className="capacity-label"><strong>{row.name}</strong><span>{row.demandHours} h requeridas / {row.availableHours} h disponibles</span></div><div className="bar-track"><span style={{ width: `${Math.min(100, row.utilization)}%`, background: row.utilization > 100 ? "#dc2626" : row.color }} /></div><b className={row.utilization > 100 ? "over" : ""}>{row.utilization}%</b></article>)}</div></div>;
}

function MaterialSimulation({ rows }) {
  return <div className="table-scroll"><table><thead><tr><th>Material</th><th>Físico</th><th>Requerimiento</th><th>Proyección</th><th>Resultado</th></tr></thead><tbody>{rows.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.physical} {item.unit}</td><td>{item.required} {item.unit}</td><td>{item.projected} {item.unit}</td><td><span className={`stock-label ${item.tone}`}>{item.tone === "danger" ? "Quiebre" : item.tone === "warning" ? "Bajo mínimo" : "Cubierto"}</span></td></tr>)}</tbody></table></div>;
}

function SimulationAlerts({ notifications }) {
  const critical = notifications.filter((item) => item.severity === "critical").length;
  return <section className="panel alert-center">
    <SectionHeader eyebrow="Indicadores automáticos" title="Alertas del escenario" detail="Cada alerta muestra el cálculo que la activa; no es un estado decorativo." action={<span className={`alert-count ${critical ? "critical" : "ok"}`}>{critical ? `${critical} críticas` : "Sin críticas"}</span>} />
    <div className="alert-list">
      {notifications.length === 0 && <EmptyState text="Los indicadores se mantienen dentro de los umbrales configurados." />}
      {notifications.slice(0, 8).map((alert) => <article className={alert.severity} key={alert.id}>
        <div className="alert-symbol">{alert.severity === "critical" ? "!" : "△"}</div>
        <div className="alert-content"><div><span>{alert.category}</span><strong>{alert.title}</strong></div><p>{alert.detail}</p><code>{alert.equation}</code>{alert.affected.length > 0 && <small>CECO afectados: {alert.affected.join(" · ")}</small>}</div>
        <b>{alert.value}</b>
      </article>)}
    </div>
  </section>;
}

function OrdersView({ dataset, openDrawer, advanceOrder }) {
  return <div className="stack-lg">
    <PageActions><div><strong>{dataset.orders.length} órdenes registradas</strong><span>La ruta y la siguiente fase dependen del producto.</span></div><Button onClick={() => openDrawer({ type: "order" })}>+ Nueva orden CECO</Button></PageActions>
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>CECO / cliente</th><th>Producto</th><th>Fase actual</th><th>Entrega</th><th>Avance</th><th>Estado</th><th></th></tr></thead><tbody>{[...dataset.orders].sort((a, b) => a.priority - b.priority).map((order) => <tr key={order.ceco}><td><strong>CECO {order.ceco}</strong><small>{order.customer} · {order.line}</small></td><td>{productOf(dataset, order.bodyTypeId)?.name}</td><td><span className="stage-tag"><i style={{ background: stageOf(dataset, order.stageId)?.color }} />{stageOf(dataset, order.stageId)?.name}</span></td><td>{formatDate(order.dueDate)}</td><td><div className="progress-cell"><div><span style={{ width: `${order.progress}%` }} /></div><b>{order.progress}%</b></div></td><td><StatusPill status={order.status} /></td><td><button className="row-action" onClick={() => advanceOrder(order)}>Avanzar →</button></td></tr>)}</tbody></table></div></section>
    <ExecutionPanel dataset={dataset} openDrawer={openDrawer} />
  </div>;
}

function ProductsView({ dataset, openDrawer }) {
  const [mode, setMode] = useState("kanban");
  const [productId, setProductId] = useState(dataset.bodyTypes[0]?.id ?? "");
  const [selectedOrder, setSelectedOrder] = useState(null);
  return <div className="stack-lg">
    <PageActions><div className="view-switch" aria-label="Modo de visualización"><button className={mode === "kanban" ? "active" : ""} onClick={() => setMode("kanban")}>▦ Kanban</button><button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>☷ Lista</button></div><Button variant="secondary" onClick={() => openDrawer({ type: "product" })}>+ Producto maestro</Button></PageActions>
    {mode === "kanban" && <ProductKanban dataset={dataset} onSelect={setSelectedOrder} />}
    {mode === "list" && <><ProductList dataset={dataset} onSelect={setSelectedOrder} /><BomPanel dataset={dataset} openDrawer={openDrawer} productId={productId} setProductId={setProductId} /></>}
    <ProductFlowDrawer dataset={dataset} order={selectedOrder} onClose={() => setSelectedOrder(null)} />
  </div>;
}

function activityProgressOf(dataset, ceco, activityId) {
  return (dataset.activityProgress ?? []).find((item) => item.ceco === ceco && item.activityId === activityId) ?? { status: "pending", progress: 0, startedAt: null, finishedAt: null };
}

function currentActivity(dataset, order) {
  const activities = dataset.stageActivities.filter((item) => item.stageId === order.stageId).sort((a, b) => a.sequence - b.sequence);
  return activities.find((activity) => ["in_progress", "blocked"].includes(activityProgressOf(dataset, order.ceco, activity.id).status)) ?? activities.find((activity) => activityProgressOf(dataset, order.ceco, activity.id).status === "pending") ?? activities.at(-1);
}

function ProductKanban({ dataset, onSelect }) {
  return <div className="product-kanban" aria-label="Productos por fase">
    {byOrder(dataset).map((stage) => {
      const orders = dataset.orders.filter((order) => order.stageId === stage.id && Number(order.progress) < 100).sort((a, b) => a.priority - b.priority);
      const activities = dataset.stageActivities.filter((item) => item.stageId === stage.id).sort((a, b) => a.sequence - b.sequence);
      return <section className="phase-column" style={{ "--phase-color": stage.color }} key={stage.id}>
        <header><div><span>{stage.shortName}</span><strong>{stage.name}</strong></div><b>{orders.length}</b><small>{stage.capacityHours} h/sem.</small></header>
        <div className="phase-cards">
          {orders.length === 0 && <div className="phase-empty">Sin productos en esta fase</div>}
          {orders.map((order) => <button className={`product-work-card ${order.status}`} key={order.ceco} onClick={() => onSelect(order)}>
            <div className="work-card-top"><span>CECO {order.ceco}</span><StatusPill status={order.status} /></div>
            <strong>{productOf(dataset, order.bodyTypeId)?.name}</strong><small>{order.customer}</small>
            <div className="mini-progress"><span style={{ width: `${order.progress}%` }} /><b>{order.progress}%</b></div>
            <div className="activity-preview">
              {activities.slice(0, 3).map((activity) => { const progress = activityProgressOf(dataset, order.ceco, activity.id); return <div className={progress.status} key={activity.id}><i>{progress.status === "completed" ? "✓" : progress.status === "blocked" ? "!" : ""}</i><span>{activity.name}</span></div>; })}
              {activities.length > 3 && <small>+ {activities.length - 3} actividades</small>}
            </div>
            <div className="work-card-footer"><span>Actividad actual</span><b>{currentActivity(dataset, order)?.name ?? "Sin actividad"}</b></div>
          </button>)}
        </div>
      </section>;
    })}
  </div>;
}

function ProductList({ dataset, onSelect }) {
  return <section className="panel"><SectionHeader eyebrow="Productos en planta" title="Lista de CECO activos" detail="La tabla y el Kanban representan las mismas órdenes de producción." /><div className="table-scroll"><table><thead><tr><th>CECO / producto</th><th>Cliente</th><th>Fase</th><th>Actividad actual</th><th>Actividades</th><th>Entrega</th><th>Estado</th><th></th></tr></thead><tbody>{[...dataset.orders].filter((order) => Number(order.progress) < 100).sort((a, b) => a.priority - b.priority).map((order) => { const stageActivities = dataset.stageActivities.filter((item) => item.stageId === order.stageId); const completed = stageActivities.filter((item) => activityProgressOf(dataset, order.ceco, item.id).status === "completed").length; return <tr key={order.ceco}><td><strong>CECO {order.ceco}</strong><small>{productOf(dataset, order.bodyTypeId)?.name}</small></td><td>{order.customer}<small>{order.line}</small></td><td><span className="stage-tag"><i style={{ background: stageOf(dataset, order.stageId)?.color }} />{stageOf(dataset, order.stageId)?.name}</span></td><td>{currentActivity(dataset, order)?.name ?? "Sin actividad"}</td><td><strong>{completed} / {stageActivities.length}</strong><small>{order.progress}% global</small></td><td>{formatDate(order.dueDate)}</td><td><StatusPill status={order.status} /></td><td><button className="row-action" onClick={() => onSelect(order)}>Ver detalle →</button></td></tr>; })}</tbody></table></div></section>;
}

function ProductFlowDrawer({ dataset, order, onClose }) {
  if (!order) return null;
  const product = productOf(dataset, order.bodyTypeId);
  const stage = stageOf(dataset, order.stageId);
  const route = product?.route ?? [];
  const currentIndex = route.indexOf(order.stageId);
  const activities = dataset.stageActivities.filter((item) => item.stageId === order.stageId).sort((a, b) => a.sequence - b.sequence);
  const materials = dataset.bom.filter((item) => item.bodyTypeId === order.bodyTypeId).sort((a, b) => Number(b.stageId === order.stageId) - Number(a.stageId === order.stageId));
  const quality = dataset.quality.filter((item) => item.ceco === order.ceco);
  return <div className="product-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="product-detail-drawer" role="dialog" aria-modal="true" aria-label={`Detalle del CECO ${order.ceco}`}>
    <header><div><p className="eyebrow">Pasaporte productivo</p><h2>{product?.name}</h2><span>CECO {order.ceco}</span></div><button onClick={onClose} aria-label="Cerrar detalle">×</button></header>
    <div className="product-detail-body">
      <section className="detail-summary"><div><span>Cliente</span><strong>{order.customer}</strong></div><div><span>Fase actual</span><strong>{stage?.name}</strong></div><div><span>Entrega pactada</span><strong>{formatDate(order.dueDate)}</strong></div><div><span>Línea / prioridad</span><strong>{order.line} · P{order.priority}</strong></div></section>
      <section className="detail-section"><SectionHeader eyebrow="Flujo completo" title="Ruta del producto" detail={`${route.length} fases configuradas para ${product?.name}.`} /><div className="drawer-route">{route.map((stageId, index) => { const routeStage = stageOf(dataset, stageId); const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "pending"; return <div className={state} key={stageId}><span>{state === "completed" ? "✓" : routeStage?.shortName}</span><p><strong>{routeStage?.name}</strong><small>{state === "completed" ? "Completada" : state === "current" ? "En proceso" : "Pendiente"}</small></p></div>; })}</div></section>
      <section className="detail-section"><SectionHeader eyebrow="Fase actual" title={`Actividades · ${stage?.name}`} detail={`${stage?.capacityHours} h/semana · ${stage?.standardHours} h estándar por orden.`} />
        <div className="drawer-activities">{activities.map((activity) => { const progress = activityProgressOf(dataset, order.ceco, activity.id); return <article className={progress.status} key={activity.id}><span>{progress.status === "completed" ? "✓" : progress.status === "blocked" ? "!" : activity.sequence}</span><div><strong>{activity.name}</strong><small>{progress.startedAt ? `Inicio ${progress.startedAt}` : "Aún no iniciada"}{progress.finishedAt ? ` · Fin ${progress.finishedAt}` : ""}</small><div><i style={{ width: `${progress.progress}%` }} /></div></div><b>{progress.progress}%</b></article>; })}</div>
      </section>
      <section className="detail-section"><SectionHeader eyebrow="MRP por CECO" title="Materiales requeridos" detail="La BOM se conserva por producto y cada material indica su fase de consumo." /><div className="drawer-materials">{materials.map((piece) => { const material = dataset.inventory.find((item) => item.code === piece.materialCode); const available = Number(material?.physical ?? 0) - Number(material?.committed ?? 0); const covered = available >= Number(piece.quantity); return <article key={piece.id}><div><strong>{piece.materialCode} · {piece.description}</strong><small>{material?.description}</small></div><span>{stageOf(dataset, piece.stageId)?.name}</span><p><b>{piece.quantity} {material?.unit}</b><small>Disponible {available}</small></p><em className={covered ? "covered" : "shortage"}>{covered ? "Cubierto" : "Faltante"}</em></article>; })}</div></section>
      <section className="detail-section detail-last"><SectionHeader eyebrow="Cliente y control" title="Datos complementarios" /><div className="customer-detail"><div><span>Cliente</span><strong>{order.customer}</strong><small>Orden {order.ceco} · {product?.family}</small></div><div><span>Estado de planta</span><strong>{order.plantState}</strong><small>Avance global {order.progress}%</small></div><div><span>Calidad</span><strong>{quality.at(-1)?.approval === "approved" ? "Aprobado" : quality.at(-1)?.approval === "observed" ? "Observado" : "Pendiente"}</strong><small>{quality.at(-1)?.observations ?? "Sin inspección registrada"}</small></div></div></section>
    </div>
  </aside></div>;
}

function StagesView({ dataset, openDrawer }) {
  return <div className="stack-lg"><PageActions><div><strong>{dataset.flowStages.length} fases configuradas</strong><span>Modelo obtenido del DOP y de los avances por actividad.</span></div><Button onClick={() => openDrawer({ type: "activity" })}>+ Añadir actividad</Button></PageActions><div className="stage-detail-grid">{byOrder(dataset).map((stage) => { const activities = dataset.stageActivities.filter((item) => item.stageId === stage.id).sort((a, b) => a.sequence - b.sequence); const wip = dataset.stageInventory.filter((item) => item.stageId === stage.id); return <article className="panel stage-detail" key={stage.id}><header style={{ "--stage-color": stage.color }}><span>{stage.shortName}</span><div><h2>{stage.name}</h2><p>{stage.capacityHours} h/semana · estándar {stage.standardHours} h/orden</p></div>{stage.gatedByQuality && <b>Control de calidad</b>}</header><ol>{activities.map((activity) => <li key={activity.id}><span>{String(activity.sequence).padStart(2, "0")}</span><p>{activity.name}</p><small>{activity.standardMinutes} min</small></li>)}</ol><div className="wip-box"><strong>Inventario en proceso</strong>{wip.length === 0 ? <small>Sin unidades en esta fase.</small> : wip.map((item) => <div key={item.id}><span className={`wip-dot ${item.status}`} /><p><b>CECO {item.ceco}</b>{item.item}</p><strong>{item.quantity} {item.unit}</strong></div>)}</div></article>; })}</div></div>;
}

function InventoryView({ dataset, heatmap, openDrawer }) {
  const [search, setSearch] = useState("");
  const filtered = heatmap.filter((item) => `${item.code} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="stack-lg"><PageActions><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, descripción o categoría" /></div><div><Button variant="secondary" onClick={() => openDrawer({ type: "movement" })}>Registrar movimiento</Button><Button onClick={() => openDrawer({ type: "material" })}>+ Nuevo material</Button></div></PageActions><section className="panel"><SectionHeader eyebrow="Maestro de materiales" title="Existencias y cobertura" detail="Disponible = físico − comprometido. Proyección = físico − requerimiento de órdenes abiertas." /><div className="table-scroll"><table><thead><tr><th>Código / material</th><th>Categoría</th><th>Ubicación</th><th>Físico</th><th>Comprometido</th><th>Disponible</th><th>Proyección</th><th>Estado</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.category}</td><td>{item.location ?? "—"}</td><td>{item.physical} {item.unit}</td><td>{item.committed} {item.unit}</td><td>{item.available} {item.unit}</td><td><strong className={item.projected < 0 ? "negative" : ""}>{item.projected} {item.unit}</strong><small>Mínimo {item.safety}</small></td><td><span className={`stock-label ${item.tone}`}>{item.tone === "danger" ? "Quiebre" : item.tone === "warning" ? "Bajo mínimo" : "Cubierto"}</span></td></tr>)}</tbody></table></div></section><section className="panel"><SectionHeader eyebrow="Kardex" title="Movimientos recientes" /><MovementsTable rows={dataset.inventoryMovements} /></section></div>;
}

function MovementsTable({ rows }) {
  return <div className="table-scroll"><table className="compact"><thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th>CECO</th><th>Cantidad</th><th>Detalle</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.timestamp}</td><td><span className={`movement-type ${row.type}`}>{row.type}</span></td><td><strong>{row.code}</strong></td><td>{row.ceco || "—"}</td><td>{row.quantity}</td><td>{row.note}</td></tr>)}</tbody></table></div>;
}

function BomPanel({ dataset, openDrawer, productId, setProductId }) {
  const rows = dataset.bom.filter((item) => item.bodyTypeId === productId);
  return <section className="panel"><SectionHeader eyebrow="Lista de materiales" title={`BOM · ${productOf(dataset, productId)?.name ?? "Producto"}`} detail="El consumo se asigna a la fase en la que el material debe estar disponible." action={<div className="section-actions"><select aria-label="Producto para la BOM" value={productId} onChange={(e) => setProductId(e.target.value)}>{dataset.bodyTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select><Button onClick={() => openDrawer({ type: "bom", productId })}>+ Componente</Button></div>} /><div className="table-scroll"><table><thead><tr><th>Pieza</th><th>Material</th><th>Descripción</th><th>Fase de consumo</th><th>Largo</th><th>Cantidad</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.pieceCode}</strong></td><td>{item.materialCode}</td><td>{item.description}</td><td>{stageOf(dataset, item.stageId)?.name ?? "Sin asignar"}</td><td>{item.lengthMm ? `${item.lengthMm} mm` : "—"}</td><td><strong>{item.quantity}</strong> {dataset.inventory.find((material) => material.code === item.materialCode)?.unit}</td></tr>)}</tbody></table></div></section>;
}

function ExecutionPanel({ dataset, openDrawer }) {
  return <section className="split-grid"><div className="panel"><SectionHeader eyebrow="Ejecución" title="Partes diarios" action={<Button variant="secondary" onClick={() => openDrawer({ type: "operation" })}>+ Registrar horas</Button>} /><div className="table-scroll"><table className="compact"><thead><tr><th>Fecha</th><th>CECO</th><th>Responsable</th><th>Actividad</th><th>Horas</th></tr></thead><tbody>{dataset.operations.map((item) => <tr key={item.id}><td>{formatDate(item.date)}</td><td><strong>{item.ceco}</strong></td><td>{item.worker}</td><td>{item.activity}</td><td><strong>{item.totalHours} h</strong></td></tr>)}</tbody></table></div></div><div className="panel"><SectionHeader eyebrow="Calidad" title="Liberaciones por fase" /><div className="quality-list">{dataset.quality.map((item) => <article key={item.id}><span className={`quality-icon ${item.approval}`}>{item.approval === "approved" ? "✓" : item.approval === "observed" ? "!" : "·"}</span><div><strong>CECO {item.ceco} · {stageOf(dataset, item.stageId)?.name}</strong><p>{item.observations}</p><small>{item.inspector}</small></div></article>)}</div></div></section>;
}

function Field({ label, hint, children }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function CatalogManager({ type, label, items, onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ type, name, symbol });
      setName("");
      setSymbol("");
    } finally {
      setSaving(false);
    }
  }

  return <div className="catalog-manager">
    <button type="button" className="catalog-toggle" onClick={() => setOpen((value) => !value)}>{open ? "Ocultar opciones" : `+ Gestionar ${label.toLowerCase()}`}</button>
    {open && <div className="catalog-popover"><div className="catalog-options">{items.map((item) => <span key={item.id}>{item.name}{item.symbol && ` · ${item.symbol}`}</span>)}</div><div className="catalog-entry"><input aria-label={`Nueva ${label}`} value={name} onChange={(event) => setName(event.target.value)} placeholder={`Nueva ${label.toLowerCase()}`} />{type === "units" && <input aria-label="Símbolo de unidad" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Símbolo, ej. kg" />}<Button type="button" onClick={submit} disabled={saving || !name.trim()}>{saving ? "Agregando..." : "Agregar"}</Button></div></div>}
  </div>;
}

function RecordDrawer({ drawer, dataset, onClose, onSubmit, onCreateCatalog }) {
  if (!drawer) return null;
  const titles = { material: "Registrar material", movement: "Movimiento de inventario", order: "Nueva orden CECO", product: "Registrar producto", activity: "Añadir actividad", bom: "Añadir componente BOM", operation: "Registrar parte diario" };
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer" role="dialog" aria-modal="true" aria-label={titles[drawer.type]}><header><div><p className="eyebrow">Nuevo registro</p><h2>{titles[drawer.type]}</h2></div><button onClick={onClose} aria-label="Cerrar">×</button></header><form onSubmit={onSubmit}>
    {drawer.type === "material" && <><Field label="Descripción"><input name="description" required placeholder="Ej. Plancha galvanizada 1.5 mm" /></Field><div className="form-row"><Field label="Categoría"><select name="categoryId" required>{dataset.catalogs.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><CatalogManager type="categories" label="categoría" items={dataset.catalogs.categories} onCreate={onCreateCatalog} /></Field><Field label="Unidad de medida"><select name="unitId" required>{dataset.catalogs.units.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.symbol}</option>)}</select><CatalogManager type="units" label="unidad" items={dataset.catalogs.units} onCreate={onCreateCatalog} /></Field></div><Field label="Marca"><select name="brandId"><option value="">Sin marca / genérico</option>{dataset.catalogs.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><CatalogManager type="brands" label="marca" items={dataset.catalogs.brands} onCreate={onCreateCatalog} /></Field><div className="form-row"><Field label="Stock inicial"><input name="physical" type="number" min="0" step="0.01" required /></Field><Field label="Stock de seguridad"><input name="safety" type="number" min="0" step="0.01" required /></Field></div><Field label="Ubicación"><input name="location" placeholder="Ej. ALM-PLA" /></Field></>}
    {drawer.type === "movement" && <><Field label="Tipo de movimiento"><select name="movementType"><option value="ingreso">Ingreso</option><option value="salida">Salida a planta</option><option value="reserva">Reserva para CECO</option><option value="ajuste">Ajuste de inventario</option></select></Field><Field label="Material"><select name="code">{dataset.inventory.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.description}</option>)}</select></Field><div className="form-row"><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" required /></Field><Field label="CECO (opcional)"><select name="ceco"><option value="">Sin CECO</option>{dataset.orders.map((item) => <option value={item.ceco} key={item.ceco}>{item.ceco}</option>)}</select></Field></div><Field label="Detalle"><textarea name="note" required placeholder="Motivo o documento de referencia" /></Field></>}
    {drawer.type === "order" && <><Field label="Cliente"><input name="customer" required /></Field><Field label="Producto"><select name="bodyTypeId">{dataset.bodyTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Línea"><select name="line"><option>Línea 1</option><option>Línea 2</option><option>Línea 3</option></select></Field><Field label="Fecha pactada"><input name="dueDate" type="date" required /></Field></div><p className="form-info">Al guardar se genera el CECO, se asigna la primera fase de la ruta y se reserva la BOM.</p></>}
    {drawer.type === "product" && <><div className="form-row"><Field label="Código"><input name="code" required placeholder="PROD-XXX" /></Field><Field label="Familia"><input name="family" required placeholder="Furgones" /></Field></div><Field label="Nombre del producto"><input name="name" required /></Field><div className="form-row"><Field label="Días objetivo"><input name="targetDays" type="number" min="1" required /></Field><Field label="Unidad de salida"><select name="outputUnit"><option value="und">Unidad</option><option value="serv">Servicio</option></select></Field></div><fieldset className="route-picker"><legend>Ruta de fabricación</legend><p>Marca solo las fases que aplican; se conservará el orden productivo.</p>{byOrder(dataset).map((stage) => <label key={stage.id}><input type="checkbox" name="route" value={stage.id} defaultChecked /><span style={{ "--check-color": stage.color }}>{stage.shortName}</span><b>{stage.name}</b></label>)}</fieldset></>}
    {drawer.type === "activity" && <><Field label="Fase"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><Field label="Nombre de la actividad"><input name="name" required /></Field><Field label="Tiempo estándar"><div className="input-suffix"><input name="standardMinutes" type="number" min="1" required /><span>min</span></div></Field></>}
    {drawer.type === "bom" && <><Field label="Producto"><select name="bodyTypeId" defaultValue={drawer.productId}>{dataset.bodyTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Material"><select name="materialCode">{dataset.inventory.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select></Field><Field label="Fase de consumo"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Código de pieza"><input name="pieceCode" required /></Field><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" required /></Field></div><Field label="Descripción"><input name="description" required /></Field><Field label="Longitud (opcional)"><input name="lengthMm" type="number" min="0" /></Field></>}
    {drawer.type === "operation" && <><div className="form-row"><Field label="Fecha"><input name="date" type="date" required /></Field><Field label="CECO"><select name="ceco">{dataset.orders.map((item) => <option key={item.ceco}>{item.ceco}</option>)}</select></Field></div><Field label="Responsable"><input name="worker" required /></Field><Field label="Actividad ejecutada"><input name="activity" required /></Field><Field label="Horas"><input name="totalHours" type="number" min="0.25" step="0.25" required /></Field></>}
    <footer><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></footer>
  </form></aside></div>;
}

function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }
