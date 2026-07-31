import React, { useEffect, useMemo, useState } from "react";
import { initialDataset } from "./data/seed.js";
import { evaluateMrp, inventoryHeatmap } from "./lib/mrp.js";
import { calculateKpis, calibrateDigitalTwin } from "./lib/simulator.js";
import { getRepository } from "./services/repository.js";
import { getTwinEngine, runTwinSimulation } from "./services/twinApi.js";
import ResourcesView from "./components/ResourcesView.jsx";


const views = {
  overview: { label: "Inicio", icon: "⌂", subtitle: "Situación operativa de la planta" },
  orders: { label: "Producción", icon: "▤", subtitle: "Órdenes CECO, ejecución y liberaciones de calidad" },
  products: { label: "Productos", icon: "◇", subtitle: "Plantillas maestras, rutas y listas de materiales" },
  stages: { label: "Fases y actividades", icon: "⇥", subtitle: "Procesos, actividades e inventario en proceso" },
  inventory: { label: "Inventario", icon: "▦", subtitle: "Materiales, existencias y movimientos de almacén" },
  resources: { label: "Recursos", icon: "◉", subtitle: "Personal, turnos, equipos y restricciones operativas" },
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
    customers: value?.customers ?? initialDataset.customers,
    orderMaterialReservations: value?.orderMaterialReservations ?? initialDataset.orderMaterialReservations,
    catalogs: value?.catalogs?.categories?.length ? value.catalogs : initialDataset.catalogs,
    shifts: value?.shifts?.length ? value.shifts : initialDataset.shifts,
    personnel: value?.personnel?.length ? value.personnel : initialDataset.personnel,
    equipment: value?.equipment?.length ? value.equipment : initialDataset.equipment,
    workCalendar: value?.workCalendar?.length ? value.workCalendar : initialDataset.workCalendar,
    assignments: value?.assignments?.length ? value.assignments : initialDataset.assignments,
    incidents: value?.incidents?.length ? value.incidents : initialDataset.incidents
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
    expediteCeco: "",
    orderComplexityMap: {},
    orderWorkerAssignments: {},
    workerInconsistencyMode: "stochastic",
    inconsistencyStdDev: 10,
    absenteeismRate: 5
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

  async function mutate(action, message) {
    try {
      const updated = await action();
      setDataset(normalizeDataset(updated));
      setError("");
      if (message) {
        setNotice(message);
        window.setTimeout(() => setNotice(""), 2800);
      }
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
      const payload = {
        category: dataset.catalogs.categories.find((item) => item.id === values.categoryId)?.name || "Sin categoría",
        categoryId: values.categoryId,
        description: values.description,
        physical: Number(values.physical),
        committed: 0,
        safety: Number(values.safety),
        unit: dataset.catalogs.units.find((item) => item.id === values.unitId)?.symbol || "und",
        unitId: values.unitId,
        brandId: values.brandId || null,
        location: values.location,
        serviceFactor: values.serviceFactor,
        demandStdDev: values.demandStdDev,
        leadTimeDays: values.leadTimeDays
      };
      return persist(() => drawer.item ? repo.updateInventory(drawer.item.code, payload) : repo.createInventory(payload), drawer.item ? "Material actualizado correctamente." : "Material registrado correctamente.");
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
    if (drawer.type === "warehouse") {
      return persist(() => repo.createWarehouseExit({ ceco: values.ceco, materialCode: values.materialCode, quantity: Number(values.quantity) }), "Material reservado entregado a planta.");
    }
    if (drawer.type === "order") {
      const selectedProduct = productOf(dataset, values.bodyTypeId);
      return persist(() => repo.createOrder({
        customerId: values.customerId,
        customer: values.customer,
        bodyTypeId: values.bodyTypeId,
        line: values.line,
        dueDate: values.dueDate,
        stageId: selectedProduct?.route[0] ?? dataset.flowStages[0]?.id
      }), "Orden CECO creada y materiales reservados.");
    }
    if (drawer.type === "product") {
      const payload = {
        code: values.code,
        name: values.name,
        family: values.family,
        targetDays: Number(values.targetDays),
        outputUnit: values.outputUnit,
        route: form.getAll("route")
      };
      return persist(() => drawer.product ? repo.updateBodyType(drawer.product.id, payload) : repo.createBodyType(payload), drawer.product ? "Plantilla de producto actualizada." : "Producto y ruta registrados.");
    }
    if (drawer.type === "customer") {
      const payload = { name: values.name, documentNumber: values.documentNumber, contactName: values.contactName, phone: values.phone, email: values.email, active: values.active !== "false" };
      return persist(() => drawer.customer ? repo.updateCustomer(drawer.customer.id, payload) : repo.createCustomer(payload), drawer.customer ? "Cliente actualizado." : "Cliente registrado.");
    }
    if (drawer.type === "activity") {
      const payload = {
        stageId: values.stageId,
        name: values.name,
        standardMinutes: Number(values.standardMinutes),
        active: values.active !== "false"
      };
      return persist(() => drawer.activity ? repo.updateStageActivity(drawer.activity.id, payload) : repo.createStageActivity(payload), drawer.activity ? "Actividad actualizada." : "Actividad agregada a la fase.");
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
    if (drawer.type === "shift") return persist(() => repo.createShift({ code: values.code, name: values.name, startTime: values.startTime, endTime: values.endTime, breakMinutes: Number(values.breakMinutes) }), "Turno registrado y disponible para asignaciones.");
    if (drawer.type === "personnel") return persist(() => repo.createPersonnel({ employeeCode: values.employeeCode, name: values.name, role: values.role, specialty: values.specialty, shiftId: values.shiftId, status: values.status, efficiency: Number(values.efficiency), weeklyHours: Number(values.weeklyHours) }), "Trabajador incorporado a la alimentación del gemelo.");
    if (drawer.type === "equipment") return persist(() => repo.createEquipment({ code: values.code, name: values.name, stageId: values.stageId, status: values.status, capacityHours: Number(values.capacityHours), maintenanceDue: values.maintenanceDue }), "Equipo registrado en la capacidad instalada.");
    if (drawer.type === "calendar") return persist(() => repo.createCalendarDay({ date: values.date, dayType: values.dayType, availableHours: Number(values.availableHours), note: values.note }), "Calendario operativo actualizado.");
    if (drawer.type === "assignment") return persist(() => repo.createAssignment({ personnelId: values.personnelId, ceco: values.ceco, activityId: values.activityId, assignedDate: values.assignedDate, plannedHours: Number(values.plannedHours), status: values.status }), "Recurso asignado a la actividad del CECO.");
    if (drawer.type === "incident") return persist(() => repo.createIncident({ occurredAt: values.occurredAt, type: values.type, severity: values.severity, stageId: values.stageId, ceco: values.ceco, equipmentId: values.equipmentId, downtimeHours: Number(values.downtimeHours), description: values.description }), "Incidencia registrada y aplicada a la lectura operativa.");
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
          {view === "orders" && <OrdersView dataset={dataset} openDrawer={setDrawer} advanceOrder={advanceOrder} onMoveOrder={(order, stageId) => mutate(() => repo.moveOrder(order.ceco, stageId), `CECO ${order.ceco} movido a ${stageOf(dataset, stageId)?.name}.`)} onProgress={(ceco, activityId, patch) => mutate(() => repo.updateActivityProgress(ceco, activityId, patch), "Avance de actividad actualizado.")} onUpdateOrder={(ceco, patch) => mutate(() => repo.updateOrder(ceco, patch), "Datos de la orden actualizados.")} onCreateQuality={(payload) => mutate(() => repo.createQualityCheck(payload), "Control de calidad registrado.")} />}
          {view === "products" && <ProductsView dataset={dataset} openDrawer={setDrawer} onUpdateBom={(id, patch) => mutate(() => repo.updateBomItem(id, patch), "Material requerido actualizado.")} onDeleteBom={(id) => mutate(() => repo.deleteBomItem(id), "Material requerido eliminado.")} />}
          {view === "stages" && <StagesView dataset={dataset} openDrawer={setDrawer} />}
          {view === "inventory" && <InventoryView dataset={dataset} heatmap={heatmap} openDrawer={setDrawer} />}
          {view === "resources" && <ResourcesView dataset={dataset} openDrawer={setDrawer} />}
        </div>
      </main>
      <RecordDrawer drawer={drawer} dataset={dataset} onClose={() => setDrawer(null)} onSubmit={submitDrawer} onCreateCatalog={createCatalogItem} onUpdateCatalog={(payload) => mutate(() => repo.updateCatalogItem(payload), "Opción actualizada.")} onDeleteCatalog={(payload) => mutate(() => repo.deleteCatalogItem(payload), "Opción eliminada.")} />
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
  const [calibInfo, setCalibInfo] = useState(null);

  useEffect(() => {
    if (dataReady) {
      const calib = calibrateDigitalTwin(dataset);
      setCalibInfo(calib);
      setDraft((current) => ({
        ...current,
        calibrationData: calib,
        inconsistencyStdDev: current.inconsistencyStdDev ?? calib.workerInconsistencyStdDev
      }));
    }
  }, [dataReady, dataset]);

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleCalibrate() {
    const calib = calibrateDigitalTwin(dataset);
    setCalibInfo(calib);
    update("calibrationData", calib);
  }

  function updateOrderComplexity(ceco, val) {
    setDraft((current) => ({
      ...current,
      orderComplexityMap: {
        ...current.orderComplexityMap,
        [ceco]: Number(val)
      }
    }));
  }

  function toggleOrderWorker(ceco, workerId) {
    setDraft((current) => {
      const currentAssigned = current.orderWorkerAssignments[ceco] ?? [];
      const updated = currentAssigned.includes(workerId)
        ? currentAssigned.filter((id) => id !== workerId)
        : [...currentAssigned, workerId];
      return {
        ...current,
        orderWorkerAssignments: {
          ...current.orderWorkerAssignments,
          [ceco]: updated
        }
      };
    });
  }

  const comparisons = result ? [
    ["Órdenes terminables", result.baseline.throughput, result.scenario.throughput, "órdenes"],
    ["Cumplimiento PMP", result.baseline.pmpCompliance, `${result.scenario.pmpCompliance}%`, "%"],
    ["Lead time estimado", result.baseline.estimatedLeadDays, result.scenario.estimatedLeadDays, "días"],
    ["Quiebres proyectados", result.baseline.stockouts, result.scenario.stockouts, "materiales"]
  ] : [];

  const activeOrders = dataset.orders.filter((order) => Number(order.progress) < 100);

  return <div className="twin-layout">
    <aside className="scenario-panel panel">
      <SectionHeader eyebrow="Escenario" title="Configurar simulación" detail="Los cambios no modifican inventario ni órdenes reales." />
      
      <div className={`twin-feed ${dataReady ? "ready" : "loading"}`}>
        <span>{dataReady ? "✓" : "…"}</span>
        <div>
          <strong>{dataReady ? "Gemelo Alimentado y Calibrado" : "Cargando alimentación del gemelo"}</strong>
          <small>{dataset.flowStages.length} fases · {dataset.orders.length} CECO · {dataset.inventory.length} materiales · {dataset.personnel.length} personas</small>
        </div>
      </div>

      {calibInfo && (
        <div className="calibration-card">
          <div className="calib-header">
            <strong>Calibración del Gemelo Digital</strong>
            <span className="calib-score" title="Confiabilidad operativa entrenada con datos de Supabase">{calibInfo.reliabilityScore}% Confiable</span>
          </div>
          <p>Entrenado con {calibInfo.sampleSizeOperations} partes diarios y {calibInfo.sampleSizeProgress} avances registrados.</p>
          <div className="calib-metrics">
            <div><small>Bias Tiempos Estándar</small><strong>{calibInfo.standardTimeBias}x</strong></div>
            <div><small>Variabilidad σ</small><strong>±{calibInfo.workerInconsistencyStdDev}%</strong></div>
          </div>
          <Button variant="secondary" onClick={handleCalibrate}>⚡ Recalibrar con Supabase</Button>
        </div>
      )}

      <div className="form-stack">
        <Field label="Horizonte de planificación" hint="Período sobre el que se distribuye la capacidad.">
          <select value={draft.horizonDays} onChange={(e) => update("horizonDays", Number(e.target.value))}>
            <option value="7">7 días</option>
            <option value="14">14 días</option>
            <option value="21">21 días</option>
            <option value="30">30 días</option>
          </select>
        </Field>

        <Field label="Modelo de inconsistencia de trabajadores" hint="La variabilidad laboral no es un porcentaje arbitrario plano.">
          <select value={draft.workerInconsistencyMode} onChange={(e) => update("workerInconsistencyMode", e.target.value)}>
            <option value="stochastic">Estocástico Monte Carlo (Varianza + Ausentismo)</option>
            <option value="flat">Porcentual plano simple (legacy)</option>
          </select>
        </Field>

        {draft.workerInconsistencyMode === "stochastic" && <>
          <Field label="Desviación típica de rendimiento (σ)" hint={`Desviación en rendimiento laboral: ±${draft.inconsistencyStdDev}%.`}>
            <input type="range" min="4" max="30" value={draft.inconsistencyStdDev} onChange={(e) => update("inconsistencyStdDev", Number(e.target.value))} />
          </Field>
          <Field label="Tasa de ausentismo esperada" hint={`Probabilidad de inasistencia/retraso: ${draft.absenteeismRate}%.`}>
            <input type="range" min="0" max="25" value={draft.absenteeismRate} onChange={(e) => update("absenteeismRate", Number(e.target.value))} />
          </Field>
        </>}

        {draft.workerInconsistencyMode === "flat" && (
          <Field label="Personal disponible" hint={`${draft.laborAvailability}% de la dotación planificada.`}>
            <input type="range" min="40" max="100" value={draft.laborAvailability} onChange={(e) => update("laborAvailability", Number(e.target.value))} />
          </Field>
        )}

        <Field label="Turnos por día">
          <div className="segmented">
            {[1, 2, 3].map((value) => (
              <button type="button" key={value} className={draft.shiftsPerDay === value ? "active" : ""} onClick={() => update("shiftsPerDay", value)}>{value}</button>
            ))}
          </div>
        </Field>

        <Field label="Variación global de demanda" hint="Factor multiplicador general de horas requeridas.">
          <div className="input-suffix">
            <input type="number" min="50" max="180" value={draft.demandPercent} onChange={(e) => update("demandPercent", Number(e.target.value))} />
            <span>%</span>
          </div>
        </Field>

        <div className="field-group">
          <span>Ajuste extraordinario de material</span>
          <div className="inline-fields">
            <select value={draft.materialCode} onChange={(e) => update("materialCode", e.target.value)}>
              {dataset.inventory.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.description}</option>)}
            </select>
            <input aria-label="Ajuste de stock" type="number" value={draft.stockAdjustment} onChange={(e) => update("stockAdjustment", Number(e.target.value))} />
          </div>
          <small>Use un valor positivo para un ingreso y negativo para una pérdida simulada.</small>
        </div>

        <Field label="CECO prioritario en cola" hint="Prioriza la orden sin alterar el consumo total.">
          <select value={draft.expediteCeco} onChange={(e) => update("expediteCeco", e.target.value)}>
            <option value="">Mantener prioridades vigentes</option>
            {activeOrders.map((order) => (
              <option key={order.ceco} value={order.ceco}>CECO {order.ceco} · {productOf(dataset, order.bodyTypeId)?.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Button onClick={execute} disabled={!dataReady}>{dataReady ? "Ejecutar simulación gemela" : "Esperando datos…"}</Button>
      <p className="run-stamp">{simulationTime}</p>
    </aside>

    <div className="simulation-results stack-lg">
      {!result && <section className="panel"><EmptyState text={`Ejecuta el escenario para calcularlo con ${twinEngineLabel.toLowerCase()}.`} /></section>}
      {result && <>
        <div className="simulation-note">
          <span>i</span>
          <div>
            <strong>Simulación Adaptada y Calibrada</strong>
            <p>Se evalúa el comportamiento real del taller integrando calibración empírica, parámetros específicos por CECO y simulación estocástica Monte Carlo.</p>
          </div>
        </div>

        <section className="comparison-grid">
          {comparisons.map(([label, base, scenario, unit]) => {
            const baseNum = typeof base === "number" ? base : parseFloat(base);
            const scenNum = typeof scenario === "number" ? scenario : parseFloat(scenario);
            const delta = Number((scenNum - baseNum).toFixed(1));
            return <article key={label}>
              <span>{label}</span>
              <div><small>Base</small><strong>{base}</strong><em>→</em><small>Escenario</small><strong>{scenario}</strong></div>
              <p className={delta === 0 ? "flat" : delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta} {unit}</p>
              {result.confidenceIntervals && label.includes("PMP") && (
                <small className="confidence-bounds">Rango Monte Carlo (95%): [{result.confidenceIntervals.pmpLower}% - {result.confidenceIntervals.pmpUpper}%]</small>
              )}
              {result.confidenceIntervals && label.includes("Lead") && (
                <small className="confidence-bounds">Rango Monte Carlo (95%): [{result.confidenceIntervals.leadLower}d - {result.confidenceIntervals.leadUpper}d]</small>
              )}
            </article>;
          })}
        </section>

        <SimulationAlerts notifications={result.notifications} />

        <section className="panel simulation-main">
          <div className="tabs">
            <button className={tab === "capacity" ? "active" : ""} onClick={() => setTab("capacity")}>Capacidad por fase</button>
            <button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}>Impacto en materiales</button>
            <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Parámetros por orden CECO</button>
            <button className={tab === "calibration" ? "active" : ""} onClick={() => setTab("calibration")}>Calibración Supabase</button>
            <button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")}>Supuestos</button>
          </div>

          {tab === "capacity" && <CapacityChart rows={result.scenario.stageCapacity} bottleneck={result.scenario.bottleneck} />}
          {tab === "materials" && <MaterialSimulation rows={result.scenario.materials} />}
          
          {tab === "orders" && (
            <div className="order-params-panel">
              <SectionHeader eyebrow="Parámetros específicos" title="Complejidad y asignación por CECO" detail="Permite definir la carga real de horas y personal asignado orden por orden." />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>CECO</th>
                      <th>Producto</th>
                      <th>Avance</th>
                      <th>Complejidad de la orden</th>
                      <th>Personal asignado específico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrders.map((order) => {
                      const complexity = draft.orderComplexityMap[order.ceco] ?? 1.0;
                      const assignedWorkers = draft.orderWorkerAssignments[order.ceco] ?? [];
                      const prod = productOf(dataset, order.bodyTypeId);
                      return (
                        <tr key={order.ceco}>
                          <td><strong>CECO {order.ceco}</strong></td>
                          <td>{prod?.name || order.bodyTypeId}</td>
                          <td>{order.progress}%</td>
                          <td>
                            <select value={complexity} onChange={(e) => updateOrderComplexity(order.ceco, e.target.value)}>
                              <option value="0.8">0.8x (Simplificada)</option>
                              <option value="1.0">1.0x (Estándar)</option>
                              <option value="1.2">1.2x (Moderada)</option>
                              <option value="1.5">1.5x (Alta complejidad)</option>
                              <option value="2.0">2.0x (Crítica / Modificada)</option>
                            </select>
                          </td>
                          <td>
                            <div className="worker-pills">
                              {dataset.personnel.map((person) => {
                                const isAssigned = assignedWorkers.includes(person.id);
                                return (
                                  <button
                                    type="button"
                                    key={person.id}
                                    className={`pill-btn ${isAssigned ? "selected" : ""}`}
                                    onClick={() => toggleOrderWorker(order.ceco, person.id)}
                                  >
                                    {person.name.split(" ")[0]} ({result.calibration?.workerEfficiencyMap[person.id] ?? person.efficiency}%)
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "calibration" && result.calibration && (
            <div className="calibration-details">
              <SectionHeader eyebrow="Modelo entrenado" title="Parámetros de calibración desde Supabase" detail="Resultados del entrenamiento con la historia operativa registrada en la base de datos." />
              <div className="calib-grid">
                <div className="calib-block">
                  <span>Factor de sesgo de tiempos</span>
                  <strong>{result.calibration.standardTimeBias}x</strong>
                  <small>Variación entre horas teorícas en BOM vs reales ejecutadas en planta.</small>
                </div>
                <div className="calib-block">
                  <span>Inconsistencia laboral (σ)</span>
                  <strong>±{result.calibration.workerInconsistencyStdDev}%</strong>
                  <small>Desviación típica de velocidad de trabajo calculada por trabajador.</small>
                </div>
                <div className="calib-block">
                  <span>Puntuación de confiabilidad</span>
                  <strong>{result.calibration.reliabilityScore}%</strong>
                  <small>Ajuste estadístico global del gemelo digital.</small>
                </div>
              </div>
              <h4>Eficiencia calibrada por trabajador:</h4>
              <div className="worker-eff-grid">
                {dataset.personnel.map((p) => {
                  const eff = result.calibration.workerEfficiencyMap[p.id] ?? p.efficiency;
                  return (
                    <div className="eff-card" key={p.id}>
                      <strong>{p.name}</strong>
                      <span>{p.role}</span>
                      <b>{eff}% Eficiencia real</b>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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

function OrdersView({ dataset, openDrawer, advanceOrder, onMoveOrder, onProgress, onUpdateOrder, onCreateQuality }) {
  const [mode, setMode] = useState("kanban");
  const [selectedOrder, setSelectedOrder] = useState(null);
  return <div className="stack-lg">
    <PageActions><div className="view-switch" aria-label="Modo de visualización de órdenes"><button className={mode === "kanban" ? "active" : ""} onClick={() => setMode("kanban")}>▦ Kanban</button><button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>☷ Lista</button><button className={mode === "customers" ? "active" : ""} onClick={() => setMode("customers")}>◎ Clientes</button></div><Button onClick={() => openDrawer({ type: "order" })}>+ Nueva orden CECO</Button></PageActions>
    {mode === "kanban" && <ProductKanban dataset={dataset} onSelect={setSelectedOrder} onMoveOrder={onMoveOrder} />}
    {mode === "list" && <><ProductList dataset={dataset} onSelect={setSelectedOrder} /><ExecutionPanel dataset={dataset} openDrawer={openDrawer} /></>}
    {mode === "customers" && <CustomerCatalog dataset={dataset} openDrawer={openDrawer} />}
    <ProductFlowDrawer dataset={dataset} order={selectedOrder} onClose={() => setSelectedOrder(null)} openDrawer={openDrawer} onProgress={onProgress} onUpdateOrder={onUpdateOrder} onCreateQuality={onCreateQuality} />
  </div>;
}

function ProductsView({ dataset, openDrawer, onUpdateBom, onDeleteBom }) {
  const [productId, setProductId] = useState(dataset.bodyTypes[0]?.id ?? "");
  const product = productOf(dataset, productId);
  const materials = dataset.bom.filter((item) => item.bodyTypeId === productId);
  return <div className="stack-lg">
    <PageActions><div><strong>{dataset.bodyTypes.length} plantillas de producto</strong><span>Una plantilla define la ruta y BOM; las órdenes son quienes recorren el flujo.</span></div><Button onClick={() => openDrawer({ type: "product" })}>+ Producto maestro</Button></PageActions>
    <section className="template-grid">{dataset.bodyTypes.map((item) => <button key={item.id} className={`panel template-card ${item.id === productId ? "selected" : ""}`} onClick={() => setProductId(item.id)}><span>{item.code}</span><strong>{item.name}</strong><small>{item.family} · {item.targetDays} días</small><div>{item.route.map((stageId) => <i key={stageId} title={stageOf(dataset, stageId)?.name} style={{ background: stageOf(dataset, stageId)?.color }} />)}</div><b>{dataset.bom.filter((piece) => piece.bodyTypeId === item.id).length} materiales</b></button>)}</section>
    {product && <section className="panel template-detail"><SectionHeader eyebrow="Plantilla seleccionada" title={`${product.code} · ${product.name}`} detail={`${product.route.length} fases · ${materials.length} componentes BOM`} action={<div className="section-actions"><Button variant="secondary" onClick={() => openDrawer({ type: "product", product })}>Editar plantilla</Button><Button onClick={() => openDrawer({ type: "bom", productId })}>+ Material BOM</Button></div>} /><div className="template-route">{product.route.map((stageId, index) => <span key={stageId}><b>{index + 1}</b>{stageOf(dataset, stageId)?.name}</span>)}</div><MaterialRequirementManager materials={materials} dataset={dataset} onUpdate={onUpdateBom} onDelete={onDeleteBom} /></section>}
  </div>;
}

function CustomerCatalog({ dataset, openDrawer }) {
  return <section className="panel"><SectionHeader eyebrow="Maestro comercial" title="Clientes" detail="El cliente se mantiene una vez y luego se selecciona en cada orden." action={<Button onClick={() => openDrawer({ type: "customer" })}>+ Nuevo cliente</Button>} /><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Teléfono / correo</th><th>Órdenes</th><th></th></tr></thead><tbody>{dataset.customers.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong></td><td>{customer.documentNumber || "—"}</td><td>{customer.contactName || "—"}</td><td>{customer.phone || "—"}<small>{customer.email}</small></td><td>{dataset.orders.filter((order) => order.customerId === customer.id).length}</td><td><button className="row-action" onClick={() => openDrawer({ type: "customer", customer })}>Editar</button></td></tr>)}</tbody></table></div></section>;
}

function activityProgressOf(dataset, ceco, activityId) {
  return (dataset.activityProgress ?? []).find((item) => item.ceco === ceco && item.activityId === activityId) ?? { status: "pending", progress: 0, startedAt: null, finishedAt: null };
}

function currentActivity(dataset, order) {
  const activities = dataset.stageActivities.filter((item) => item.stageId === order.stageId).sort((a, b) => a.sequence - b.sequence);
  return activities.find((activity) => ["in_progress", "blocked"].includes(activityProgressOf(dataset, order.ceco, activity.id).status)) ?? activities.find((activity) => activityProgressOf(dataset, order.ceco, activity.id).status === "pending") ?? activities.at(-1);
}

function ProductKanban({ dataset, onSelect, onMoveOrder }) {
  return <div className="product-kanban" aria-label="Órdenes por fase">
    {byOrder(dataset).map((stage) => {
      const orders = dataset.orders.filter((order) => order.stageId === stage.id && Number(order.progress) < 100).sort((a, b) => a.priority - b.priority);
      const activities = dataset.stageActivities.filter((item) => item.stageId === stage.id).sort((a, b) => a.sequence - b.sequence);
      return <section className="phase-column" style={{ "--phase-color": stage.color }} key={stage.id}>
        <header><div><span>{stage.shortName}</span><strong>{stage.name}</strong></div><b>{orders.length}</b><small>{stage.capacityHours} h/sem.</small></header>
        <div className="phase-cards" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const ceco = event.dataTransfer.getData("text/ceco"); const order = dataset.orders.find((item) => item.ceco === ceco); if (order && productOf(dataset, order.bodyTypeId)?.route.includes(stage.id) && order.stageId !== stage.id) onMoveOrder(order, stage.id); }}>
          {orders.length === 0 && <div className="phase-empty">Sin órdenes en esta fase</div>}
          {orders.map((order) => <button draggable className={`product-work-card ${order.status}`} key={order.ceco} onDragStart={(event) => event.dataTransfer.setData("text/ceco", order.ceco)} onClick={() => onSelect(order)}>
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

function ProductFlowDrawer({ dataset, order, onClose, openDrawer, onProgress, onUpdateOrder, onCreateQuality }) {
  if (!order) return null;
  const product = productOf(dataset, order.bodyTypeId);
  const stage = stageOf(dataset, order.stageId);
  const route = product?.route ?? [];
  const currentIndex = route.indexOf(order.stageId);
  const reservations = dataset.orderMaterialReservations.filter((item) => item.ceco === order.ceco).sort((a, b) => Number(b.stageId === order.stageId) - Number(a.stageId === order.stageId));
  const quality = dataset.quality.filter((item) => item.ceco === order.ceco);
  return <div className="product-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="product-detail-drawer" role="dialog" aria-modal="true" aria-label={`Detalle del CECO ${order.ceco}`}>
    <header><div><p className="eyebrow">Pasaporte productivo</p><h2>{product?.name}</h2><span>CECO {order.ceco}</span></div><button onClick={onClose} aria-label="Cerrar detalle">×</button></header>
    <div className="product-detail-body">
      <section className="detail-summary"><div><span>Cliente</span><strong>{order.customer}</strong></div><div><span>Fase actual</span><strong>{stage?.name}</strong></div><div><span>Entrega pactada</span><strong>{formatDate(order.dueDate)}</strong></div><div><span>Línea / prioridad</span><strong>{order.line} · P{order.priority}</strong></div></section>
      <section className="detail-section"><SectionHeader eyebrow="Flujo completo" title="Ruta del producto" detail={`${route.length} fases configuradas para ${product?.name}.`} /><div className="drawer-route">{route.map((stageId, index) => { const routeStage = stageOf(dataset, stageId); const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "pending"; return <div className={state} key={stageId}><span>{state === "completed" ? "✓" : routeStage?.shortName}</span><p><strong>{routeStage?.name}</strong><small>{state === "completed" ? "Completada" : state === "current" ? "En proceso" : "Pendiente"}</small></p></div>; })}</div></section>
      <section className="detail-section"><SectionHeader eyebrow="Avance por etapa" title="Actividades de la orden" detail="La fase actual queda abierta; despliega las demás para revisar su historial." />{route.map((stageId) => <StageProgressEditor key={stageId} stage={stageOf(dataset, stageId)} activities={dataset.stageActivities.filter((item) => item.stageId === stageId).sort((a, b) => a.sequence - b.sequence)} ceco={order.ceco} dataset={dataset} onProgress={onProgress} current={stageId === order.stageId} />)}</section>
      <section className="detail-section"><SectionHeader eyebrow="MRP por CECO" title="Materiales reservados para la orden" detail="La BOM se copia como requerimiento al crear la orden; aquí se muestra reserva, entrega y consumo por fase." /><OrderReservationList reservations={reservations} dataset={dataset} openDrawer={openDrawer} /></section>
      <section className="detail-section detail-last"><SectionHeader eyebrow="Cliente y control" title="Datos complementarios" /><CustomerManager dataset={dataset} order={order} product={product} quality={quality.at(-1)} onSave={onUpdateOrder} onQuality={onCreateQuality} /></section>
    </div>
  </aside></div>;
}

function OrderReservationList({ reservations, dataset, openDrawer }) {
  if (!reservations.length) return <EmptyState text="Esta orden aún no tiene reservas detalladas. Las nuevas órdenes las generan automáticamente desde la BOM." />;
  return <div className="drawer-materials">{reservations.map((item) => { const material = dataset.inventory.find((entry) => entry.code === item.materialCode); const complete = item.reservedQuantity >= item.requiredQuantity; const pendingIssue = item.reservedQuantity - item.issuedQuantity; return <article key={item.id}><div><strong>{item.materialCode} · {material?.description}</strong><small>{stageOf(dataset, item.stageId)?.name}</small></div><p><b>{item.reservedQuantity} / {item.requiredQuantity} {material?.unit}</b><small>Reservado / requerido · entregado {item.issuedQuantity}</small></p><em className={complete ? "covered" : "shortage"}>{complete ? item.status === "issued" ? "Entregado" : "Reservado" : item.reservedQuantity > 0 ? "Parcial" : "Pendiente"}</em>{pendingIssue > 0 && <button className="row-action" onClick={() => openDrawer({ type: "warehouse", reservation: item })}>Entregar</button>}</article>; })}</div>;
}

function StageProgressEditor({ stage, activities, ceco, dataset, onProgress, current }) {
  const [progressDrafts, setProgressDrafts] = useState({});
  const completed = activities.filter((activity) => activityProgressOf(dataset, ceco, activity.id).status === "completed").length;
  return <details className="stage-progress-editor" open={current ? true : undefined}><summary><span style={{ background: stage?.color }}>{stage?.shortName}</span><strong>{stage?.name}</strong><small>{completed}/{activities.length} realizadas</small></summary>{activities.map((activity) => { const value = activityProgressOf(dataset, ceco, activity.id); const progress = progressDrafts[activity.id] ?? value.progress; return <div className="activity-control" key={activity.id}><label><input type="checkbox" checked={value.status === "completed"} onChange={(event) => { setProgressDrafts((current) => ({ ...current, [activity.id]: event.target.checked ? 100 : 0 })); onProgress(ceco, activity.id, { status: event.target.checked ? "completed" : "pending", progress: event.target.checked ? 100 : 0 }); }} /><span>{activity.name}</span></label><select aria-label={`Estado de ${activity.name}`} value={value.status} onChange={(event) => { const status = event.target.value; const nextProgress = status === "completed" ? 100 : status === "pending" ? 0 : progress; setProgressDrafts((current) => ({ ...current, [activity.id]: nextProgress })); onProgress(ceco, activity.id, { status, progress: nextProgress }); }}><option value="pending">Pendiente</option><option value="in_progress">En proceso</option><option value="blocked">Bloqueada</option><option value="completed">Completada</option></select><input aria-label={`Avance de ${activity.name}`} type="range" min="0" max="100" value={progress} onChange={(event) => setProgressDrafts((current) => ({ ...current, [activity.id]: Number(event.target.value) }))} onBlur={() => { if (progress !== value.progress) onProgress(ceco, activity.id, { progress, status: progress === 100 ? "completed" : progress > 0 ? "in_progress" : "pending" }); }} /><b>{progress}%</b></div>; })}</details>;
}

function MaterialRequirementManager({ materials, dataset, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(null);
  return <div className="drawer-materials">{materials.map((piece) => {
    const material = dataset.inventory.find((item) => item.code === piece.materialCode);
    const available = Number(material?.physical ?? 0) - Number(material?.committed ?? 0);
    const covered = available >= Number(piece.quantity);
    const draft = editing?.id === piece.id ? editing : null;
    return <article className={draft ? "editing" : ""} key={piece.id}>{draft ? <><select value={draft.materialCode} onChange={(event) => setEditing({ ...draft, materialCode: event.target.value })}>{dataset.inventory.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.description}</option>)}</select><select value={draft.stageId} onChange={(event) => setEditing({ ...draft, stageId: event.target.value })}>{byOrder(dataset).map((stage) => <option value={stage.id} key={stage.id}>{stage.shortName} · {stage.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={draft.quantity} onChange={(event) => setEditing({ ...draft, quantity: event.target.value })} /><div className="material-actions"><button type="button" onClick={() => { onUpdate(piece.id, draft); setEditing(null); }}>Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div></> : <><div><strong>{piece.materialCode} · {piece.description}</strong><small>{material?.description}</small></div><span>{stageOf(dataset, piece.stageId)?.name}</span><p><b>{piece.quantity} {material?.unit}</b><small>Disponible {available}</small></p><em className={covered ? "covered" : "shortage"}>{covered ? "Cubierto" : "Faltante"}</em><div className="material-actions"><button type="button" onClick={() => setEditing({ ...piece })}>Editar</button><button type="button" onClick={() => onDelete(piece.id)}>Eliminar</button></div></>}</article>;
  })}</div>;
}

function CustomerManager({ dataset, order, product, quality, onSave, onQuality }) {
  const [draft, setDraft] = useState({ customerId: order.customerId || "", customer: order.customer, line: order.line, dueDate: order.dueDate });
  const [control, setControl] = useState({ inspector: "", approval: "approved", observations: "" });
  return <div className="customer-manager"><div className="customer-detail"><div><span>Cliente</span><strong>{order.customer}</strong><small>Orden {order.ceco} · {product?.family}</small></div><div><span>Estado de planta</span><strong>{order.plantState}</strong><small>Avance global {order.progress}%</small></div><div><span>Calidad</span><strong>{quality?.approval === "approved" ? "Aprobado" : quality?.approval === "observed" ? "Observado" : "Pendiente"}</strong><small>{quality?.observations ?? "Sin inspección registrada"}</small></div></div><div className="customer-fields"><select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })} aria-label="Cliente"><option value="">Cliente original</option>{dataset.customers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={draft.line} onChange={(event) => setDraft({ ...draft, line: event.target.value })}><option>Línea 1</option><option>Línea 2</option><option>Línea 3</option></select><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} aria-label="Fecha pactada" /><Button type="button" onClick={() => onSave(order.ceco, draft)}>Guardar orden</Button></div><div className="quality-control"><input value={control.inspector} onChange={(event) => setControl({ ...control, inspector: event.target.value })} placeholder="Inspector" /><select value={control.approval} onChange={(event) => setControl({ ...control, approval: event.target.value })}><option value="approved">Aprobado</option><option value="observed">Observado</option><option value="pending">Pendiente</option></select><input value={control.observations} onChange={(event) => setControl({ ...control, observations: event.target.value })} placeholder="Observación de calidad" /><Button type="button" onClick={() => onQuality({ ceco: order.ceco, stageId: order.stageId, ...control })} disabled={!control.inspector.trim()}>Registrar control</Button></div></div>;
}

function StagesView({ dataset, openDrawer }) {
  return <div className="stack-lg"><PageActions><div><strong>{dataset.flowStages.length} fases configuradas</strong><span>Modelo obtenido del DOP y de los avances por actividad.</span></div><Button onClick={() => openDrawer({ type: "activity" })}>+ Añadir actividad</Button></PageActions><div className="stage-detail-grid">{byOrder(dataset).map((stage) => { const activities = dataset.stageActivities.filter((item) => item.stageId === stage.id).sort((a, b) => a.sequence - b.sequence); const wip = dataset.stageInventory.filter((item) => item.stageId === stage.id); return <article className="panel stage-detail" key={stage.id}><header style={{ "--stage-color": stage.color }}><span>{stage.shortName}</span><div><h2>{stage.name}</h2><p>{stage.capacityHours} h/semana · estándar {stage.standardHours} h/orden</p></div>{stage.gatedByQuality && <b>Control de calidad</b>}</header><ol>{activities.map((activity) => <li key={activity.id}><span>{String(activity.sequence).padStart(2, "0")}</span><p>{activity.name}</p><small>{activity.standardMinutes} min</small><button className="row-action" onClick={() => openDrawer({ type: "activity", activity })}>Editar</button></li>)}</ol><div className="wip-box"><strong>Inventario en proceso</strong>{wip.length === 0 ? <small>Sin unidades en esta fase.</small> : wip.map((item) => <div key={item.id}><span className={`wip-dot ${item.status}`} /><p><b>CECO {item.ceco}</b>{item.item}</p><strong>{item.quantity} {item.unit}</strong></div>)}</div></article>; })}</div></div>;
}

function InventoryView({ dataset, heatmap, openDrawer }) {
  const [search, setSearch] = useState("");
  const filtered = heatmap.filter((item) => `${item.code} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="stack-lg"><PageActions><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, descripción o categoría" /></div><div><Button variant="secondary" onClick={() => openDrawer({ type: "movement" })}>Registrar movimiento</Button><Button onClick={() => openDrawer({ type: "material" })}>+ Nuevo material</Button></div></PageActions><section className="panel"><SectionHeader eyebrow="Maestro de materiales" title="Existencias y cobertura" detail="Disponible = físico − comprometido. El stock de seguridad se calcula con factor de servicio × variabilidad × √plazo." /><div className="table-scroll"><table><thead><tr><th>Código / material</th><th>Categoría</th><th>Ubicación</th><th>Físico</th><th>Comprometido</th><th>Disponible</th><th>Proyección</th><th>Estado</th><th></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.category}</td><td>{item.location ?? "—"}</td><td>{item.physical} {item.unit}</td><td>{item.committed} {item.unit}</td><td>{item.available} {item.unit}</td><td><strong className={item.projected < 0 ? "negative" : ""}>{item.projected} {item.unit}</strong><small>Mínimo {item.safety}</small></td><td><span className={`stock-label ${item.tone}`}>{item.tone === "danger" ? "Quiebre" : item.tone === "warning" ? "Bajo mínimo" : "Cubierto"}</span></td><td><button className="row-action" onClick={() => openDrawer({ type: "material", item })}>Editar</button></td></tr>)}</tbody></table></div></section><section className="panel"><SectionHeader eyebrow="Kardex" title="Movimientos recientes" /><MovementsTable rows={dataset.inventoryMovements} /></section></div>;
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

function CatalogManager({ catalogs, onCreate, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("categories");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [editing, setEditing] = useState(null);
  const label = { categories: "Categorías", units: "Unidades", brands: "Marcas" }[type];
  const items = catalogs[type] || [];
  async function create() { if (!name.trim()) return; await onCreate({ type, name, symbol }); setName(""); setSymbol(""); }
  async function save(item) { await onUpdate({ type, ...item }); setEditing(null); }
  return <section className="catalog-manager"><button type="button" className="catalog-toggle" onClick={() => setOpen((value) => !value)}>{open ? "Ocultar mantenedor de opciones" : "Gestionar categorías, unidades y marcas"}</button>{open && <div className="catalog-panel"><div className="catalog-tabs">{Object.entries({ categories: "Categorías", units: "Unidades", brands: "Marcas" }).map(([key, text]) => <button type="button" className={type === key ? "active" : ""} onClick={() => { setType(key); setEditing(null); }}>{text}</button>)}</div><div className="catalog-entry"><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Nueva ${label.toLowerCase().slice(0, -1)}`} />{type === "units" && <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Símbolo" />}<Button type="button" onClick={create} disabled={!name.trim()}>Agregar</Button></div><div className="catalog-list">{items.map((item) => { const draft = editing?.id === item.id ? editing : null; return <div key={item.id}>{draft ? <><input value={draft.name} onChange={(event) => setEditing({ ...draft, name: event.target.value })} />{type === "units" && <input value={draft.symbol || ""} onChange={(event) => setEditing({ ...draft, symbol: event.target.value })} />}<button type="button" onClick={() => save(draft)}>Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></> : <><span>{item.name}{item.symbol && ` · ${item.symbol}`}</span><button type="button" onClick={() => setEditing({ ...item })}>Editar</button><button type="button" onClick={() => onDelete({ type, id: item.id })}>Eliminar</button></>}</div>; })}</div></div>}</section>;
}

function RecordDrawer({ drawer, dataset, onClose, onSubmit, onCreateCatalog, onUpdateCatalog, onDeleteCatalog }) {
  if (!drawer) return null;
  const titles = { material: drawer.item ? "Editar material" : "Registrar material", movement: "Movimiento de inventario", warehouse: "Entregar material reservado", order: "Nueva orden CECO", product: drawer.product ? "Editar plantilla" : "Registrar producto", customer: drawer.customer ? "Editar cliente" : "Registrar cliente", activity: drawer.activity ? "Editar actividad" : "Añadir actividad", bom: "Añadir componente BOM", operation: "Registrar parte diario", personnel: "Registrar trabajador", shift: "Registrar turno", equipment: "Registrar equipo", calendar: "Configurar día laboral", assignment: "Asignar recurso", incident: "Registrar incidencia" };
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer" role="dialog" aria-modal="true" aria-label={titles[drawer.type]}><header><div><p className="eyebrow">Nuevo registro</p><h2>{titles[drawer.type]}</h2></div><button onClick={onClose} aria-label="Cerrar">×</button></header><form onSubmit={onSubmit}>
    {drawer.type === "material" && <><Field label="Descripción"><input name="description" defaultValue={drawer.item?.description} required placeholder="Ej. Plancha galvanizada 1.5 mm" /></Field><div className="form-row"><Field label="Categoría"><select name="categoryId" defaultValue={drawer.item?.categoryId || dataset.catalogs.categories.find((item) => item.name === drawer.item?.category || drawer.item?.category?.startsWith(item.name.split(" ")[0]))?.id} required>{dataset.catalogs.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Unidad de medida"><select name="unitId" defaultValue={drawer.item?.unitId || dataset.catalogs.units.find((item) => item.symbol === drawer.item?.unit)?.id} required>{dataset.catalogs.units.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.symbol}</option>)}</select></Field></div><Field label="Marca"><select name="brandId" defaultValue={drawer.item?.brandId || ""}><option value="">Sin marca / genérico</option>{dataset.catalogs.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-row"><Field label={drawer.item ? "Stock físico (solo lectura)" : "Stock inicial"}><input name="physical" type="number" min="0" step="0.01" defaultValue={drawer.item?.physical ?? 0} disabled={Boolean(drawer.item)} required={!drawer.item} /></Field><Field label="Stock de seguridad calculado"><input name="safety" type="number" min="0" step="0.01" defaultValue={drawer.item?.safety ?? 0} readOnly={Boolean(drawer.item?.serviceFactor && drawer.item?.demandStdDev && drawer.item?.leadTimeDays)} /></Field></div><div className="form-row"><Field label="Factor de servicio"><input name="serviceFactor" type="number" min="0" step="0.01" defaultValue={drawer.item?.serviceFactor ?? "1.65"} /></Field><Field label="Variabilidad de demanda"><input name="demandStdDev" type="number" min="0" step="0.01" defaultValue={drawer.item?.demandStdDev ?? ""} /></Field><Field label="Plazo de reposición (días)"><input name="leadTimeDays" type="number" min="0" step="0.01" defaultValue={drawer.item?.leadTimeDays ?? ""} /></Field></div><Field label="Ubicación"><input name="location" defaultValue={drawer.item?.location} placeholder="Ej. ALM-PLA" /></Field><p className="form-info">El físico cambia mediante movimientos. Si completas los tres parámetros, Supabase calcula automáticamente el stock de seguridad.</p><CatalogManager catalogs={dataset.catalogs} onCreate={onCreateCatalog} onUpdate={onUpdateCatalog} onDelete={onDeleteCatalog} /></>}
    {drawer.type === "movement" && <><Field label="Tipo de movimiento"><select name="movementType"><option value="ingreso">Ingreso</option><option value="ajuste">Ajuste de inventario</option></select></Field><Field label="Material"><select name="code">{dataset.inventory.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.description}</option>)}</select></Field><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" required /></Field><Field label="Detalle"><textarea name="note" required placeholder="Motivo o documento de referencia" /></Field><p className="form-info">Las reservas se generan al crear la orden y las salidas se registran desde el detalle CECO para conservar su trazabilidad.</p></>}
    {drawer.type === "warehouse" && <><Field label="Orden CECO"><input name="ceco" value={drawer.reservation.ceco} readOnly /></Field><Field label="Material"><input name="materialCode" value={drawer.reservation.materialCode} readOnly /></Field><Field label="Cantidad a entregar"><input name="quantity" type="number" min="0.01" max={drawer.reservation.reservedQuantity - drawer.reservation.issuedQuantity} step="0.01" defaultValue={drawer.reservation.reservedQuantity - drawer.reservation.issuedQuantity} required /></Field><p className="form-info">La entrega descuenta físico y comprometido, actualiza la reserva y genera ticket y movimiento en una sola transacción.</p></>}
    {drawer.type === "order" && <><Field label="Cliente"><select name="customerId" required>{dataset.customers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}{item.documentNumber ? ` · ${item.documentNumber}` : ""}</option>)}</select><input type="hidden" name="customer" value="" /></Field><Field label="Producto"><select name="bodyTypeId">{dataset.bodyTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Línea"><select name="line"><option>Línea 1</option><option>Línea 2</option><option>Línea 3</option></select></Field><Field label="Fecha pactada"><input name="dueDate" type="date" required /></Field></div><p className="form-info">Al guardar, Supabase genera el CECO y reserva la BOM en una sola transacción. Los faltantes quedan visibles por material y fase.</p></>}
    {drawer.type === "product" && <><div className="form-row"><Field label="Código"><input name="code" defaultValue={drawer.product?.code} required placeholder="PROD-XXX" /></Field><Field label="Familia"><input name="family" defaultValue={drawer.product?.family} required placeholder="Furgones" /></Field></div><Field label="Nombre del producto"><input name="name" defaultValue={drawer.product?.name} required /></Field><div className="form-row"><Field label="Días objetivo"><input name="targetDays" type="number" min="1" defaultValue={drawer.product?.targetDays} required /></Field><Field label="Unidad de salida"><select name="outputUnit" defaultValue={drawer.product?.outputUnit || "und"}><option value="und">Unidad</option><option value="serv">Servicio</option></select></Field></div><fieldset className="route-picker"><legend>Ruta de fabricación</legend><p>Marca solo las fases que aplican; se conservará el orden productivo.</p>{byOrder(dataset).map((stage) => <label key={stage.id}><input type="checkbox" name="route" value={stage.id} defaultChecked={drawer.product ? drawer.product.route.includes(stage.id) : true} /><span style={{ "--check-color": stage.color }}>{stage.shortName}</span><b>{stage.name}</b></label>)}</fieldset></>}
    {drawer.type === "customer" && <><div className="form-row"><Field label="Razón social / nombre"><input name="name" defaultValue={drawer.customer?.name} required /></Field><Field label="RUC / documento"><input name="documentNumber" defaultValue={drawer.customer?.documentNumber} /></Field></div><Field label="Persona de contacto"><input name="contactName" defaultValue={drawer.customer?.contactName} /></Field><div className="form-row"><Field label="Teléfono"><input name="phone" defaultValue={drawer.customer?.phone} /></Field><Field label="Correo"><input name="email" type="email" defaultValue={drawer.customer?.email} /></Field></div>{drawer.customer && <Field label="Estado"><select name="active" defaultValue={String(drawer.customer.active)}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field>}</>}
    {drawer.type === "activity" && <><Field label="Fase"><select name="stageId" defaultValue={drawer.activity?.stageId}>{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><Field label="Nombre de la actividad"><input name="name" defaultValue={drawer.activity?.name} required /></Field><Field label="Tiempo estándar"><div className="input-suffix"><input name="standardMinutes" type="number" min="1" defaultValue={drawer.activity?.standardMinutes} required /><span>min</span></div></Field>{drawer.activity && <Field label="Estado"><select name="active" defaultValue={String(drawer.activity.active)}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field>}</>}
    {drawer.type === "bom" && <><Field label="Producto"><select name="bodyTypeId" defaultValue={drawer.productId}>{dataset.bodyTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Material"><select name="materialCode">{dataset.inventory.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select></Field><Field label="Fase de consumo"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Código de pieza"><input name="pieceCode" required /></Field><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" required /></Field></div><Field label="Descripción"><input name="description" required /></Field><Field label="Longitud (opcional)"><input name="lengthMm" type="number" min="0" /></Field></>}
    {drawer.type === "operation" && <><div className="form-row"><Field label="Fecha"><input name="date" type="date" required /></Field><Field label="CECO"><select name="ceco">{dataset.orders.map((item) => <option key={item.ceco}>{item.ceco}</option>)}</select></Field></div><Field label="Responsable"><input name="worker" required /></Field><Field label="Actividad ejecutada"><input name="activity" required /></Field><Field label="Horas"><input name="totalHours" type="number" min="0.25" step="0.25" required /></Field></>}
    {drawer.type === "personnel" && <><div className="form-row"><Field label="Código"><input name="employeeCode" required placeholder="ETR-007" /></Field><Field label="Estado"><select name="status"><option value="available">Disponible</option><option value="assigned">Asignado</option><option value="absent">Ausente</option><option value="leave">Permiso</option></select></Field></div><Field label="Nombre completo"><input name="name" required /></Field><div className="form-row"><Field label="Cargo"><input name="role" required placeholder="Ej. Soldador" /></Field><Field label="Turno"><select name="shiftId">{dataset.shifts.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field></div><Field label="Especialidad"><input name="specialty" placeholder="Competencia principal" /></Field><div className="form-row"><Field label="Eficiencia estimada"><div className="input-suffix"><input name="efficiency" type="number" min="1" max="150" defaultValue="100" required /><span>%</span></div></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="0" max="84" defaultValue="48" required /></Field></div></>}
    {drawer.type === "shift" && <><div className="form-row"><Field label="Código"><input name="code" required placeholder="T3" /></Field><Field label="Nombre"><input name="name" required placeholder="Turno noche" /></Field></div><div className="form-row"><Field label="Hora de inicio"><input name="startTime" type="time" required /></Field><Field label="Hora de fin"><input name="endTime" type="time" required /></Field></div><Field label="Descanso"><div className="input-suffix"><input name="breakMinutes" type="number" min="0" max="240" defaultValue="60" required /><span>min</span></div></Field></>}
    {drawer.type === "equipment" && <><div className="form-row"><Field label="Código"><input name="code" required placeholder="EQ-XXX-01" /></Field><Field label="Estado"><select name="status"><option value="operational">Operativo</option><option value="restricted">Restringido</option><option value="maintenance">Mantenimiento</option><option value="out_of_service">Fuera de servicio</option></select></Field></div><Field label="Nombre del equipo"><input name="name" required /></Field><Field label="Fase asociada"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Capacidad semanal"><div className="input-suffix"><input name="capacityHours" type="number" min="0" required /><span>h</span></div></Field><Field label="Próximo mantenimiento"><input name="maintenanceDue" type="date" /></Field></div></>}
    {drawer.type === "calendar" && <><Field label="Fecha"><input name="date" type="date" required /></Field><div className="form-row"><Field label="Tipo de día"><select name="dayType"><option value="working">Laborable</option><option value="reduced">Jornada reducida</option><option value="holiday">Feriado</option><option value="shutdown">Parada programada</option></select></Field><Field label="Horas disponibles"><input name="availableHours" type="number" min="0" max="24" defaultValue="8" required /></Field></div><Field label="Observación"><textarea name="note" placeholder="Motivo o condición especial" /></Field></>}
    {drawer.type === "assignment" && <><Field label="Trabajador"><select name="personnelId">{dataset.personnel.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.employeeCode} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="CECO"><select name="ceco">{dataset.orders.map((item) => <option key={item.ceco}>{item.ceco}</option>)}</select></Field><Field label="Fecha"><input name="assignedDate" type="date" required /></Field></div><Field label="Actividad"><select name="activityId">{byOrder(dataset).flatMap((stage) => dataset.stageActivities.filter((item) => item.stageId === stage.id).map((item) => <option key={item.id} value={item.id}>{stage.shortName} · {item.name}</option>))}</select></Field><div className="form-row"><Field label="Horas planificadas"><input name="plannedHours" type="number" min="0.25" max="24" step="0.25" required /></Field><Field label="Estado"><select name="status"><option value="planned">Planificado</option><option value="in_progress">En proceso</option><option value="completed">Completado</option><option value="blocked">Bloqueado</option></select></Field></div></>}
    {drawer.type === "incident" && <><Field label="Fecha y hora"><input name="occurredAt" type="datetime-local" required /></Field><div className="form-row"><Field label="Tipo"><select name="type"><option value="equipment">Equipo</option><option value="material">Material</option><option value="quality">Calidad</option><option value="personnel">Personal</option><option value="safety">Seguridad</option><option value="other">Otro</option></select></Field><Field label="Severidad"><select name="severity"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></Field></div><Field label="Fase afectada"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="CECO (opcional)"><select name="ceco"><option value="">Sin CECO</option>{dataset.orders.map((item) => <option key={item.ceco}>{item.ceco}</option>)}</select></Field><Field label="Equipo (opcional)"><select name="equipmentId"><option value="">Sin equipo</option>{dataset.equipment.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field></div><Field label="Horas de detención"><input name="downtimeHours" type="number" min="0" step="0.25" defaultValue="0" required /></Field><Field label="Descripción"><textarea name="description" required placeholder="Describe el evento y su impacto" /></Field></>}
    <footer><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></footer>
  </form></aside></div>;
}

function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }
