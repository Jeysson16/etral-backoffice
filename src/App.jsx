import React, { useEffect, useMemo, useRef, useState } from "react";
import { initialDataset } from "./data/seed.js";
import { calculateCecoProgress, evaluateMrp, inventoryHeatmap, materialRequirementsByStage } from "./lib/mrp.js";
import { calculateKpis, calibrateDigitalTwin } from "./lib/simulator.js";
import { availableDateRange, calculateProductivityReport } from "./lib/productivity.js";
import { exportIndicatorsWorkbook, exportPeriodRecords } from "./lib/indicatorExports.js";
import { getRepository } from "./services/repository.js";
import { getTwinEngine, runTwinSimulation } from "./services/twinApi.js";
import { downloadBulkImportWorkbook, downloadCatalogWorkbook, parseCatalogWorkbook } from "./lib/excelCatalogs.js";
import { nextCecoCode } from "./lib/correlatives.js";
import { supabase } from "./supabase/client.js";
import ResourcesView from "./components/ResourcesView.jsx";
import etralLogo from "../assets/etral-logo.png";


const views = {
  overview: { label: "Inicio", icon: "⌂", subtitle: "Situación operativa de la planta" },
  orders: { label: "Producción", icon: "▤", subtitle: "Órdenes CECO, ejecución y liberaciones de calidad" },
  products: { label: "Productos", icon: "◇", subtitle: "Plantillas maestras, rutas y listas de materiales" },
  stages: { label: "Fases y actividades", icon: "⇥", subtitle: "Procesos, actividades e inventario en proceso" },
  inventory: { label: "Inventario", icon: "▦", subtitle: "Materiales, existencias y movimientos de almacén" },
  resources: { label: "Recursos", icon: "◉", subtitle: "Personal, turnos, equipos y restricciones operativas" },
  indicators: { label: "Indicadores", icon: "↗", subtitle: "Resultados, ecuaciones y registros para análisis de tesis" },
  twin: { label: "Simulación", icon: "◎", subtitle: "Escenarios comparables sin alterar los datos reales" }
};

const statusText = { green: "En curso", orange: "Atención", red: "Bloqueado" };
const twinEngine = getTwinEngine();
const twinEngineLabel = twinEngine === "python" ? "Motor Python avanzado" : "Motor ligero JS";
let pageScrollLocks = 0;
let pageScrollState = null;

function usePageScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    if (pageScrollLocks === 0) {
      pageScrollState = {
        htmlOverflow: document.documentElement.style.overflow,
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight
      };
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    pageScrollLocks += 1;
    return () => {
      pageScrollLocks = Math.max(0, pageScrollLocks - 1);
      if (pageScrollLocks === 0 && pageScrollState) {
        document.documentElement.style.overflow = pageScrollState.htmlOverflow;
        document.body.style.overflow = pageScrollState.overflow;
        document.body.style.paddingRight = pageScrollState.paddingRight;
        pageScrollState = null;
      }
    };
  }, [active]);
}

function normalizeDataset(value) {
  if (!value) return initialDataset;
  return {
    flowStages: value.flowStages ?? [], stageActivities: value.stageActivities ?? [], stageInventory: value.stageInventory ?? [],
    activityProgress: value.activityProgress ?? [], bodyTypes: value.bodyTypes ?? [], productFamilies: value.productFamilies ?? [],
    productionLines: value.productionLines ?? [], customers: value.customers ?? [], inventory: value.inventory ?? [], bom: value.bom ?? [],
    orders: value.orders ?? [], orderMaterialReservations: value.orderMaterialReservations ?? [], operations: value.operations ?? [],
    warehouse: value.warehouse ?? [], quality: value.quality ?? [], inventoryMovements: value.inventoryMovements ?? [],
    catalogs: value.catalogs ?? { categories: [], units: [], brands: [] }, shifts: value.shifts ?? [], personnel: value.personnel ?? [],
    equipment: value.equipment ?? [], workCalendar: value.workCalendar ?? [], assignments: value.assignments ?? [], incidents: value.incidents ?? []
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

function orderLabel(dataset, order) {
  const product = productOf(dataset, order.bodyTypeId);
  return `${order.ceco} · ${product?.name ?? "Producto sin descripción"} — ${order.customer}`;
}

function newestOrders(orders) {
  return [...orders].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || "");
    const bTime = Date.parse(b.createdAt || "");
    if (Number.isFinite(aTime) || Number.isFinite(bTime)) return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    return Number(b.ceco) - Number(a.ceco);
  });
}

function stagesForOrder(dataset, ceco) {
  const order = dataset.orders.find((item) => item.ceco === ceco);
  const route = productOf(dataset, order?.bodyTypeId)?.route ?? [];
  return byOrder(dataset).filter((stage) => route.includes(stage.id));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function dateFrom(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value, days) {
  const date = dateFrom(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function daysBetween(from, to) {
  const start = dateFrom(from);
  const end = dateFrom(to);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function pmpStartOf(order, product) {
  if (order.plannedStartDate) return order.plannedStartDate;
  return order.dueDate ? addDays(order.dueDate, -Math.max(0, Number(product?.targetDays ?? 1) - 1)) : dateKey(new Date());
}

export default function App() {
  const [dataset, setDataset] = useState(initialDataset);
  const [view, setView] = useState(() => window.location.hash === "#/indicadores" ? "indicators" : "overview");
  const [drawer, setDrawer] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [simDraft, setSimDraft] = useState({
    horizonDays: 14,
    laborAvailability: 85,
    shiftsPerDay: 1,
    demandPercent: 100,
    materialAdjustments: [],
    priorityCecos: [],
    orderPriorityOverrides: {},
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
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const repo = useMemo(() => getRepository(), []);
  const sessionRecoveryRef = useRef(null);
  usePageScrollLock(Boolean(drawer));

  function isFutureJwtError(error) {
    return /jwt.*issued at future|issued at future.*jwt/i.test(String(error?.message ?? error ?? ""));
  }

  async function runWithSessionRecovery(action) {
    try {
      return await action();
    } catch (initialError) {
      if (!supabase || !isFutureJwtError(initialError)) throw initialError;

      if (!sessionRecoveryRef.current) {
        sessionRecoveryRef.current = supabase.auth.refreshSession()
          .then(({ data, error: refreshError }) => {
            if (refreshError) throw refreshError;
            setSession(data.session ?? null);
            return data.session;
          })
          .finally(() => { sessionRecoveryRef.current = null; });
      }

      const refreshedSession = await sessionRecoveryRef.current;
      if (!refreshedSession) throw initialError;
      return action();
    }
  }

  useEffect(() => {
    const syncViewWithHash = () => setView(window.location.hash === "#/indicadores" ? "indicators" : "overview");
    window.addEventListener("hashchange", syncViewWithHash);
    return () => window.removeEventListener("hashchange", syncViewWithHash);
  }, []);

  useEffect(() => {
    const targetHash = view === "indicators" ? "#/indicadores" : "#/";
    if (window.location.hash !== targetHash) window.history.replaceState(null, "", targetHash);
  }, [view]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (supabase && !session) return undefined;
    runWithSessionRecovery(() => repo.getDataset())
      .then((loaded) => {
        const normalized = normalizeDataset(loaded);
        setDataset(normalized);
        setSimDraft((current) => ({
          ...current,
          materialAdjustments: (current.materialAdjustments ?? []).filter((adjustment) => normalized.inventory.some((item) => item.code === adjustment.materialCode)),
          priorityCecos: (current.priorityCecos ?? []).filter((ceco) => normalized.orders.some((order) => order.ceco === ceco && Number(order.progress) < 100)),
          orderPriorityOverrides: Object.fromEntries(Object.entries(current.orderPriorityOverrides ?? {}).filter(([ceco]) => normalized.orders.some((order) => order.ceco === ceco && Number(order.progress) < 100)))
        }));
        setDataReady(true);
      })
      .catch((err) => { setDataReady(false); setError(err.message); });
    return repo.subscribe?.((fresh) => {
      if (fresh) {
        setDataset(normalizeDataset(fresh));
        setDataReady(true);
      }
    });
  }, [repo, session]);

  const heatmap = useMemo(() => inventoryHeatmap(dataset.inventory, dataset.orders, dataset.bom), [dataset]);
  const mrp = useMemo(() => evaluateMrp(dataset.orders, dataset.bodyTypes, dataset.bom, dataset.inventory), [dataset]);
  const kpis = useMemo(() => calculateKpis(dataset), [dataset]);

  async function persist(action, message) {
    try {
      const updated = await runWithSessionRecovery(action);
      setDataset(normalizeDataset(updated));
      setDrawer((current) => current?.parent ?? null);
      setError("");
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2800);
    } catch (err) {
      setError(err.message);
    }
  }

  async function createCatalogItem(payload) {
    try {
      const updated = await runWithSessionRecovery(() => repo.createCatalogItem(payload));
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
      const updated = await runWithSessionRecovery(action);
      const normalized = normalizeDataset(updated);
      setDataset(normalized);
      setError("");
      if (message) {
        setNotice(message);
        window.setTimeout(() => setNotice(""), 2800);
      }
      return normalized;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function importExcelCatalog(file) {
    try {
      const payload = await parseCatalogWorkbook(file);
      const updated = await runWithSessionRecovery(() => repo.importCatalogData(payload));
      setDataset(normalizeDataset(updated));
      setError("");
      setNotice(`${payload.mode === "carga masiva" ? "Carga masiva importada" : "Excel importado"}: ${payload.materials.length} materiales, ${payload.products.length} productos y ${payload.bom.length} componentes BOM. Los materiales coincidentes se sumaron al stock existente.`);
      window.setTimeout(() => setNotice(""), 4800);
    } catch (err) {
      setError(`No se pudo importar el Excel: ${err.message}`);
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
      const movement = { type: values.movementType, code: values.code, quantity: Number(values.quantity), ceco: drawer.ceco || values.ceco || "", note: values.note };
      if (drawer.quickReplenish) return persist(() => repo.replenishAndReserve(movement), "Ingreso registrado y reservas del CECO actualizadas.");
      return persist(() => repo.createInventoryMovement(movement), "Movimiento aplicado al inventario.");
    }
    if (drawer.type === "warehouse") {
      return persist(() => repo.createWarehouseExit({ ceco: values.ceco, materialCode: values.materialCode, quantity: Number(values.quantity) }), "Material reservado entregado a planta.");
    }
    if (drawer.type === "order") {
      const selectedProduct = productOf(dataset, values.bodyTypeId);
      const ceco = String(values.ceco ?? "").trim();
      if (!/^\d{6}$/.test(ceco)) return setError("El correlativo CECO debe tener 6 dígitos numéricos (por ejemplo, 260281).");
      if (dataset.orders.some((order) => order.ceco === ceco)) return setError(`El CECO ${ceco} ya existe. Elige otro correlativo.`);
      return persist(() => repo.createOrder({
        ceco,
        customerId: values.customerId,
        customer: values.customer,
        bodyTypeId: values.bodyTypeId,
        plannedStartDate: values.plannedStartDate,
        dueDate: values.dueDate,
        stageId: selectedProduct?.route[0] ?? dataset.flowStages[0]?.id
      }), "Orden CECO creada y materiales reservados.");
    }
    if (drawer.type === "product") {
      const family = dataset.productFamilies.find((item) => item.id === values.familyId);
      const unit = dataset.catalogs.units.find((item) => item.id === values.outputUnitId);
      const payload = {
        code: values.code,
        name: values.name,
        familyId: values.familyId,
        family: family?.name || "",
        brandId: values.brandId,
        targetDays: Number(values.targetDays),
        outputUnitId: values.outputUnitId,
        outputUnit: unit?.symbol || "und",
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
    if (drawer.type === "calendar") {
      const availableHours = values.dayType === "reduced" ? Number(values.availableHours || 4) : 0;
      return persist(() => repo.createCalendarDay({ date: values.date, dayType: values.dayType, availableHours, note: values.note }), "Excepción del calendario registrada.");
    }
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

  async function saveOrderPriorities(entries) {
    try {
      const refreshed = await repo.updateOrderPriorities(entries);
      setDataset(normalizeDataset(refreshed));
      setNotice(`${entries.length} prioridad(es) CECO guardada(s) en Supabase.`);
      setError("");
    } catch (err) {
      setError(`No se pudieron guardar las prioridades: ${err.message}`);
    }
  }

  if (authLoading) return <AccessScreen loading />;
  if (supabase && !session) return <AccessScreen />;

  const page = views[view];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => { setView("overview"); setMenuOpen(false); }} aria-label="Ir al inicio">
          <span className="brand-mark" aria-hidden="true">
            <span>ET</span>
            <img src={etralLogo} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          </span>
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
          <div className="topbar-context"><span>Actualizado ahora</span><strong>Planta ETRAL</strong>{supabase && <button className="text-button" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>}</div>
        </header>
        {error && <div className="message error"><strong>No se pudo sincronizar.</strong> {error}</div>}
        {notice && <div className="toast">✓ {notice}</div>}

        <div className="page-content">
          {view === "overview" && <Overview dataset={dataset} kpis={kpis} heatmap={heatmap} mrp={mrp} setView={setView} />}
          {view === "indicators" && <IndicatorsView dataset={dataset} />}
          {view === "twin" && <TwinView dataset={dataset} draft={simDraft} setDraft={setSimDraft} result={twin} execute={executeSimulation} onSavePriorities={saveOrderPriorities} simulationTime={simulationTime} dataReady={dataReady} />}
          {view === "orders" && <OrdersView dataset={dataset} activeDrawer={drawer} openDrawer={setDrawer} advanceOrder={advanceOrder} onMoveOrder={(order, stageId) => mutate(() => repo.moveOrder(order.ceco, stageId), `CECO ${order.ceco} movido a ${stageOf(dataset, stageId)?.name}.`)} onProgress={(ceco, activityId, patch) => mutate(() => repo.updateActivityProgress(ceco, activityId, patch), "Avance de actividad actualizado.")} onSchedule={(ceco, entries) => mutate(() => repo.updateActivitySchedules(ceco, entries), entries.length > 1 ? "Cronograma y fases posteriores actualizados." : "Fecha programada actualizada.")} onUpdateOrder={(ceco, patch) => mutate(() => repo.updateOrder(ceco, patch), patch.ceco && patch.ceco !== ceco ? `CECO renombrado a ${patch.ceco}.` : "Datos de la orden actualizados.")} onDeleteOrder={(ceco) => mutate(() => repo.deleteOrder(ceco), `CECO ${ceco} eliminado y reservas pendientes liberadas.`)} onCreateQuality={(payload) => mutate(() => repo.createQualityCheck(payload), "Control de calidad registrado.")} />}
          {view === "products" && <ProductsView dataset={dataset} openDrawer={setDrawer} onImportExcel={importExcelCatalog} onExportExcel={() => downloadCatalogWorkbook(dataset, "products")} onQuickAssign={(items) => mutate(() => repo.saveBomItems(items), `${items.length} material${items.length === 1 ? "" : "es"} asignado${items.length === 1 ? "" : "s"} a la BOM.`)} onUpdateBom={(id, patch) => mutate(() => repo.updateBomItem(id, patch), "Material requerido actualizado.")} onDeleteBom={(id) => mutate(() => repo.deleteBomItem(id), "Material requerido eliminado.")} />}
          {view === "inventory" && <InventoryView dataset={dataset} heatmap={heatmap} openDrawer={setDrawer} onImportExcel={importExcelCatalog} onExportExcel={() => downloadCatalogWorkbook(dataset, "materials")} onCreateCatalog={createCatalogItem} onUpdateCatalog={(payload) => mutate(() => repo.updateCatalogItem(payload), "Catálogo actualizado.")} onDeleteCatalog={(payload) => mutate(() => repo.deleteCatalogItem(payload), "Opción eliminada del catálogo.")} />}
          {view === "stages" && <StagesView dataset={dataset} openDrawer={setDrawer} />}
          {view === "resources" && <ResourcesView dataset={dataset} openDrawer={setDrawer} setView={setView} />}
        </div>
      </main>
      <RecordDrawer drawer={drawer} dataset={dataset} onClose={() => setDrawer((current) => current?.parent ?? null)} onOpenRelated={(type, draft) => setDrawer((current) => current ? { type, parent: { ...current, draft }, secondary: true } : current)} onSubmit={submitDrawer} onCreateCatalog={createCatalogItem} onUpdateCatalog={(payload) => mutate(() => repo.updateCatalogItem(payload), "Opción actualizada.")} onDeleteCatalog={(payload) => mutate(() => repo.deleteCatalogItem(payload), "Opción eliminada.")} />
    </div>
  );
}

function AccessScreen({ loading = false }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError("No fue posible iniciar sesión. Verifica tus credenciales.");
    setSubmitting(false);
  }

  return <main className="access-screen"><section className="access-card"><div className="brand-mark"><span>ET</span></div><p className="eyebrow">Acceso protegido</p><h1>Gemelo digital ETRAL</h1>{loading ? <p>Comprobando sesión segura…</p> : <><p>Ingresa con una cuenta autorizada. La operación de planta no está disponible para visitantes anónimos.</p><form onSubmit={submit}><label>Correo<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <small className="form-error">{error}</small>}<Button type="submit" disabled={submitting}>{submitting ? "Ingresando…" : "Iniciar sesión"}</Button></form><small>Solicita a la administración de ETRAL el alta de tu cuenta.</small></>}</section></main>;
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
  const availableRange = useMemo(() => availableDateRange(dataset), [dataset]);
  const [dateRange, setDateRange] = useState(availableRange);
  useEffect(() => setDateRange(availableRange), [availableRange.start, availableRange.end]);
  const report = useMemo(() => calculateProductivityReport(dataset, dateRange.start, dateRange.end), [dataset, dateRange]);
  const critical = heatmap.filter((item) => item.tone !== "ok");
  const priorityOrders = [...dataset.orders].sort((a, b) => a.priority - b.priority).slice(0, 4);

  function exportReport() {
    exportIndicatorsWorkbook(dataset, report, dateRange, "month");
  }

  return <div className="stack-xl">
    <section className="report-toolbar panel">
      <div>
        <p className="eyebrow">Periodo de análisis</p>
        <strong>Contrasta los indicadores productivos</strong>
        <span>El periodo anterior usa la misma cantidad de días.</span>
      </div>
      <div className="date-range">
        <label>Desde<input type="date" value={dateRange.start} max={dateRange.end} onChange={(event) => event.target.value && setDateRange((current) => ({ ...current, start: event.target.value }))} /></label>
        <label>Hasta<input type="date" value={dateRange.end} min={dateRange.start} onChange={(event) => event.target.value && setDateRange((current) => ({ ...current, end: event.target.value }))} /></label>
        <Button variant="secondary" onClick={() => setDateRange(availableRange)}>Todo el histórico</Button>
        <Button variant="secondary" onClick={exportReport}>↓ Resumen Excel</Button>
        <Button onClick={() => setView("indicators")}>Ver indicadores →</Button>
      </div>
    </section>

    <section className="metric-grid four">
      <Metric label="Órdenes activas" value={kpis.activeOrders} detail={`${kpis.dueSoon} vencen en 7 días`} />
      <Metric label="CECO bloqueados" value={kpis.blocked} detail="Requieren intervención" tone={kpis.blocked ? "danger" : "success"} />
      <Metric label="Materiales en riesgo" value={critical.length} detail={`${mrp.alerts.length} afectaciones por CECO`} tone={critical.length ? "warning" : "success"} />
      <Metric label="Horas reportadas" value={`${dataset.operations.reduce((sum, item) => sum + item.totalHours, 0)} h`} detail="Últimos partes diarios" />
    </section>

    <CurrentMaterialAlerts dataset={dataset} heatmap={heatmap} mrp={mrp} setView={setView} />

    <ProductivityDashboard report={report} onOpen={() => setView("indicators")} />

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

function CurrentMaterialAlerts({ dataset, heatmap, mrp, setView }) {
  const immediate = heatmap.filter((item) => item.available < item.safety);
  const planned = heatmap.filter((item) => item.available >= item.safety && item.projected < item.safety);
  const alerts = [
    ...immediate.map((item) => ({ ...item, scope: "Ahora", severity: item.available < 0 ? "critical" : "warning", projectedRisk: false, replenish: Math.max(0, item.safety - item.available) })),
    ...planned.map((item) => ({ ...item, scope: "Con CECO abiertos", severity: item.projected < 0 ? "critical" : "warning", projectedRisk: true, replenish: Math.max(0, item.safety - item.projected) }))
  ].sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));

  return <section className="panel home-material-alerts">
    <SectionHeader eyebrow="Alertas actuales de materiales" title="Riesgos visibles al iniciar" detail="Lectura directa de inventario, stock comprometido, mínimo y CECO abiertos cargados desde Supabase." action={<button className="text-button" onClick={() => setView("inventory")}>Ver inventario →</button>} />
    <div className="alert-list">
      {alerts.length === 0 && <EmptyState text="El stock disponible actual y el plan de CECO abiertos permanecen por encima del mínimo configurado." />}
      {alerts.slice(0, 5).map((item) => {
        const affected = mrp.alerts.filter((alert) => alert.materialCode === item.code).map((alert) => `CECO ${alert.ceco}`);
        const linkedOrders = [...new Set(dataset.orders.filter((order) => Number(order.progress) < 100 && dataset.bom.some((piece) => piece.bodyTypeId === order.bodyTypeId && piece.materialCode === item.code)).map((order) => `CECO ${order.ceco}`))];
        const cecos = affected.length ? affected : linkedOrders;
        return <article className={item.severity} key={item.code}>
          <div className="alert-symbol">{item.severity === "critical" ? "!" : "△"}</div>
          <div className="alert-content"><div><span>{item.scope}</span><strong>{item.code} · {item.description}</strong></div><p><b>Situación:</b> {item.projectedRisk ? `El plan de pedidos abiertos dejaría ${item.projected} ${item.unit}, bajo el mínimo de ${item.safety} ${item.unit}.` : `Solo hay ${item.available} ${item.unit} disponibles hoy, por debajo del mínimo de ${item.safety} ${item.unit}.`}</p><p><b>Por qué:</b> Físico {item.physical} {item.unit} − comprometido {item.committed} {item.unit}{item.projectedRisk ? ` − ${item.required} ${item.unit} requeridos por CECO abiertos` : ""}.</p>{cecos.length > 0 && <small><b>Afectados:</b> {cecos.join(" · ")}</small>}<p><b>Acción recomendada:</b> Reponer al menos {item.replenish} {item.unit} para recuperar el mínimo; revisa las reservas de los CECO indicados.</p></div>
          <b>{item.projectedRisk ? "Riesgo del plan" : "Atención ahora"}</b>
        </article>;
      })}
    </div>
  </section>;
}

function formatIndicator(value, suffix = "") {
  if (value == null) return "Sin datos";
  return `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(value)}${suffix}`;
}

function changeBetween(current, previous) {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 10) / 10;
}

function ProductivityCard({ label, value, previous, suffix, detail, formula, tone = "neutral" }) {
  const delta = changeBetween(value, previous);
  const width = value == null ? 0 : Math.max(4, Math.min(100, suffix === "%" ? value : value * 100));
  return <article className={`productive-card ${tone} ${value == null ? "unavailable" : ""}`}>
    <header><span>{label}</span>{delta != null && delta !== 0 && <b className={delta > 0 ? "up" : "down"}>{delta > 0 ? "↑" : "↓"} {Math.abs(delta)}</b>}</header>
    <strong>{formatIndicator(value, suffix)}</strong>
    <div className="indicator-track"><i style={{ width: `${width}%` }} /></div>
    <small>{detail}</small>
    <p>{formula}</p>
  </article>;
}

function ProductivityDashboard({ report, onOpen }) {
  const { current, previous } = report;
  const rows = [
    { label: "Cumplimiento PMP", value: current.pmpCompliance, previous: previous.pmpCompliance, suffix: "%", detail: `${current.producedUnits} producidas / ${current.plannedUnits} planificadas`, formula: "Unidades producidas ÷ unidades planificadas × 100", tone: "orange" },
    { label: "Nivel de avance", value: current.progressRate, previous: previous.progressRate, suffix: "%", detail: `${current.executedActivities} ejecutadas / ${current.programmedActivities} programadas`, formula: "Actividades ejecutadas ÷ actividades programadas × 100", tone: "blue" },
    { label: "Lead time promedio", value: current.averageLeadTime, previous: previous.averageLeadTime, suffix: " días", detail: current.leadTimeSamples ? `${current.leadTimeSamples} órdenes con fechas completas` : "Falta registrar fecha de pedido y entrega", formula: "Fecha de entrega − fecha de pedido", tone: "purple" },
    { label: "Cobertura de seguridad", value: current.safetyCoverage, previous: previous.safetyCoverage, suffix: "%", detail: `${current.safetyCovered} de ${current.safetyTotal} materiales sobre el mínimo`, formula: "Disponible ≥ stock de seguridad calculado", tone: "green" },
    { label: "Productividad de mano de obra", value: current.laborProductivity, previous: previous.laborProductivity, suffix: " und/HH", detail: `${current.producedUnits} unidades / ${current.reportedHours} horas reportadas`, formula: "Unidades producidas ÷ horas-hombre", tone: "teal" },
    { label: "Productividad de materiales", value: current.materialProductivity, previous: previous.materialProductivity, suffix: " und/S/", detail: current.materialProductivity == null ? "Falta costo unitario de materiales e insumos" : `Costo trazado S/ ${current.materialCost}`, formula: "Unidades producidas ÷ costo de materiales", tone: "yellow" },
    { label: "Productividad multifactorial", value: current.multifactorProductivity, previous: previous.multifactorProductivity, suffix: "", detail: current.multifactorProductivity == null ? "Faltan valor producido y costos de factores" : `Valor producido S/ ${current.outputValue}`, formula: "Producto total ÷ factores utilizados", tone: "navy" }
  ];
  const available = rows.filter((item) => item.value != null).length;
  return <section className="panel productivity-panel">
    <SectionHeader eyebrow="Indicadores de la investigación" title="MRP y productividad contrastados" detail="Cálculos basados en el Anexo 1 de la tesis. Cada tarjeta compara el periodo elegido con el periodo inmediatamente anterior." action={<div className="indicator-header-actions"><span className="coverage-chip">{available}/7 calculables</span>{onOpen && <button className="text-button" onClick={onOpen}>Abrir tablero →</button>}</div>} />
    <div className="productivity-grid">{rows.map((item) => <ProductivityCard key={item.label} {...item} />)}</div>
    <div className="data-quality-note"><span>i</span><p><strong>Calidad del dato:</strong> {current.estimatedProducedUnits} unidades terminadas se infieren por estado y fecha pactada. Los indicadores sin cifra se habilitarán al registrar costos, valor de salida y fecha real de pedido/entrega.</p></div>
  </section>;
}

function isWithinRange(value, range) {
  const date = String(value ?? "").slice(0, 10);
  return Boolean(date && date >= range.start && date <= range.end);
}

function IndicatorsView({ dataset }) {
  const availableRange = useMemo(() => availableDateRange(dataset), [dataset]);
  const [dateRange, setDateRange] = useState(availableRange);
  const [grouping, setGrouping] = useState("month");
  const [recordType, setRecordType] = useState("operations");
  useEffect(() => setDateRange(availableRange), [availableRange.start, availableRange.end]);

  const report = useMemo(() => calculateProductivityReport(dataset, dateRange.start, dateRange.end), [dataset, dateRange]);
  const { current, previous } = report;
  const series = useMemo(() => {
    const rows = [];
    let cursor = dateRange.start;
    const addDaysUtc = (value, days) => {
      const date = new Date(`${value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    while (cursor <= dateRange.end) {
      let end;
      if (grouping === "week") end = addDaysUtc(cursor, 6);
      else {
        const date = new Date(`${cursor}T12:00:00Z`);
        end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      }
      if (end > dateRange.end) end = dateRange.end;
      const period = calculateProductivityReport(dataset, cursor, end).current;
      rows.push({ label: grouping === "week" ? `${cursor.slice(5)}–${end.slice(5)}` : new Intl.DateTimeFormat("es-PE", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${cursor}T12:00:00Z`)), ...period });
      cursor = addDaysUtc(end, 1);
    }
    return rows;
  }, [dataset, dateRange, grouping]);
  const maxProduced = Math.max(...series.map((item) => item.producedUnits), 1);
  const operations = (dataset.operations ?? []).filter((item) => isWithinRange(item.date, dateRange));
  const progress = (dataset.activityProgress ?? []).filter((item) => isWithinRange(item.startedAt ?? item.finishedAt, dateRange));
  const movements = (dataset.inventoryMovements ?? []).filter((item) => isWithinRange(item.timestamp, dateRange));
  const records = { operations, progress, movements };
  const recordLabels = { operations: "Partes de operación", progress: "Avance de actividades", movements: "Movimientos de materiales" };

  return <div className="stack-xl indicators-view">
    <section className="report-toolbar panel indicators-toolbar">
      <div>
        <p className="eyebrow">Repositorio de resultados</p>
        <strong>Indicadores, ecuaciones y microdatos de investigación</strong>
        <span>La ruta <code>/#/indicadores</code> concentra los resultados del periodo y su evidencia exportable.</span>
      </div>
      <div className="date-range">
        <label>Desde<input type="date" value={dateRange.start} max={dateRange.end} onChange={(event) => event.target.value && setDateRange((currentRange) => ({ ...currentRange, start: event.target.value }))} /></label>
        <label>Hasta<input type="date" value={dateRange.end} min={dateRange.start} onChange={(event) => event.target.value && setDateRange((currentRange) => ({ ...currentRange, end: event.target.value }))} /></label>
        <label>Serie<select value={grouping} onChange={(event) => setGrouping(event.target.value)}><option value="month">Mensual</option><option value="week">Semanal</option></select></label>
        <Button variant="secondary" onClick={() => setDateRange(availableRange)}>Todo el histórico</Button>
        <Button variant="secondary" onClick={() => exportPeriodRecords(dataset, dateRange)}>↓ Registros Excel</Button>
        <Button onClick={() => exportIndicatorsWorkbook(dataset, report, dateRange, grouping)}>↓ Libro de tesis</Button>
      </div>
    </section>

    <section className="metric-grid four">
      <Metric label="Unidades producidas" value={current.producedUnits} detail={`${current.plannedUnits} planificadas en el periodo`} tone="success" />
      <Metric label="Horas-hombre" value={`${formatIndicator(current.reportedHours)} h`} detail={`${operations.length} partes registrados`} />
      <Metric label="Actividades completadas" value={current.executedActivities} detail={`${current.programmedActivities} con avance en el periodo`} />
      <Metric label="Registros exportables" value={operations.length + progress.length + movements.length} detail="Partes, avances y movimientos" tone="success" />
    </section>

    <ProductivityDashboard report={report} />

    <section className="indicator-dashboard-grid">
      <article className="panel period-chart">
        <SectionHeader eyebrow="Evolución" title={`Unidades producidas por ${grouping === "month" ? "mes" : "semana"}`} detail="Cada barra usa los registros contenidos en el rango seleccionado." />
        <div className="series-bars">
          {series.map((item) => <div key={`${item.start}-${item.end}`} title={`${item.label}: ${item.producedUnits} unidades`}><span style={{ height: `${Math.max(5, (item.producedUnits / maxProduced) * 100)}%` }} /><b>{item.producedUnits}</b><small>{item.label}</small></div>)}
        </div>
      </article>
      <article className="panel equations-panel">
        <SectionHeader eyebrow="Trazabilidad metodológica" title="Ecuaciones aplicadas" detail="Las mismas definiciones se incorporan al libro Excel y al diccionario SPSS." />
        <div className="equation-list">
          <p><b>Cumplimiento PMP</b><span>Producidas ÷ planificadas × 100</span><strong>{formatIndicator(current.pmpCompliance, "%")}</strong></p>
          <p><b>Avance</b><span>Actividades ejecutadas ÷ programadas × 100</span><strong>{formatIndicator(current.progressRate, "%")}</strong></p>
          <p><b>Productividad laboral</b><span>Unidades producidas ÷ horas-hombre</span><strong>{formatIndicator(current.laborProductivity, " und/HH")}</strong></p>
          <p><b>Productividad multifactorial</b><span>Valor producido ÷ factores utilizados</span><strong>{formatIndicator(current.multifactorProductivity)}</strong></p>
        </div>
      </article>
    </section>

    <section className="panel records-panel">
      <SectionHeader eyebrow="Microdatos del periodo" title="Registros que sustentan los indicadores" detail="Selecciona una fuente para revisar los datos tal como se exportarán. El libro de tesis agrega también CECO, serie temporal y diccionario de variables." action={<span className="coverage-chip">Anterior: {formatIndicator(previous.pmpCompliance, "%")}</span>} />
      <div className="record-tabs">{Object.entries(recordLabels).map(([key, label]) => <button key={key} className={recordType === key ? "active" : ""} onClick={() => setRecordType(key)}>{label}<b>{records[key].length}</b></button>)}</div>
      <div className="table-scroll indicator-records-table">
        {recordType === "operations" && <table><thead><tr><th>Fecha</th><th>CECO</th><th>Trabajador</th><th>Actividad</th><th>Horas-hombre</th></tr></thead><tbody>{operations.map((item) => <tr key={item.id}><td>{item.date}</td><td><strong>{item.ceco}</strong></td><td>{item.worker}</td><td>{item.activity}</td><td>{item.totalHours}</td></tr>)}</tbody></table>}
        {recordType === "progress" && <table><thead><tr><th>CECO</th><th>Actividad</th><th>Estado</th><th>Avance</th><th>Inicio</th><th>Fin</th></tr></thead><tbody>{progress.map((item) => <tr key={item.id}><td><strong>{item.ceco}</strong></td><td>{dataset.stageActivities.find((activity) => activity.id === item.activityId)?.name ?? item.activityId}</td><td>{item.status}</td><td>{item.progress}%</td><td>{item.startedAt}</td><td>{item.finishedAt ?? "—"}</td></tr>)}</tbody></table>}
        {recordType === "movements" && <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Material</th><th>CECO</th><th>Cantidad</th><th>Nota</th></tr></thead><tbody>{movements.map((item) => <tr key={item.id}><td>{item.timestamp}</td><td><span className={`movement-type ${item.type}`}>{item.type}</span></td><td><strong>{item.code}</strong></td><td>{item.ceco || "—"}</td><td>{item.quantity}</td><td><small>{item.note}</small></td></tr>)}</tbody></table>}
        {records[recordType].length === 0 && <EmptyState text={`No hay ${recordLabels[recordType].toLowerCase()} en este rango.`} />}
      </div>
    </section>
  </div>;
}

function TwinView({ dataset, draft, setDraft, result, execute, onSavePriorities, simulationTime, dataReady }) {
  const [tab, setTab] = useState("capacity");
  const [calibInfo, setCalibInfo] = useState(null);
  const [adjustmentsReviewed, setAdjustmentsReviewed] = useState(false);

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

  function toggleMaterialAdjustment(materialCode) {
    setAdjustmentsReviewed(false);
    setDraft((current) => {
      const adjustments = current.materialAdjustments ?? [];
      const isSelected = adjustments.some((item) => item.materialCode === materialCode);
      return {
        ...current,
        materialAdjustments: isSelected
          ? adjustments.filter((item) => item.materialCode !== materialCode)
          : [...adjustments, { materialCode, stockAdjustment: 0 }]
      };
    });
  }

  function updateMaterialAdjustment(materialCode, stockAdjustment) {
    setAdjustmentsReviewed(false);
    setDraft((current) => ({
      ...current,
      materialAdjustments: (current.materialAdjustments ?? []).map((item) => (
        item.materialCode === materialCode ? { ...item, stockAdjustment } : item
      ))
    }));
  }

  function togglePriorityCeco(ceco) {
    setDraft((current) => ({
      ...current,
      priorityCecos: (current.priorityCecos ?? []).includes(ceco)
        ? current.priorityCecos.filter((item) => item !== ceco)
        : [...(current.priorityCecos ?? []), ceco],
      orderPriorityOverrides: (current.priorityCecos ?? []).includes(ceco)
        ? Object.fromEntries(Object.entries(current.orderPriorityOverrides ?? {}).filter(([item]) => item !== ceco))
        : { ...(current.orderPriorityOverrides ?? {}), [ceco]: Number(dataset.orders.find((item) => item.ceco === ceco)?.priority ?? 1) }
    }));
  }

  function updatePriorityCeco(ceco, priority) {
    setDraft((current) => {
      return { ...current, orderPriorityOverrides: { ...(current.orderPriorityOverrides ?? {}), [ceco]: priority === "" ? "" : Number(priority) } };
    });
  }

  const materialAdjustmentErrors = (draft.materialAdjustments ?? []).flatMap((adjustment) => {
    const material = dataset.inventory.find((item) => item.code === adjustment.materialCode);
    const amount = Number(adjustment.stockAdjustment);
    if (adjustment.stockAdjustment === "" || !Number.isFinite(amount)) return [`${adjustment.materialCode}: ingresa un número válido.`];
    if (material && Number(material.physical) + amount < 0) return [`${adjustment.materialCode}: el ajuste dejaría el físico por debajo de cero.`];
    return [];
  });
  const priorityValues = (draft.priorityCecos ?? []).map((ceco) => ({ ceco, priority: Number(draft.orderPriorityOverrides?.[ceco]) }));
  const priorityErrors = priorityValues.flatMap(({ ceco, priority }, index, values) => {
    if (!Number.isInteger(priority) || priority < 1) return [`CECO ${ceco}: usa un orden entero mayor que cero.`];
    if (values.filter((item) => item.priority === priority).length > 1) return [`CECO ${ceco}: el orden ${priority} está repetido.`];
    return [];
  });
  const canExecute = dataReady && materialAdjustmentErrors.length === 0 && priorityErrors.length === 0 && (!(draft.materialAdjustments ?? []).length || adjustmentsReviewed);

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

        <div className="field-group multi-scenario-field">
          <span>Ajuste extraordinario de material</span>
          <div className="multi-picker" role="group" aria-label="Materiales para ajuste extraordinario">
            {dataset.inventory.map((item) => <label key={item.code}><input type="checkbox" checked={(draft.materialAdjustments ?? []).some((adjustment) => adjustment.materialCode === item.code)} onChange={() => toggleMaterialAdjustment(item.code)} /><span><strong>{item.code}</strong><small>{item.description}</small></span></label>)}
          </div>
          <small>Seleccione uno o varios materiales. Use un valor positivo para un ingreso y negativo para una pérdida simulada. No altera el inventario real.</small>
          {(draft.materialAdjustments ?? []).length > 0 && <div className="scenario-selection-list material-adjustment-list">
            {draft.materialAdjustments.map((adjustment) => {
              const material = dataset.inventory.find((item) => item.code === adjustment.materialCode);
              return <div key={adjustment.materialCode}>
                <span><strong>{adjustment.materialCode}</strong><small>{material?.description}</small></span>
                <input aria-label={`Ajuste de stock para ${adjustment.materialCode}`} type="number" value={adjustment.stockAdjustment} onChange={(event) => updateMaterialAdjustment(adjustment.materialCode, event.target.value)} />
              </div>;
            })}
          </div>}
          {(draft.materialAdjustments ?? []).length > 0 && <div className="scenario-review">
            <strong>Revisión antes de aplicar al escenario</strong>
            {materialAdjustmentErrors.length > 0 ? <small className="form-error">{materialAdjustmentErrors.join(" ")}</small> : <small>{draft.materialAdjustments.map((item) => `${item.materialCode} ${Number(item.stockAdjustment) > 0 ? "+" : ""}${item.stockAdjustment}`).join(" · ")}</small>}
            <button type="button" className="text-button" disabled={materialAdjustmentErrors.length > 0} onClick={() => setAdjustmentsReviewed(true)}>{adjustmentsReviewed ? "Ajustes revisados" : "Revisar y aplicar al escenario"}</button>
          </div>}
        </div>

        <div className="field-group multi-scenario-field">
          <span>Prioridades de CECO en cola</span>
          <div className="multi-picker" role="group" aria-label="CECO prioritarios en cola">
            {activeOrders.map((order) => <label key={order.ceco}><input type="checkbox" checked={(draft.priorityCecos ?? []).includes(order.ceco)} onChange={() => togglePriorityCeco(order.ceco)} /><span><strong>CECO {order.ceco}</strong><small>{productOf(dataset, order.bodyTypeId)?.name}</small></span></label>)}
          </div>
          <small>Seleccione varios CECO y asigne el orden exacto de cada uno. Se aceptan órdenes no consecutivos, por ejemplo 1, 12 y 3.</small>
          {(draft.priorityCecos ?? []).length > 0 && <div className="scenario-selection-list priority-order-list">
            {draft.priorityCecos.map((ceco) => {
              const order = activeOrders.find((item) => item.ceco === ceco);
              return <div key={ceco}>
                <span><strong>CECO {ceco}</strong><small>{productOf(dataset, order?.bodyTypeId)?.name}</small></span>
                <input aria-label={`Prioridad de CECO ${ceco}`} type="number" min="1" step="1" value={draft.orderPriorityOverrides?.[ceco] ?? order?.priority ?? ""} onChange={(event) => updatePriorityCeco(ceco, event.target.value)} />
              </div>;
            })}
          </div>}
          {priorityErrors.length > 0 && <small className="form-error">{priorityErrors.join(" ")}</small>}
          {(draft.priorityCecos ?? []).length > 0 && <button type="button" className="text-button" disabled={priorityErrors.length > 0} onClick={() => onSavePriorities(priorityValues)}>Guardar prioridades reales</button>}
        </div>
      </div>

      <Button onClick={execute} disabled={!canExecute}>{dataReady ? "Ejecutar simulación gemela" : "Esperando datos…"}</Button>
      <p className="run-stamp">{simulationTime}</p>
    </aside>

    <div className="simulation-results stack-lg">
      {!result && <section className="panel"><EmptyState text={`Ejecuta el escenario para calcularlo con ${twinEngineLabel.toLowerCase()}.`} /></section>}
      {result && <>
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
            <button className={tab === "demand" ? "active" : ""} onClick={() => setTab("demand")}>Demanda y productos</button>
            <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>Parámetros por orden CECO</button>
            <button className={tab === "calibration" ? "active" : ""} onClick={() => setTab("calibration")}>Calibración Supabase</button>
            <button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")}>Supuestos</button>
          </div>

          {tab === "capacity" && <CapacityChart rows={result.scenario.stageCapacity} bottleneck={result.scenario.bottleneck} />}
          {tab === "materials" && <MaterialSimulation rows={result.scenario.materials} />}
          {tab === "demand" && <DemandSimulation insights={result.scenario.demandInsights} />}
          
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

          {tab === "calibration" && !result.calibration && <EmptyState text="No hay suficientes registros históricos comparables para recalibrar el modelo sin suposiciones." />}
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
  return <div className="chart-block"><div className="chart-summary"><div><span>Mayor carga proyectada</span><strong>{bottleneck}</strong></div><p>La carga se calcula con los CECO que aún recorren cada fase y la capacidad disponible del período.</p></div><div className="capacity-list">{rows.map((row) => <article key={row.stageId}><div className="capacity-label"><strong>{row.name}</strong><span>{row.demandHours} h requeridas / {row.availableHours} h disponibles · {row.period}</span></div><div className="bar-track"><span style={{ width: `${Math.min(100, row.utilization)}%`, background: row.utilization > 100 ? "#dc2626" : row.color }} /></div><b className={row.utilization > 100 ? "over" : ""}>{row.utilization}%</b>{(row.orders ?? []).length > 0 && <small>CECO: {(row.orders ?? []).map((item) => `${item.ceco} (${item.hours} h)`).join(" · ")}</small>}</article>)}</div></div>;
}

function MaterialSimulation({ rows }) {
  return <div className="table-scroll"><table><thead><tr><th>Material</th><th>Demanda real</th><th>Físico / mínimo</th><th>Consumo proyectado</th><th>Riesgo y reposición</th><th>Origen</th></tr></thead><tbody>{rows.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.demand?.records ? <><strong>{item.demand.day} / {item.demand.week} / {item.demand.month}</strong><small>día / 7 días / 30 días · salidas y consumos registrados</small></> : <small>Sin movimientos de salida o consumo fechados.</small>}</td><td><strong>{item.physical} {item.unit}</strong><small>Disponible {item.available} · mínimo {item.safety}</small></td><td><strong>{item.required} {item.unit}</strong><small>Saldo al cierre: {item.projected} {item.unit}</small></td><td><span className={`stock-label ${item.tone}`}>{item.tone === "danger" ? "Quiebre" : item.tone === "warning" ? "Bajo mínimo" : "Cubierto"}</span>{item.firstRisk && <small>{item.firstRisk.date} · {item.suggestedReplenishment == null ? "Falta plazo de abastecimiento" : `reponer ${item.suggestedReplenishment} ${item.unit}`}</small>}</td><td>{(item.requirements ?? []).length ? <small>{(item.requirements ?? []).map((need) => `CECO ${need.ceco}: ${need.quantity} en ${need.stage}`).join(" · ")}</small> : <small>Sin consumo pendiente identificado en BOM/ruta.</small>}</td></tr>)}</tbody></table></div>;
}

function DemandSimulation({ insights }) {
  const products = insights?.products;
  return <div className="stack-lg"><section className="panel"><SectionHeader eyebrow="Historial disponible" title="Productos más solicitados y tendencia" detail={products?.available ? products.reference : "No hay pedidos cerrados con una fecha utilizable; no se muestra una tendencia inventada."} />{products?.available ? <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Pedidos cerrados</th><th>Últimos 30 días del historial</th><th>Período anterior</th><th>Tendencia</th></tr></thead><tbody>{products.rows.map((item) => <tr key={item.productId}><td><strong>{item.product}</strong></td><td>{item.completed}</td><td>{item.recent}</td><td>{item.previous}</td><td>{item.trend}</td></tr>)}</tbody></table></div> : <EmptyState text="Registra pedidos cerrados con fecha para habilitar este reporte." />}</section><section className="panel"><SectionHeader eyebrow="Cómo leer la demanda" title="Fuente y límites del dato" detail="La demanda de materiales se muestra por día, 7 días y 30 días solo cuando existen movimientos de salida o consumo. La proyección futura usa CECO abiertos, su ruta y los materiales registrados en el BOM o en sus reservas." /></section></div>;
}

function SimulationAlerts({ notifications }) {
  const critical = notifications.filter((item) => item.severity === "critical").length;
  return <section className="panel alert-center">
    <SectionHeader eyebrow="Alertas accionables" title="Situaciones previstas" action={<span className={`alert-count ${critical ? "critical" : "ok"}`}>{critical ? `${critical} críticas` : "Sin críticas"}</span>} />
    <div className="alert-list">
      {notifications.length === 0 && <EmptyState text="Los indicadores se mantienen dentro de los umbrales configurados." />}
      {notifications.slice(0, 8).map((alert) => <article className={alert.severity} key={alert.id}>
        <div className="alert-symbol">{alert.severity === "critical" ? "!" : "△"}</div>
        <div className="alert-content"><div><span>{alert.category}</span><strong>{alert.title}</strong></div><p><b>Situación:</b> {alert.situation}</p><p><b>Cuándo:</b> {alert.period}</p><p><b>Por qué:</b> {alert.reason}</p>{alert.affected.length > 0 && <small><b>Afectados:</b> {alert.affected.join(" · ")}</small>}<p><b>Acción recomendada:</b> {alert.recommendedAction}</p><code>{alert.calculation}</code></div>
        <b>{alert.value}</b>
      </article>)}
    </div>
  </section>;
}

function OrdersView({ dataset, activeDrawer, openDrawer, advanceOrder, onMoveOrder, onProgress, onSchedule, onUpdateOrder, onDeleteOrder, onCreateQuality }) {
  const [mode, setMode] = useState("kanban");
  const [selectedOrder, setSelectedOrder] = useState(null);
  async function updateOrder(ceco, patch) {
    const updated = await onUpdateOrder(ceco, patch);
    if (patch.ceco && patch.ceco !== ceco) setSelectedOrder(updated?.orders.find((item) => item.ceco === patch.ceco) ?? null);
    return updated;
  }
  async function deleteOrder(ceco) {
    await onDeleteOrder(ceco);
    setSelectedOrder(null);
  }
  return <div className="stack-lg">
    <PageActions><div className="view-switch" aria-label="Modo de visualización de órdenes"><button className={mode === "kanban" ? "active" : ""} onClick={() => setMode("kanban")}>▦ Kanban</button><button className={mode === "gantt" ? "active" : ""} onClick={() => setMode("gantt")}>▤ Cronograma PMP</button><button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>☷ Lista</button><button className={mode === "customers" ? "active" : ""} onClick={() => setMode("customers")}>◎ Clientes</button></div><Button onClick={() => openDrawer({ type: "order" })}>+ Nueva orden CECO</Button></PageActions>
    {mode === "kanban" && <ProductKanban dataset={dataset} onSelect={setSelectedOrder} onMoveOrder={onMoveOrder} />}
    {mode === "gantt" && <ProductionGantt dataset={dataset} onSelect={setSelectedOrder} onSchedule={onSchedule} />}
    {mode === "list" && <><ProductList dataset={dataset} onSelect={setSelectedOrder} onUpdateOrder={updateOrder} onDeleteOrder={deleteOrder} /><ExecutionPanel dataset={dataset} openDrawer={openDrawer} /></>}
    {mode === "customers" && <CustomerCatalog dataset={dataset} openDrawer={openDrawer} />}
    <ProductFlowDrawer dataset={dataset} order={selectedOrder} activeDrawer={activeDrawer} onClose={() => setSelectedOrder(null)} openDrawer={openDrawer} onProgress={onProgress} onUpdateOrder={updateOrder} onCreateQuality={onCreateQuality} />
  </div>;
}

function ExcelActions({ onImport, onExport, onBulkTemplate, label }) {
  const inputRef = useRef(null);
  return <div className="excel-actions"><input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /><Button variant="secondary" onClick={() => inputRef.current?.click()}>Importar Excel</Button><Button variant="secondary" onClick={onExport}>Exportar Excel</Button>{onBulkTemplate ? <Button variant="secondary" onClick={onBulkTemplate}>Plantilla carga masiva</Button> : <a className="button secondary" href="/plantillas/plantilla-materiales-productos.xlsx" download>Plantilla {label}</a>}</div>;
}

function BulkExcelImportButton({ onImport }) {
  const inputRef = useRef(null);
  return <><input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} /><Button onClick={() => inputRef.current?.click()}>Cargar Excel masivo</Button></>;
}

function ProductsView({ dataset, openDrawer, onImportExcel, onExportExcel, onQuickAssign, onUpdateBom, onDeleteBom }) {
  const [productId, setProductId] = useState(dataset.bodyTypes[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [quickAssignOpen, setQuickAssignOpen] = useState(false);
  const product = productOf(dataset, productId);
  const materials = dataset.bom.filter((item) => item.bodyTypeId === productId);
  const requirementsByStage = materialRequirementsByStage(productId, dataset.bom);
  const filteredProducts = dataset.bodyTypes.filter((item) => `${item.code} ${item.name} ${item.family}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="stack-lg">
    <PageActions><div><strong>{dataset.bodyTypes.length} plantillas de producto</strong><span>Una plantilla define la ruta y BOM; las órdenes son quienes recorren el flujo.</span></div><div className="section-actions"><ExcelActions onImport={onImportExcel} onExport={onExportExcel} onBulkTemplate={() => downloadBulkImportWorkbook(dataset)} label="productos" /><Button onClick={() => openDrawer({ type: "product" })}>+ Producto maestro</Button></div></PageActions>
    <p className="excel-import-hint">¿Son varios productos, fases y materiales? Descarga la plantilla de carga masiva, llena una fila por material y fase, y luego impórtala aquí.</p>
    <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, código o familia" /></div>
    <section className="template-grid">{filteredProducts.map((item) => <button key={item.id} className={`panel template-card ${item.id === productId ? "selected" : ""}`} onClick={() => { setProductId(item.id); setQuickAssignOpen(false); }}><span>{item.code}</span><strong>{item.name}</strong><small>{item.family} · {item.targetDays} días</small><div>{item.route.map((stageId) => <i key={stageId} title={stageOf(dataset, stageId)?.name} style={{ background: stageOf(dataset, stageId)?.color }} />)}</div><b>{dataset.bom.filter((piece) => piece.bodyTypeId === item.id).length} materiales</b></button>)}</section>
    {product && <section className="panel template-detail"><SectionHeader eyebrow="Plantilla seleccionada" title={`${product.code} · ${product.name}`} detail={`${product.route.length} fases · ${materials.length} componentes BOM`} action={<div className="section-actions"><Button variant="secondary" onClick={() => openDrawer({ type: "product", product })}>Editar plantilla</Button><BulkExcelImportButton onImport={onImportExcel} /><Button variant="secondary" onClick={() => setQuickAssignOpen((current) => !current)}>{quickAssignOpen ? "Cerrar asignación rápida" : "Asignar varios materiales"}</Button><Button variant="secondary" onClick={() => openDrawer({ type: "bom", productId })}>+ Material BOM</Button></div>} /><p className="template-excel-hint">Para varios productos, fases y materiales: carga aquí el Excel de la plantilla masiva. La aplicación crea o actualiza las rutas, los materiales y la BOM.</p><div className="template-route">{product.route.map((stageId, index) => <span key={stageId}><b>{index + 1}</b>{stageOf(dataset, stageId)?.name}</span>)}</div>{quickAssignOpen && <QuickBomAssignment key={product.id} product={product} dataset={dataset} onSave={onQuickAssign} onClose={() => setQuickAssignOpen(false)} />}<MaterialRequirementsByStage product={product} dataset={dataset} requirements={requirementsByStage} /><MaterialRequirementManager materials={materials} dataset={dataset} onUpdate={onUpdateBom} onDelete={onDeleteBom} /></section>}
  </div>;
}

function CustomerCatalog({ dataset, openDrawer }) {
  const [search, setSearch] = useState("");
  const filteredCustomers = dataset.customers.filter((customer) => `${customer.name} ${customer.documentNumber ?? ""} ${customer.contactName ?? ""} ${customer.phone ?? ""} ${customer.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="panel"><SectionHeader eyebrow="Maestro comercial" title="Clientes" detail="El cliente se mantiene una vez y luego se selecciona en cada orden." action={<Button onClick={() => openDrawer({ type: "customer" })}>+ Nuevo cliente</Button>} /><div className="search-box catalog-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, RUC, contacto, teléfono o correo" /></div><div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Teléfono / correo</th><th>Órdenes</th><th></th></tr></thead><tbody>{filteredCustomers.map((customer) => <tr key={customer.id}><td><strong>{customer.name}</strong></td><td>{customer.documentNumber || "—"}</td><td>{customer.contactName || "—"}</td><td>{customer.phone || "—"}<small>{customer.email}</small></td><td>{dataset.orders.filter((order) => order.customerId === customer.id).length}</td><td><button className="row-action" onClick={() => openDrawer({ type: "customer", customer })}>Editar</button></td></tr>)}</tbody></table></div></section>;
}

function activityProgressOf(dataset, ceco, activityId) {
  return (dataset.activityProgress ?? []).find((item) => item.ceco === ceco && item.activityId === activityId) ?? { status: "pending", progress: 0, startedAt: null, finishedAt: null };
}

function currentActivity(dataset, order) {
  const activities = dataset.stageActivities.filter((item) => item.stageId === order.stageId).sort((a, b) => a.sequence - b.sequence);
  return activities.find((activity) => ["in_progress", "blocked"].includes(activityProgressOf(dataset, order.ceco, activity.id).status)) ?? activities.find((activity) => activityProgressOf(dataset, order.ceco, activity.id).status === "pending") ?? activities.at(-1);
}

function ProductionGantt({ dataset, onSelect, onSchedule }) {
  const activeOrders = newestOrders(dataset.orders.filter((order) => order.active !== false && Number(order.progress) < 100));
  const [ceco, setCeco] = useState(activeOrders[0]?.ceco ?? dataset.orders[0]?.ceco ?? "");
  const [editingRow, setEditingRow] = useState(null);
  const order = dataset.orders.find((item) => item.ceco === ceco) ?? activeOrders[0] ?? dataset.orders[0];
  const product = productOf(dataset, order?.bodyTypeId);

  useEffect(() => {
    if (!order && activeOrders[0]) setCeco(activeOrders[0].ceco);
  }, [order, activeOrders]);

  if (!order || !product) return <EmptyState text="Registra una orden CECO para visualizar su cronograma PMP." />;

  const plannedStart = pmpStartOf(order, product);
  const plannedEnd = order.dueDate || addDays(plannedStart, Math.max(0, Number(product.targetDays || 1) - 1));
  const route = product.route.map((stageId) => ({ stage: stageOf(dataset, stageId), activities: dataset.stageActivities.filter((activity) => activity.stageId === stageId && activity.active !== false).sort((a, b) => a.sequence - b.sequence) })).filter((item) => item.stage);
  const totalMinutes = route.reduce((sum, item) => sum + Math.max(1, item.activities.reduce((stageMinutes, activity) => stageMinutes + Number(activity.standardMinutes || 0), 0) || Number(item.stage.standardHours || 1) * 60), 0);
  const plannedDays = Math.max(1, daysBetween(plannedStart, plannedEnd) + 1);
  let accumulatedMinutes = 0;
  const rows = route.flatMap(({ stage, activities }) => {
    const stageMinutes = Math.max(1, activities.reduce((sum, activity) => sum + Number(activity.standardMinutes || 0), 0) || Number(stage.standardHours || 1) * 60);
    const stageStart = addDays(plannedStart, Math.floor((accumulatedMinutes / totalMinutes) * plannedDays));
    accumulatedMinutes += stageMinutes;
    const stageEnd = addDays(plannedStart, Math.max(0, Math.ceil((accumulatedMinutes / totalMinutes) * plannedDays) - 1));
    let activityMinutes = accumulatedMinutes - stageMinutes;
    const activityRows = activities.map((activity) => {
      const progress = activityProgressOf(dataset, order.ceco, activity.id);
      const assignmentDates = dataset.assignments.filter((item) => item.ceco === order.ceco && item.activityId === activity.id).map((item) => item.assignedDate).filter(Boolean).sort();
      const baseStart = addDays(plannedStart, Math.floor((activityMinutes / totalMinutes) * plannedDays));
      activityMinutes += Number(activity.standardMinutes || 0);
      const baseEnd = addDays(plannedStart, Math.max(0, Math.ceil((activityMinutes / totalMinutes) * plannedDays) - 1));
      const scheduleStart = progress.plannedStartDate || assignmentDates[0] || baseStart;
      const scheduleEnd = progress.plannedEndDate || (assignmentDates.length ? assignmentDates.at(-1) : baseEnd);
      return { type: "activity", id: activity.id, label: activity.name, stage, progress, plannedStart: scheduleStart, plannedEnd: scheduleEnd, actualStart: progress.startedAt?.slice(0, 10), actualEnd: progress.finishedAt?.slice(0, 10) || (progress.status === "in_progress" || progress.status === "blocked" ? dateKey(new Date()) : null) };
    });
    const completed = activityRows.filter((item) => item.progress.status === "completed").length;
    const actualStarts = activityRows.map((item) => item.actualStart).filter(Boolean).sort();
    const actualEnds = activityRows.map((item) => item.actualEnd).filter(Boolean).sort();
    const plannedStarts = activityRows.map((item) => item.plannedStart).filter(Boolean).sort();
    const plannedEnds = activityRows.map((item) => item.plannedEnd).filter(Boolean).sort();
    return [{ type: "stage", id: stage.id, label: `${stage.shortName} · ${stage.name}`, stage, progress: { progress: activities.length ? Math.round(activityRows.reduce((sum, item) => sum + Number(item.progress.progress), 0) / activities.length) : 0, status: completed === activities.length && activities.length ? "completed" : stage.id === order.stageId ? "in_progress" : "pending" }, plannedStart: plannedStarts[0] || stageStart, plannedEnd: plannedEnds.at(-1) || stageEnd, actualStart: actualStarts[0], actualEnd: actualEnds.at(-1) }, ...activityRows];
  });

  async function saveSchedule(row, nextStart, nextEnd) {
    if (!nextStart || !nextEnd || nextStart > nextEnd) return;
    const rowIndex = rows.findIndex((item) => item.type === row.type && item.id === row.id);
    const extensionDays = daysBetween(row.plannedEnd, nextEnd);
    let entries = [];
    if (row.type === "stage") {
      const stageActivities = rows.filter((item) => item.type === "activity" && item.stage.id === row.stage.id);
      const totalMinutes = Math.max(1, stageActivities.reduce((sum, item) => sum + Number(dataset.stageActivities.find((activity) => activity.id === item.id)?.standardMinutes || 0), 0));
      const stageDays = Math.max(1, daysBetween(nextStart, nextEnd) + 1);
      let elapsed = 0;
      entries = stageActivities.map((item) => {
        const minutes = Number(dataset.stageActivities.find((activity) => activity.id === item.id)?.standardMinutes || 0);
        const start = addDays(nextStart, Math.floor((elapsed / totalMinutes) * stageDays));
        elapsed += minutes;
        const end = addDays(nextStart, Math.max(0, Math.ceil((elapsed / totalMinutes) * stageDays) - 1));
        return { activityId: item.id, plannedStartDate: start, plannedEndDate: end, id: item.progress.id };
      });
    } else {
      entries = [{ activityId: row.id, plannedStartDate: nextStart, plannedEndDate: nextEnd, id: row.progress.id }];
    }
    const followingActivities = rows.slice(rowIndex + 1).filter((item) => item.type === "activity" && (row.type !== "stage" || item.stage.id !== row.stage.id));
    if (extensionDays > 0 && followingActivities.length > 0) {
      const moveFollowing = window.confirm(`Esta edición alarga ${row.type === "stage" ? "la fase" : "la actividad"} ${extensionDays} día(s). ¿Deseas desplazar las ${followingActivities.length} actividades posteriores para conservar el flujo?`);
      if (moveFollowing) entries.push(...followingActivities.map((item) => ({ activityId: item.id, plannedStartDate: addDays(item.plannedStart, extensionDays), plannedEndDate: addDays(item.plannedEnd, extensionDays), id: item.progress.id })));
    }
    await onSchedule(order.ceco, entries);
    setEditingRow(null);
  }
  const today = dateKey(new Date());
  const timelineStart = [plannedStart, ...rows.map((row) => row.actualStart).filter(Boolean)].sort()[0];
  const timelineEnd = [plannedEnd, today, ...rows.map((row) => row.actualEnd).filter(Boolean)].sort().at(-1);
  const days = Array.from({ length: Math.min(180, Math.max(1, daysBetween(timelineStart, timelineEnd) + 1)) }, (_, index) => addDays(timelineStart, index));
  const rangeDays = Math.max(1, days.length);
  const left = (date) => Math.max(0, Math.min(100, (daysBetween(timelineStart, date) / rangeDays) * 100));
  const width = (from, to) => Math.max(1.8, Math.min(100, ((Math.max(0, daysBetween(from, to)) + 1) / rangeDays) * 100));
  const plannedProgress = Math.max(0, Math.min(100, (daysBetween(plannedStart, today) + 1) / plannedDays * 100));
  const variance = Math.round(Number(order.progress) - plannedProgress);
  const todayLeft = left(today);

  return <section className="panel gantt-panel">
    <SectionHeader eyebrow="Plan maestro de producción" title="Cronograma Gantt por fase y actividad" detail="La programación nace en el inicio PMP; los partes y avances registrados muestran la ejecución real." action={<div className="gantt-actions"><select value={order.ceco} onChange={(event) => setCeco(event.target.value)} aria-label="Orden CECO para el cronograma">{(activeOrders.length ? activeOrders : dataset.orders).map((item) => <option key={item.ceco} value={item.ceco}>CECO {item.ceco} · {productOf(dataset, item.bodyTypeId)?.name}</option>)}</select><Button variant="secondary" onClick={() => onSelect(order)}>Abrir CECO</Button></div>} />
    <div className="gantt-summary"><div><span>Inicio PMP</span><strong>{formatDate(plannedStart)}</strong><small>Base del plan de esta orden</small></div><div><span>Entrega comprometida</span><strong>{formatDate(plannedEnd)}</strong><small>{plannedDays} días programados</small></div><div><span>Avance real</span><strong>{order.progress}%</strong><small>{currentActivity(dataset, order)?.name ?? "Sin actividad en curso"}</small></div><div className={variance < 0 ? "at-risk" : "on-track"}><span>Desviación PMP</span><strong>{variance > 0 ? "+" : ""}{variance} pp</strong><small>Plan al día: {Math.round(plannedProgress)}%</small></div></div>
    <div className="gantt-legend"><span><i className="planned" /> Plan PMP</span><span><i className="actual" /> Ejecución real / avance</span><span><i className="today" /> Hoy</span><span>Usa ✎ para asignar fechas a cada fase o actividad.</span></div>
    {editingRow && <GanttScheduleEditor row={rows.find((item) => item.type === editingRow.type && item.id === editingRow.id)} onCancel={() => setEditingRow(null)} onSave={saveSchedule} />}
    <div className="gantt-scroll"><div className="gantt-grid" style={{ "--gantt-days": rangeDays }}><div className="gantt-label gantt-head-label">Fase / actividad</div><div className="gantt-days">{days.map((day, index) => <div className={dateFrom(day).getDay() === 0 || dateFrom(day).getDay() === 6 ? "weekend" : ""} key={day}><b>{dateFrom(day).getDate()}</b>{index === 0 || dateFrom(days[index - 1]).getMonth() !== dateFrom(day).getMonth() ? <small>{new Intl.DateTimeFormat("es-PE", { month: "short" }).format(dateFrom(day))}</small> : null}</div>)}</div>{rows.map((row) => <React.Fragment key={`${row.type}-${row.id}`}><div className={`gantt-label ${row.type}`}><i style={{ background: row.stage.color }} /> <span>{row.label}</span>{row.type === "activity" && <small>{row.progress.progress}%</small>}<button className="gantt-edit" onClick={() => setEditingRow({ type: row.type, id: row.id })} aria-label={`Editar fechas de ${row.label}`}>✎</button></div><div className={`gantt-track ${row.type}`}><span className="gantt-plan" style={{ left: `${left(row.plannedStart)}%`, width: `${width(row.plannedStart, row.plannedEnd)}%`, "--stage-color": row.stage.color }} />{row.actualStart && <span className={`gantt-actual ${row.progress.status}`} style={{ left: `${left(row.actualStart)}%`, width: `${width(row.actualStart, row.actualEnd || row.actualStart)}%`, "--stage-color": row.stage.color }}><i style={{ width: `${row.progress.progress}%` }} /></span>}<b className="gantt-today" style={{ left: `${todayLeft}%` }} aria-label="Hoy" /></div></React.Fragment>)}</div></div>
  </section>;
}

function GanttScheduleEditor({ row, onCancel, onSave }) {
  const [start, setStart] = useState(row?.plannedStart ?? "");
  const [end, setEnd] = useState(row?.plannedEnd ?? "");
  useEffect(() => { setStart(row?.plannedStart ?? ""); setEnd(row?.plannedEnd ?? ""); }, [row?.id, row?.type, row?.plannedStart, row?.plannedEnd]);
  if (!row) return null;
  const invalid = !start || !end || start > end;
  return <form className="gantt-schedule-editor" onSubmit={(event) => { event.preventDefault(); if (!invalid) onSave(row, start, end); }}><div><p className="eyebrow">Editar programación</p><strong>{row.type === "stage" ? "Fase" : "Actividad"}: {row.label}</strong><small>Si la fecha final se extiende, podrás elegir si se desplazan las actividades posteriores.</small></div><label>Inicio<input type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} required /></label><label>Fin<input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} required /></label><Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={invalid}>Guardar fechas</Button></form>;
}

function ProductKanban({ dataset, onSelect, onMoveOrder }) {
  const boardRef = useRef(null);
  const dragRef = useRef(null);
  function startScroll(event) {
    if (event.button !== 0 || event.target.closest(".product-work-card")) return;
    dragRef.current = { x: event.clientX, scrollLeft: boardRef.current.scrollLeft };
    boardRef.current.setPointerCapture(event.pointerId);
    boardRef.current.classList.add("is-dragging");
  }
  function moveScroll(event) {
    if (!dragRef.current) return;
    boardRef.current.scrollLeft = dragRef.current.scrollLeft - (event.clientX - dragRef.current.x);
  }
  function stopScroll() {
    dragRef.current = null;
    boardRef.current?.classList.remove("is-dragging");
  }
  return <div ref={boardRef} className="product-kanban" aria-label="Órdenes por fase" onPointerDown={startScroll} onPointerMove={moveScroll} onPointerUp={stopScroll} onPointerCancel={stopScroll}>
    {byOrder(dataset).map((stage) => {
      const orders = newestOrders(dataset.orders.filter((order) => order.active !== false && order.stageId === stage.id && Number(order.progress) < 100));
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

function ProductList({ dataset, onSelect, onUpdateOrder, onDeleteOrder }) {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const visibleOrders = newestOrders(dataset.orders.filter((order) => {
    const active = order.active !== false;
    const matchesSearch = orderLabel(dataset, order).toLowerCase().includes(search.trim().toLowerCase());
    return matchesSearch && (showInactive ? true : active && Number(order.progress) < 100);
  }));
  function deactivate(order) {
    if (window.confirm(`¿Desactivar el CECO ${order.ceco}? Dejará de mostrarse en Producción hasta que actives el filtro de inactivos.`)) onUpdateOrder(order.ceco, { active: false });
  }
  function remove(order) {
    if (window.confirm(`¿Eliminar definitivamente el CECO ${order.ceco}? Esta acción también eliminará sus registros operativos vinculados y no se puede deshacer.`)) onDeleteOrder(order.ceco);
  }
  return <section className="panel"><SectionHeader eyebrow="Productos en planta" title={showInactive ? "Lista de CECO" : "Lista de CECO activos"} detail="Los CECO recién creados aparecen primero. Los inactivos no se muestran hasta activar el filtro." action={<label className="filter-check"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Ver inactivos</label>} /><div className="search-box catalog-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar CECO, producto o cliente" /></div><div className="table-scroll"><table><thead><tr><th>CECO / producto</th><th>Cliente</th><th>Fase</th><th>Actividad actual</th><th>Actividades</th><th>Avance CECO</th><th>Entrega</th><th>Estado</th><th></th></tr></thead><tbody>{visibleOrders.map((order) => { const stageActivities = dataset.stageActivities.filter((item) => item.stageId === order.stageId); const completed = stageActivities.filter((item) => activityProgressOf(dataset, order.ceco, item.id).status === "completed").length; const execution = calculateCecoProgress(order, dataset.bodyTypes, dataset.stageActivities, dataset.activityProgress); return <tr key={order.ceco} className={order.active === false ? "inactive-row" : ""}><td><strong>CECO {order.ceco}</strong><small>{productOf(dataset, order.bodyTypeId)?.name}</small></td><td>{order.customer}<small>{order.line}</small></td><td><span className="stage-tag"><i style={{ background: stageOf(dataset, order.stageId)?.color }} />{stageOf(dataset, order.stageId)?.name}</span></td><td>{currentActivity(dataset, order)?.name ?? "Sin actividad"}</td><td><strong>{completed} / {stageActivities.length}</strong><small>Fase actual</small></td><td><strong>{execution.progress}%</strong><small>{execution.stages.filter((item) => item.progress === 100).length}/{execution.stages.length} fases completas</small></td><td>{formatDate(order.dueDate)}</td><td>{order.active === false ? <span className="inactive-pill">Inactivo</span> : <StatusPill status={order.status} />}</td><td><div className="row-actions"><button className="row-action" onClick={() => onSelect(order)}>Ver detalle</button>{order.active === false ? <button className="row-action" onClick={() => onUpdateOrder(order.ceco, { active: true })}>Activar</button> : <button className="row-action" onClick={() => deactivate(order)}>Desactivar</button>}<button className="row-action danger" onClick={() => remove(order)}>Eliminar</button></div></td></tr>; })}</tbody></table></div></section>;
}

function ProductFlowDrawer({ dataset, order, activeDrawer, onClose, openDrawer, onProgress, onUpdateOrder, onCreateQuality }) {
  usePageScrollLock(Boolean(order));
  if (!order) return null;
  const product = productOf(dataset, order.bodyTypeId);
  const stage = stageOf(dataset, order.stageId);
  const route = product?.route ?? [];
  const currentIndex = route.indexOf(order.stageId);
  const reservations = dataset.orderMaterialReservations.filter((item) => item.ceco === order.ceco).sort((a, b) => Number(b.stageId === order.stageId) - Number(a.stageId === order.stageId));
  const shortages = reservations.filter((item) => Number(item.reservedQuantity) < Number(item.requiredQuantity));
  const quality = dataset.quality.filter((item) => item.ceco === order.ceco);
  const execution = calculateCecoProgress(order, dataset.bodyTypes, dataset.stageActivities, dataset.activityProgress);
  const secondaryDrawerOpen = activeDrawer?.secondary && activeDrawer.ceco === order.ceco;
  const openSecondaryDrawer = (type) => openDrawer({ type, ceco: order.ceco, stageId: order.stageId, secondary: true });
  return <div className={`product-detail-backdrop ${secondaryDrawerOpen ? "with-secondary" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="product-detail-drawer" role="dialog" aria-modal="true" aria-label={`Detalle del CECO ${order.ceco}`}>
    <header><div><p className="eyebrow">Pasaporte productivo</p><h2>{product?.name}</h2><span>CECO {order.ceco}</span></div><button onClick={onClose} aria-label="Cerrar detalle">×</button></header>
    <div className="product-detail-body">
      <section className="detail-summary"><div><span>Cliente</span><strong>{order.customer}</strong></div><div><span>Fase actual</span><strong>{stage?.name}</strong></div><div><span>Avance CECO</span><strong>{execution.progress}%</strong></div><div><span>Inicio PMP</span><strong>{formatDate(pmpStartOf(order, product))}</strong></div><div><span>Entrega pactada</span><strong>{formatDate(order.dueDate)}</strong></div><div><span>Línea / prioridad</span><strong>{order.line} · P{order.priority}</strong></div></section>
      {shortages.length > 0 && <section className="material-blocker"><div><span>Bloqueado por material</span><strong>Faltan reservas para {shortages.length} material{shortages.length === 1 ? "" : "es"}</strong><p>{shortages.slice(0, 2).map((item) => `${item.materialCode}: faltan ${Math.max(0, Number(item.requiredQuantity) - Number(item.reservedQuantity))}`).join(" · ")}{shortages.length > 2 ? ` · y ${shortages.length - 2} más` : ""}</p></div><Button onClick={() => { const item = shortages[0]; openDrawer({ type: "movement", ceco: order.ceco, materialCode: item.materialCode, quantity: Math.max(0, Number(item.requiredQuantity) - Number(item.reservedQuantity)), quickReplenish: true, secondary: true }); }}>Reponer y reservar</Button></section>}
      <section className="order-command-bar"><div><span>Operación de la orden</span><strong>Registra con el CECO y su ruta ya seleccionados</strong></div><div><Button variant="secondary" onClick={() => openSecondaryDrawer("assignment")}>Asignar trabajador</Button><Button variant="secondary" onClick={() => openSecondaryDrawer("operation")}>Registrar horas</Button><Button onClick={() => openSecondaryDrawer("incident")}>Reportar incidencia</Button></div></section>
      <section className="detail-section"><SectionHeader eyebrow="Flujo completo" title="Ruta del producto" detail={`${route.length} fases configuradas para ${product?.name}.`} /><div className="drawer-route">{route.map((stageId, index) => { const routeStage = stageOf(dataset, stageId); const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "pending"; return <div className={state} key={stageId}><span>{state === "completed" ? "✓" : routeStage?.shortName}</span><p><strong>{routeStage?.name}</strong><small>{state === "completed" ? "Completada" : state === "current" ? "En proceso" : "Pendiente"}</small></p></div>; })}</div></section>
      <section className="detail-section"><SectionHeader eyebrow="Avance por etapa" title={`Actividades de la orden · ${execution.progress}% global`} detail="Cada fase tiene el mismo peso; dentro de ella se promedian las actividades activas." />{route.map((stageId) => <StageProgressEditor key={stageId} stage={stageOf(dataset, stageId)} activities={dataset.stageActivities.filter((item) => item.stageId === stageId && item.active !== false).sort((a, b) => a.sequence - b.sequence)} ceco={order.ceco} dataset={dataset} onProgress={onProgress} current={stageId === order.stageId} />)}</section>
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
  const stageProgress = activities.length ? Math.round((activities.reduce((sum, activity) => sum + Number(activityProgressOf(dataset, ceco, activity.id).progress), 0) / activities.length) * 100) / 100 : 0;
  return <details className="stage-progress-editor" open={current ? true : undefined}><summary><span style={{ background: stage?.color }}>{stage?.shortName}</span><strong>{stage?.name}</strong><small>{completed}/{activities.length} realizadas · {stageProgress}% etapa</small></summary>{activities.map((activity) => { const value = activityProgressOf(dataset, ceco, activity.id); const progress = progressDrafts[activity.id] ?? value.progress; return <div className="activity-control" key={activity.id}><label><input type="checkbox" checked={value.status === "completed"} onChange={(event) => { setProgressDrafts((current) => ({ ...current, [activity.id]: event.target.checked ? 100 : 0 })); onProgress(ceco, activity.id, { status: event.target.checked ? "completed" : "pending", progress: event.target.checked ? 100 : 0 }); }} /><span>{activity.name}</span></label><select aria-label={`Estado de ${activity.name}`} value={value.status} onChange={(event) => { const status = event.target.value; const nextProgress = status === "completed" ? 100 : status === "pending" ? 0 : progress; setProgressDrafts((current) => ({ ...current, [activity.id]: nextProgress })); onProgress(ceco, activity.id, { status, progress: nextProgress }); }}><option value="pending">Pendiente</option><option value="in_progress">En proceso</option><option value="blocked">Bloqueada</option><option value="completed">Completada</option></select><input aria-label={`Avance de ${activity.name}`} type="range" min="0" max="100" value={progress} onChange={(event) => setProgressDrafts((current) => ({ ...current, [activity.id]: Number(event.target.value) }))} onBlur={() => { if (progress !== value.progress) onProgress(ceco, activity.id, { progress, status: progress === 100 ? "completed" : progress > 0 ? "in_progress" : "pending" }); }} /><b>{progress}%</b></div>; })}</details>;
}

function MaterialRequirementsByStage({ product, dataset, requirements }) {
  if (!requirements.length) return <EmptyState text="Aún no hay materiales asignados a las fases de esta plantilla." />;
  return <section className="material-plan">
    <div className="material-plan-header"><div><p className="eyebrow">Abastecimiento por fase</p><h3>Material necesario para fabricar una unidad</h3><p>Las cantidades consolidan las piezas del BOM que se consumen en cada fase.</p></div><span>{requirements.length} materiales consolidados</span></div>
    <div className="material-plan-grid">{product.route.map((stageId, index) => {
      const stage = stageOf(dataset, stageId);
      const rows = requirements.filter((item) => item.stageId === stageId);
      return <article key={stageId} style={{ "--stage-color": stage?.color ?? "#64748b" }}><header><span>{index + 1}</span><div><strong>{stage?.name ?? "Fase sin nombre"}</strong><small>{rows.length ? `${rows.length} material${rows.length === 1 ? "" : "es"} requerido${rows.length === 1 ? "" : "s"}` : "Sin material asignado"}</small></div></header>{rows.length ? <ul>{rows.map((item) => { const material = dataset.inventory.find((entry) => entry.code === item.materialCode); return <li key={item.materialCode}><div><strong>{item.materialCode}</strong><small>{material?.description ?? item.pieces.map((piece) => piece.description).filter(Boolean).join(" · ")}</small></div><b>{item.quantity} {material?.unit ?? "und"}</b></li>; })}</ul> : <p className="material-plan-empty">No se requiere material directo en esta fase.</p>}</article>;
    })}</div>
  </section>;
}

function QuickBomAssignment({ product, dataset, onSave, onClose }) {
  const [stageId, setStageId] = useState(product.route[0] ?? "");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({});
  const stage = stageOf(dataset, stageId);
  const existing = new Map(dataset.bom.filter((item) => item.bodyTypeId === product.id && item.stageId === stageId).map((item) => [item.materialCode, item]));
  const materials = dataset.inventory.filter((item) => `${item.code} ${item.description} ${item.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = Object.entries(selected).filter(([, quantity]) => Number(quantity) > 0);

  function toggle(material) {
    setSelected((current) => {
      if (Object.prototype.hasOwnProperty.call(current, material.code)) {
        const { [material.code]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [material.code]: existing.get(material.code)?.quantity ?? 1 };
    });
  }

  async function assign() {
    if (!chosen.length || !stage) return;
    const items = chosen.map(([materialCode, quantity]) => {
      const material = dataset.inventory.find((item) => item.code === materialCode);
      const previous = existing.get(materialCode);
      return {
        id: previous?.id,
        bodyTypeId: product.id,
        stageId,
        materialCode,
        pieceCode: previous?.pieceCode || `AUTO-${product.code}-${stage.code}-${materialCode}`,
        description: previous?.description || material?.description || materialCode,
        lengthMm: previous?.lengthMm || 0,
        quantity: Number(quantity)
      };
    });
    await onSave(items);
    setSelected({});
    onClose?.();
  }

  return <section className="quick-bom">
    <header><div><p className="eyebrow">Asignación rápida</p><h3>Materiales de una fase</h3><p>Marca varios materiales, define sus cantidades y guárdalos juntos.</p></div><span>{chosen.length} seleccionados</span></header>
    <div className="quick-bom-controls"><select value={stageId} onChange={(event) => { setStageId(event.target.value); setSelected({}); }}>{product.route.map((id) => <option key={id} value={id}>{stageOf(dataset, id)?.shortName} · {stageOf(dataset, id)?.name}</option>)}</select><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar material" /></div><button type="button" className="text-button" onClick={() => setSelected(Object.fromEntries(materials.map((item) => [item.code, existing.get(item.code)?.quantity ?? 1])))}>Seleccionar visibles</button><button type="button" className="text-button" onClick={() => setSelected({})}>Limpiar</button></div>
    <div className="quick-bom-list">{materials.map((material) => { const isSelected = Object.prototype.hasOwnProperty.call(selected, material.code); const previous = existing.get(material.code); return <label key={material.code} className={isSelected ? "selected" : ""}><input type="checkbox" checked={isSelected} onChange={() => toggle(material)} /><div><strong>{material.code} · {material.description}</strong><small>{material.category} · {material.unit}{previous ? " · ya asignado" : ""}</small></div>{isSelected && <div className="input-suffix"><input aria-label={`Cantidad de ${material.description}`} type="number" min="0.01" step="0.01" value={selected[material.code]} onChange={(event) => setSelected((current) => ({ ...current, [material.code]: event.target.value }))} /><span>{material.unit}</span></div>}</label>; })}</div>
    <footer><small>{stage ? `Se asignarán a ${stage.name}. Si un material ya estaba en esta fase, se actualizará su cantidad.` : "Selecciona una fase."}</small><Button type="button" onClick={assign} disabled={!chosen.length}>Asignar {chosen.length || ""} material{chosen.length === 1 ? "" : "es"}</Button></footer>
  </section>;
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
  const [draft, setDraft] = useState({ ceco: order.ceco, customerId: order.customerId || "", customer: order.customer, line: order.line, plannedStartDate: pmpStartOf(order, product), dueDate: order.dueDate });
  const [control, setControl] = useState({ inspector: "", approval: "approved", observations: "" });
  useEffect(() => setDraft({ ceco: order.ceco, customerId: order.customerId || "", customer: order.customer, line: order.line, plannedStartDate: pmpStartOf(order, product), dueDate: order.dueDate }), [order.ceco, order.customerId, order.customer, order.line, order.plannedStartDate, order.dueDate, product?.id]);
  const normalizedCeco = String(draft.ceco || "").trim();
  const duplicateCeco = normalizedCeco !== order.ceco && dataset.orders.some((item) => item.ceco === normalizedCeco);
  const invalidCeco = !/^\d{6}$/.test(normalizedCeco);
  return <div className="customer-manager"><div className="customer-detail"><div><span>Cliente</span><strong>{order.customer}</strong><small>Orden {order.ceco} · {product?.family}</small></div><div><span>Estado de planta</span><strong>{order.plantState}</strong><small>Avance global {order.progress}%</small></div><div><span>Calidad</span><strong>{quality?.approval === "approved" ? "Aprobado" : quality?.approval === "observed" ? "Observado" : "Pendiente"}</strong><small>{quality?.observations ?? "Sin inspección registrada"}</small></div></div><div className="customer-fields customer-fields-pmp"><div className="ceco-edit-field"><input value={draft.ceco} inputMode="numeric" maxLength="6" onChange={(event) => setDraft({ ...draft, ceco: event.target.value.replace(/\D/g, "") })} aria-label="Correlativo CECO" title="Correlativo CECO" />{duplicateCeco && <small className="form-error">Ese CECO ya existe.</small>}{!duplicateCeco && invalidCeco && <small className="form-error">Usa 6 dígitos.</small>}</div><select value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })} aria-label="Cliente"><option value="">Cliente original</option>{dataset.customers.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={draft.line} onChange={(event) => setDraft({ ...draft, line: event.target.value })}>{dataset.productionLines.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><input type="date" value={draft.plannedStartDate} onChange={(event) => setDraft({ ...draft, plannedStartDate: event.target.value })} aria-label="Inicio PMP" title="Inicio PMP" /><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} aria-label="Fecha pactada" title="Fecha pactada" /><Button type="button" onClick={() => onSave(order.ceco, { ...draft, ceco: normalizedCeco })} disabled={duplicateCeco || invalidCeco}>Guardar orden</Button></div><small className="ceco-edit-hint">Puedes editar el correlativo CECO. Si ya existe, se avisa aquí y se protege la unicidad del registro.</small><div className="quality-control"><input value={control.inspector} onChange={(event) => setControl({ ...control, inspector: event.target.value })} placeholder="Inspector" /><select value={control.approval} onChange={(event) => setControl({ ...control, approval: event.target.value })}><option value="approved">Aprobado</option><option value="observed">Observado</option><option value="pending">Pendiente</option></select><input value={control.observations} onChange={(event) => setControl({ ...control, observations: event.target.value })} placeholder="Observación de calidad" /><Button type="button" onClick={() => onQuality({ ceco: order.ceco, stageId: order.stageId, ...control })} disabled={!control.inspector.trim()}>Registrar control</Button></div></div>;
}

function StagesView({ dataset, openDrawer }) {
  return <div className="stack-lg"><PageActions><div><strong>{dataset.flowStages.length} fases configuradas</strong><span>Modelo obtenido del DOP y de los avances por actividad.</span></div><Button onClick={() => openDrawer({ type: "activity" })}>+ Añadir actividad</Button></PageActions><div className="stage-detail-grid">{byOrder(dataset).map((stage) => { const activities = dataset.stageActivities.filter((item) => item.stageId === stage.id).sort((a, b) => a.sequence - b.sequence); const wip = dataset.stageInventory.filter((item) => item.stageId === stage.id); return <article className="panel stage-detail" key={stage.id}><header style={{ "--stage-color": stage.color }}><span>{stage.shortName}</span><div><h2>{stage.name}</h2><p>{stage.capacityHours} h/semana · estándar {stage.standardHours} h/orden</p></div>{stage.gatedByQuality && <b>Control de calidad</b>}</header><ol>{activities.map((activity) => <li key={activity.id}><span>{String(activity.sequence).padStart(2, "0")}</span><p>{activity.name}</p><small>{activity.standardMinutes} min</small><button className="row-action" onClick={() => openDrawer({ type: "activity", activity })}>Editar</button></li>)}</ol><div className="wip-box"><strong>Inventario en proceso</strong>{wip.length === 0 ? <small>Sin unidades en esta fase.</small> : wip.map((item) => <div key={item.id}><span className={`wip-dot ${item.status}`} /><p><b>CECO {item.ceco}</b>{item.item}</p><strong>{item.quantity} {item.unit}</strong></div>)}</div></article>; })}</div></div>;
}

function InventoryView({ dataset, heatmap, openDrawer, onImportExcel, onExportExcel, onCreateCatalog, onUpdateCatalog, onDeleteCatalog }) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("materials");
  const filtered = heatmap.filter((item) => `${item.code} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="stack-lg">
    <PageActions>
      <div className="view-switch">
        <button className={mode === "materials" ? "active" : ""} onClick={() => setMode("materials")}>Materiales</button>
        <button className={mode === "movements" ? "active" : ""} onClick={() => setMode("movements")}>Movimientos recientes</button>
        <button className={mode === "catalogs" ? "active" : ""} onClick={() => setMode("catalogs")}>Catálogos</button>
      </div>
      {mode === "materials" && <div className="section-actions"><ExcelActions onImport={onImportExcel} onExport={onExportExcel} onBulkTemplate={() => downloadBulkImportWorkbook(dataset)} label="materiales" /><Button onClick={() => openDrawer({ type: "material" })}>+ Nuevo material</Button></div>}
      {mode === "movements" && <Button onClick={() => openDrawer({ type: "movement" })}>Registrar movimiento</Button>}
    </PageActions>
    {mode === "materials" && <>
      <p className="excel-import-hint">Al importar, los materiales con el mismo código o una descripción equivalente se consolidan: la cantidad del Excel se suma al stock físico actual. La plantilla de carga masiva también los asigna a su fase y producto.</p>
      <div className="search-box inventory-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar código, descripción o categoría" /></div>
      <section className="panel"><SectionHeader eyebrow="Maestro de materiales" title="Existencias y cobertura" detail="Disponible = físico − comprometido. El stock de seguridad se calcula con factor de servicio × variabilidad × √plazo." /><div className="table-scroll"><table><thead><tr><th>Código / material</th><th>Categoría</th><th>Ubicación</th><th>Físico</th><th>Comprometido</th><th>Disponible</th><th>Proyección</th><th>Estado</th><th></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.description}</small></td><td>{item.category}</td><td>{item.location ?? "—"}</td><td>{item.physical} {item.unit}</td><td>{item.committed} {item.unit}</td><td>{item.available} {item.unit}</td><td><strong className={item.projected < 0 ? "negative" : ""}>{item.projected} {item.unit}</strong><small>Mínimo {item.safety}</small></td><td><span className={`stock-label ${item.tone}`}>{item.tone === "danger" ? "Quiebre" : item.tone === "warning" ? "Bajo mínimo" : "Cubierto"}</span></td><td><button className="row-action" onClick={() => openDrawer({ type: "material", item })}>Editar</button></td></tr>)}</tbody></table></div></section>
    </>}
    {mode === "movements" && <section className="panel"><SectionHeader eyebrow="Kardex" title="Movimientos recientes" detail="Consulta los ingresos, ajustes, reservas, salidas y consumos sin perder el contexto del maestro de materiales." /><MovementsTable rows={dataset.inventoryMovements} /></section>}
    {mode === "catalogs" && <section className="panel catalog-workspace"><SectionHeader eyebrow="Configuración de inventario" title="Categorías, unidades y marcas" detail="Opciones maestras utilizadas al registrar y clasificar materiales." /><CatalogManager standalone catalogs={dataset.catalogs} onCreate={onCreateCatalog} onUpdate={onUpdateCatalog} onDelete={onDeleteCatalog} /></section>}
  </div>;
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
  return <div className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>;
}

function SearchSelect({ name, options, value, defaultValue, onChange, required = false, placeholder = "Seleccionar", searchPlaceholder = "Buscar opción" }) {
  const selectRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const selectedValue = value ?? internalValue;
  const selected = options.find((item) => String(item.value) === String(selectedValue));
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((item) => `${item.label} ${item.meta ?? ""}`.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!options.length) return;
    const exists = options.some((item) => String(item.value) === String(selectedValue));
    if (!exists && value === undefined) setInternalValue(options[0].value);
  }, [options, selectedValue, value]);

  useEffect(() => {
    function close(event) {
      if (selectRef.current && !selectRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(nextValue) {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.({ target: { name, value: nextValue } });
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event) {
    if (event.key === "Escape") setOpen(false);
    if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  return <div className="search-select" ref={selectRef}>
    <input type="hidden" name={name} value={selectedValue} required={required} />
    <button type="button" className={`search-select-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown}>
      <span>{selected?.label ?? placeholder}</span>
      {selected?.meta && <small>{selected.meta}</small>}
      <b aria-hidden="true">⌄</b>
    </button>
    {open && <div className="search-select-menu">
      <div className="search-select-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} /></div>
      <div className="search-select-results" role="listbox">
        {filtered.length ? filtered.slice(0, 80).map((item) => <button type="button" key={item.value} role="option" aria-selected={String(item.value) === String(selectedValue)} className={String(item.value) === String(selectedValue) ? "selected" : ""} onClick={() => choose(item.value)}>
          <span>{item.label}</span>
          {item.meta && <small>{item.meta}</small>}
        </button>) : <p>Sin resultados</p>}
      </div>
      <footer>{filtered.length} resultado{filtered.length === 1 ? "" : "s"}</footer>
    </div>}
  </div>;
}

function CatalogManager({ catalogs, onCreate, onUpdate, onDelete, standalone = false }) {
  const [open, setOpen] = useState(standalone);
  const [type, setType] = useState("categories");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [editing, setEditing] = useState(null);
  const label = { categories: "Categorías", units: "Unidades", brands: "Marcas" }[type];
  const items = catalogs[type] || [];
  async function create() { if (!name.trim()) return; await onCreate({ type, name, symbol }); setName(""); setSymbol(""); }
  async function save(item) { await onUpdate({ type, ...item }); setEditing(null); }
  const singularLabels = { categories: "categoría", units: "unidad", brands: "marca" };
  return <section className={`catalog-manager ${standalone ? "standalone" : ""}`}>{!standalone && <button type="button" className="catalog-toggle" onClick={() => setOpen((value) => !value)}>{open ? "Ocultar mantenedor de opciones" : "Gestionar categorías, unidades y marcas"}</button>}{open && <div className="catalog-panel"><div className="catalog-tabs">{Object.entries({ categories: "Categorías", units: "Unidades", brands: "Marcas" }).map(([key, text]) => <button key={key} type="button" className={type === key ? "active" : ""} onClick={() => { setType(key); setEditing(null); }}>{text}<span>{catalogs[key].length}</span></button>)}</div><div className="catalog-entry"><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`Nueva ${singularLabels[type]}`} />{type === "units" && <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Símbolo" />}<Button type="button" onClick={create} disabled={!name.trim()}>Agregar</Button></div><div className="catalog-list">{items.map((item) => { const draft = editing?.id === item.id ? editing : null; return <div key={item.id}>{draft ? <><input value={draft.name} onChange={(event) => setEditing({ ...draft, name: event.target.value })} />{type === "units" && <input value={draft.symbol || ""} onChange={(event) => setEditing({ ...draft, symbol: event.target.value })} />}<button type="button" onClick={() => save(draft)}>Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></> : <><span>{item.name}{item.symbol && ` · ${item.symbol}`}</span><button type="button" onClick={() => setEditing({ ...item })}>Editar</button><button type="button" onClick={() => onDelete({ type, id: item.id })}>Eliminar</button></>}</div>; })}</div></div>}</section>;
}

function OrderSelect({ dataset, value, onChange, optional = false }) {
  const options = [
    ...(optional ? [{ value: "", label: "Sin CECO asociado" }] : []),
    ...dataset.orders.map((order) => ({ value: order.ceco, label: `CECO ${order.ceco}`, meta: `${productOf(dataset, order.bodyTypeId)?.name ?? "Producto"} · ${order.customer}` }))
  ];
  return <SearchSelect name="ceco" value={value} onChange={onChange} options={options} placeholder="Selecciona una orden" searchPlaceholder="Buscar por CECO, producto o cliente" />;
}

function AssignmentFields({ drawer, dataset }) {
  const [ceco, setCeco] = useState(drawer.ceco || dataset.orders[0]?.ceco || "");
  const stages = stagesForOrder(dataset, ceco);
  const activities = stages.flatMap((stage) => dataset.stageActivities.filter((item) => item.stageId === stage.id).map((item) => ({ ...item, stage })));
  return <><Field label="Trabajador"><SearchSelect name="personnelId" options={dataset.personnel.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, meta: `${item.employeeCode} · ${item.role}` }))} searchPlaceholder="Buscar trabajador" /></Field><Field label="Orden CECO" hint="Producto y cliente de la orden seleccionada"><OrderSelect dataset={dataset} value={ceco} onChange={(event) => setCeco(event.target.value)} /></Field><div className="form-row"><Field label="Actividad de su ruta"><SearchSelect name="activityId" defaultValue={activities.find((item) => item.stageId === drawer.stageId)?.id} options={activities.map((item) => ({ value: item.id, label: item.name, meta: `${item.stage.shortName} · ${item.stage.name}` }))} searchPlaceholder="Buscar actividad" /></Field><Field label="Fecha"><input name="assignedDate" type="date" required /></Field></div><div className="form-row"><Field label="Horas planificadas"><input name="plannedHours" type="number" min="0.25" max="24" step="0.25" required /></Field><Field label="Estado"><select name="status"><option value="planned">Planificado</option><option value="in_progress">En proceso</option><option value="completed">Completado</option><option value="blocked">Bloqueado</option></select></Field></div><p className="form-info">Las actividades se filtran automáticamente según la ruta del producto asociado al CECO.</p></>;
}

function OperationFields({ drawer, dataset }) {
  const [ceco, setCeco] = useState(drawer.ceco || dataset.orders[0]?.ceco || "");
  const stages = stagesForOrder(dataset, ceco);
  const activities = stages.flatMap((stage) => dataset.stageActivities.filter((item) => item.stageId === stage.id).map((item) => ({ ...item, stage })));
  return <><Field label="Orden CECO"><OrderSelect dataset={dataset} value={ceco} onChange={(event) => setCeco(event.target.value)} /></Field><div className="form-row"><Field label="Fecha"><input name="date" type="date" required /></Field><Field label="Horas"><input name="totalHours" type="number" min="0.25" step="0.25" required /></Field></div><Field label="Responsable"><SearchSelect name="worker" options={dataset.personnel.filter((item) => item.active).map((item) => ({ value: item.name, label: item.name, meta: `${item.employeeCode} · ${item.specialty || item.role}` }))} searchPlaceholder="Buscar responsable" /></Field><Field label="Actividad ejecutada"><SearchSelect name="activity" defaultValue={activities.find((item) => item.stageId === drawer.stageId)?.name} options={activities.map((item) => ({ value: item.name, label: item.name, meta: `${item.stage.shortName} · ${item.stage.name}` }))} searchPlaceholder="Buscar actividad" /></Field></>;
}

function IncidentFields({ drawer, dataset }) {
  const [ceco, setCeco] = useState(drawer.ceco || "");
  const availableStages = ceco ? stagesForOrder(dataset, ceco) : byOrder(dataset);
  const defaultStage = availableStages.some((item) => item.id === drawer.stageId) ? drawer.stageId : availableStages[0]?.id;
  return <><Field label="Fecha y hora"><input name="occurredAt" type="datetime-local" required /></Field><Field label="Orden CECO (opcional)" hint="Al elegirla, solo aparecen las fases de su producto"><OrderSelect dataset={dataset} value={ceco} onChange={(event) => setCeco(event.target.value)} optional /></Field><Field label="Fase afectada"><SearchSelect key={`${ceco}-${defaultStage}`} name="stageId" defaultValue={defaultStage} options={availableStages.map((item) => ({ value: item.id, label: item.name, meta: item.shortName }))} searchPlaceholder="Buscar fase" /></Field><div className="form-row"><Field label="Tipo"><select name="type"><option value="equipment">Equipo</option><option value="material">Material</option><option value="quality">Calidad</option><option value="personnel">Personal</option><option value="safety">Seguridad</option><option value="other">Otro</option></select></Field><Field label="Severidad"><select name="severity"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></Field></div><Field label="Equipo (opcional)"><SearchSelect name="equipmentId" options={[{ value: "", label: "Sin equipo" }, ...dataset.equipment.map((item) => ({ value: item.id, label: item.name, meta: `${item.code} · ${stageOf(dataset, item.stageId)?.name}` }))]} searchPlaceholder="Buscar equipo" /></Field><Field label="Horas de detención"><input name="downtimeHours" type="number" min="0" step="0.25" defaultValue="0" required /></Field><Field label="Descripción"><textarea name="description" required placeholder="Describe el evento y su impacto" /></Field></>;
}

function RecordDrawer({ drawer, dataset, onClose, onOpenRelated, onSubmit, onCreateCatalog, onUpdateCatalog, onDeleteCatalog }) {
  if (!drawer) return null;
  const titles = { material: drawer.item ? "Editar material" : "Registrar material", movement: "Movimiento de inventario", warehouse: "Entregar material reservado", order: "Nueva orden CECO", product: drawer.product ? "Editar plantilla" : "Registrar producto", customer: drawer.customer ? "Editar cliente" : "Registrar cliente", activity: drawer.activity ? "Editar actividad" : "Añadir actividad", bom: "Añadir componente BOM", operation: "Registrar parte diario", personnel: "Registrar trabajador", shift: "Registrar turno", equipment: "Registrar equipo", calendar: "Registrar excepción", assignment: "Asignar recurso", incident: "Registrar incidencia" };
  return <>{drawer.parent && <RecordDrawer drawer={drawer.parent} dataset={dataset} onClose={onClose} onOpenRelated={onOpenRelated} onSubmit={onSubmit} onCreateCatalog={onCreateCatalog} onUpdateCatalog={onUpdateCatalog} onDeleteCatalog={onDeleteCatalog} />}<div className={`drawer-backdrop ${drawer.secondary ? "drawer-backdrop-secondary" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className={`drawer ${drawer.secondary ? "drawer-secondary" : ""}`} role="dialog" aria-modal="true" aria-label={titles[drawer.type]}><header><div><p className="eyebrow">{drawer.secondary ? "Registro complementario" : "Nuevo registro"}</p><h2>{titles[drawer.type]}</h2></div><button onClick={onClose} aria-label="Cerrar">×</button></header><form onSubmit={onSubmit}>
    {drawer.type === "material" && <><Field label="Descripción"><input name="description" defaultValue={drawer.item?.description} required placeholder="Ej. Plancha galvanizada 1.5 mm" /></Field><div className="form-row"><Field label="Categoría"><select name="categoryId" defaultValue={drawer.item?.categoryId || dataset.catalogs.categories.find((item) => item.name === drawer.item?.category || drawer.item?.category?.startsWith(item.name.split(" ")[0]))?.id} required>{dataset.catalogs.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Unidad de medida"><select name="unitId" defaultValue={drawer.item?.unitId || dataset.catalogs.units.find((item) => item.symbol === drawer.item?.unit)?.id} required>{dataset.catalogs.units.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.symbol}</option>)}</select></Field></div><Field label="Marca"><select name="brandId" defaultValue={drawer.item?.brandId || ""}><option value="">Sin marca / genérico</option>{dataset.catalogs.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="form-row"><Field label={drawer.item ? "Stock físico (solo lectura)" : "Stock inicial"}><input name="physical" type="number" min="0" step="0.01" defaultValue={drawer.item?.physical ?? 0} disabled={Boolean(drawer.item)} required={!drawer.item} /></Field><Field label="Stock de seguridad calculado"><input name="safety" type="number" min="0" step="0.01" defaultValue={drawer.item?.safety ?? 0} readOnly={Boolean(drawer.item?.serviceFactor && drawer.item?.demandStdDev && drawer.item?.leadTimeDays)} /></Field></div><div className="form-row"><Field label="Factor de servicio"><input name="serviceFactor" type="number" min="0" step="0.01" defaultValue={drawer.item?.serviceFactor ?? "1.65"} /></Field><Field label="Variabilidad de demanda"><input name="demandStdDev" type="number" min="0" step="0.01" defaultValue={drawer.item?.demandStdDev ?? ""} /></Field><Field label="Plazo de reposición (días)"><input name="leadTimeDays" type="number" min="0" step="0.01" defaultValue={drawer.item?.leadTimeDays ?? ""} /></Field></div><Field label="Ubicación"><input name="location" defaultValue={drawer.item?.location} placeholder="Ej. ALM-PLA" /></Field><p className="form-info">El físico cambia mediante movimientos. Las categorías, unidades y marcas se administran desde Inventario → Catálogos.</p></>}
    {drawer.type === "movement" && <><Field label="Tipo de movimiento"><select name="movementType" defaultValue={drawer.quickReplenish ? "ingreso" : undefined}><option value="ingreso">Ingreso</option><option value="ajuste">Ajuste de inventario</option></select></Field><Field label="Material"><SearchSelect name="code" defaultValue={drawer.materialCode} options={dataset.inventory.map((item) => ({ value: item.code, label: item.description, meta: item.code }))} searchPlaceholder="Buscar material o código" /></Field><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" defaultValue={drawer.quantity} required /></Field><Field label="Detalle"><textarea name="note" defaultValue={drawer.quickReplenish ? `Reposición rápida para completar reservas del CECO ${drawer.ceco}` : undefined} required placeholder="Motivo o documento de referencia" /></Field><p className="form-info">{drawer.quickReplenish ? "Al guardar, el sistema vuelve a reservar el material ingresado para este CECO y recalcula su bloqueo." : "Las reservas se generan al crear la orden y las salidas se registran desde el detalle CECO para conservar su trazabilidad."}</p></>}
    {drawer.type === "warehouse" && <><Field label="Orden CECO"><input name="ceco" value={drawer.reservation.ceco} readOnly /></Field><Field label="Material"><input name="materialCode" value={drawer.reservation.materialCode} readOnly /></Field><Field label="Cantidad a entregar"><input name="quantity" type="number" min="0.01" max={drawer.reservation.reservedQuantity - drawer.reservation.issuedQuantity} step="0.01" defaultValue={drawer.reservation.reservedQuantity - drawer.reservation.issuedQuantity} required /></Field><p className="form-info">La entrega descuenta físico y comprometido, actualiza la reserva y genera ticket y movimiento en una sola transacción.</p></>}
    {drawer.type === "order" && <><Field label="Correlativo CECO" hint="Editable antes de registrar; debe ser único"><input name="ceco" inputMode="numeric" pattern="[0-9]{6}" minLength="6" maxLength="6" defaultValue={drawer.draft?.ceco || nextCecoCode(dataset.orders)} required /></Field><div className="drawer-related-actions"><span>Cliente</span><button type="button" className="row-action" onClick={(event) => onOpenRelated?.("customer", Object.fromEntries(new FormData(event.currentTarget.form)))}>+ Crear nuevo cliente</button></div><Field label="Cliente"><SearchSelect name="customerId" defaultValue={drawer.draft?.customerId} required options={dataset.customers.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name, meta: item.documentNumber || "Sin documento" }))} searchPlaceholder="Buscar cliente o RUC" /><input type="hidden" name="customer" value="" /></Field><div className="drawer-related-actions"><span>Producto</span><button type="button" className="row-action" onClick={(event) => onOpenRelated?.("product", Object.fromEntries(new FormData(event.currentTarget.form)))}>+ Crear nuevo producto</button></div><Field label="Producto"><SearchSelect name="bodyTypeId" defaultValue={drawer.draft?.bodyTypeId} required options={dataset.bodyTypes.map((item) => ({ value: item.id, label: item.name, meta: item.code }))} searchPlaceholder="Buscar producto" /></Field><div className="form-row"><Field label="Inicio PMP" hint="Inicio programado del plan maestro"><input name="plannedStartDate" type="date" defaultValue={drawer.draft?.plannedStartDate} required /></Field><Field label="Fecha pactada"><input name="dueDate" type="date" defaultValue={drawer.draft?.dueDate} required /></Field></div><p className="form-info">Al cerrar o guardar el registro complementario regresarás a este CECO sin perder los datos ya ingresados.</p></>}
    {drawer.type === "product" && <><div className="form-row"><Field label="Código"><input name="code" defaultValue={drawer.product?.code} required placeholder="PROD-XXX" /></Field><Field label="Familia"><select name="familyId" defaultValue={drawer.product?.familyId || dataset.productFamilies.find((item) => item.name === drawer.product?.family)?.id} required>{dataset.productFamilies.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div><Field label="Nombre del producto"><input name="name" defaultValue={drawer.product?.name} required /></Field><div className="form-row"><Field label="Marca"><select name="brandId" defaultValue={drawer.product?.brandId || dataset.catalogs.brands.find((item) => item.name === "ETRAL")?.id} required>{dataset.catalogs.brands.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Unidad de salida"><select name="outputUnitId" defaultValue={drawer.product?.outputUnitId || dataset.catalogs.units.find((item) => item.symbol === drawer.product?.outputUnit)?.id || "unit-und"} required>{dataset.catalogs.units.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.symbol}</option>)}</select></Field></div><Field label="Días objetivo"><input name="targetDays" type="number" min="1" defaultValue={drawer.product?.targetDays} required /></Field><fieldset className="route-picker"><legend>Ruta de fabricación</legend><p>Marca solo las fases que aplican; se conservará el orden productivo.</p>{byOrder(dataset).map((stage) => <label key={stage.id}><input type="checkbox" name="route" value={stage.id} defaultChecked={drawer.product ? drawer.product.route.includes(stage.id) : true} /><span style={{ "--check-color": stage.color }}>{stage.shortName}</span><b>{stage.name}</b></label>)}</fieldset><p className="form-info">Familias, marcas y unidades se cargan desde sus catálogos maestros.</p></>}
    {drawer.type === "customer" && <><div className="form-row"><Field label="Razón social / nombre"><input name="name" defaultValue={drawer.customer?.name} required /></Field><Field label="RUC / documento"><input name="documentNumber" defaultValue={drawer.customer?.documentNumber} /></Field></div><Field label="Persona de contacto"><input name="contactName" defaultValue={drawer.customer?.contactName} /></Field><div className="form-row"><Field label="Teléfono"><input name="phone" defaultValue={drawer.customer?.phone} /></Field><Field label="Correo"><input name="email" type="email" defaultValue={drawer.customer?.email} /></Field></div>{drawer.customer && <Field label="Estado"><select name="active" defaultValue={String(drawer.customer.active)}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field>}</>}
    {drawer.type === "activity" && <><Field label="Fase"><SearchSelect name="stageId" defaultValue={drawer.activity?.stageId} options={byOrder(dataset).map((item) => ({ value: item.id, label: item.name, meta: item.shortName }))} searchPlaceholder="Buscar fase" /></Field><Field label="Nombre de la actividad"><input name="name" defaultValue={drawer.activity?.name} required /></Field><Field label="Tiempo estándar"><div className="input-suffix"><input name="standardMinutes" type="number" min="1" defaultValue={drawer.activity?.standardMinutes} required /><span>min</span></div></Field>{drawer.activity && <Field label="Estado"><select name="active" defaultValue={String(drawer.activity.active)}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field>}</>}
    {drawer.type === "bom" && <><Field label="Producto"><SearchSelect name="bodyTypeId" defaultValue={drawer.productId} options={dataset.bodyTypes.map((item) => ({ value: item.id, label: item.name, meta: item.code }))} searchPlaceholder="Buscar producto" /></Field><Field label="Material"><SearchSelect name="materialCode" options={dataset.inventory.map((item) => ({ value: item.code, label: item.description, meta: item.code }))} searchPlaceholder="Buscar material o código" /></Field><Field label="Fase de consumo"><SearchSelect name="stageId" options={byOrder(dataset).map((item) => ({ value: item.id, label: item.name, meta: item.shortName }))} searchPlaceholder="Buscar fase" /></Field><div className="form-row"><Field label="Código de pieza"><input name="pieceCode" required /></Field><Field label="Cantidad"><input name="quantity" type="number" min="0.01" step="0.01" required /></Field></div><Field label="Descripción"><input name="description" required /></Field><Field label="Longitud (opcional)"><input name="lengthMm" type="number" min="0" /></Field></>}
    {drawer.type === "operation" && <OperationFields drawer={drawer} dataset={dataset} />}
    {drawer.type === "personnel" && <><div className="form-row"><Field label="Código"><input name="employeeCode" defaultValue={drawer.draft?.employeeCode} required placeholder="ETR-007" /></Field><Field label="Estado"><select name="status" defaultValue={drawer.draft?.status || "available"}><option value="available">Disponible</option><option value="assigned">Asignado</option><option value="absent">Ausente</option><option value="leave">Permiso</option></select></Field></div><Field label="Nombre completo"><input name="name" defaultValue={drawer.draft?.name} required /></Field><div className="form-row"><Field label="Cargo"><input name="role" defaultValue={drawer.draft?.role} required placeholder="Ej. Soldador" /></Field><Field label="Turno"><select name="shiftId" defaultValue={drawer.draft?.shiftId || ""}>{dataset.shifts.length === 0 && <option value="">Sin turnos registrados</option>}{dataset.shifts.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>{dataset.shifts.length === 0 && <button type="button" className="row-action" onClick={(event) => onOpenRelated?.("shift", Object.fromEntries(new FormData(event.currentTarget.form)))}>+ Registrar turno</button>}</Field></div><Field label="Especialidad"><input name="specialty" defaultValue={drawer.draft?.specialty} placeholder="Competencia principal" /></Field><div className="form-row"><Field label="Eficiencia estimada"><div className="input-suffix"><input name="efficiency" type="number" min="1" max="150" defaultValue={drawer.draft?.efficiency || "100"} required /><span>%</span></div></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="0" max="84" defaultValue={drawer.draft?.weeklyHours || "48"} required /></Field></div></>}
    {drawer.type === "shift" && <><div className="form-row"><Field label="Código"><input name="code" required placeholder="T3" /></Field><Field label="Nombre"><input name="name" required placeholder="Turno noche" /></Field></div><div className="form-row"><Field label="Hora de inicio"><input name="startTime" type="time" required /></Field><Field label="Hora de fin"><input name="endTime" type="time" required /></Field></div><Field label="Descanso"><div className="input-suffix"><input name="breakMinutes" type="number" min="0" max="240" defaultValue="60" required /><span>min</span></div></Field></>}
    {drawer.type === "equipment" && <><div className="form-row"><Field label="Código"><input name="code" required placeholder="EQ-XXX-01" /></Field><Field label="Estado"><select name="status"><option value="operational">Operativo</option><option value="restricted">Restringido</option><option value="maintenance">Mantenimiento</option><option value="out_of_service">Fuera de servicio</option></select></Field></div><Field label="Nombre del equipo"><input name="name" required /></Field><Field label="Fase asociada"><select name="stageId">{byOrder(dataset).map((item) => <option key={item.id} value={item.id}>{item.shortName} · {item.name}</option>)}</select></Field><div className="form-row"><Field label="Capacidad semanal"><div className="input-suffix"><input name="capacityHours" type="number" min="0" required /><span>h</span></div></Field><Field label="Próximo mantenimiento"><input name="maintenanceDue" type="date" /></Field></div></>}
    {drawer.type === "calendar" && <><div className="workweek-picker"><span>Días laborables base</span><label><input type="checkbox" checked readOnly />Lun</label><label><input type="checkbox" checked readOnly />Mar</label><label><input type="checkbox" checked readOnly />Mié</label><label><input type="checkbox" checked readOnly />Jue</label><label><input type="checkbox" checked readOnly />Vie</label><label><input type="checkbox" checked readOnly />Sáb</label><small>Domingo queda como no laborable por defecto.</small></div><Field label="Fecha de excepción"><input name="date" type="date" required /></Field><Field label="Tipo"><select name="dayType" defaultValue="holiday"><option value="holiday">Feriado</option><option value="shutdown">No laborable / parada</option><option value="reduced">Jornada especial reducida</option></select></Field><Field label="Horas si es jornada reducida"><div className="input-suffix"><input name="availableHours" type="number" min="0" max="24" step="0.25" defaultValue="4" /><span>h</span></div></Field><Field label="Descripción opcional"><textarea name="note" placeholder="Ej. Feriado nacional, mantenimiento general, inventario" /></Field><p className="form-info">Para feriados y paradas las horas se calculan como 0. Solo completa horas cuando elijas jornada reducida.</p></>}
    {drawer.type === "assignment" && <AssignmentFields drawer={drawer} dataset={dataset} />}
    {drawer.type === "incident" && <IncidentFields drawer={drawer} dataset={dataset} />}
    <footer><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Guardar registro</Button></footer>
  </form></aside></div></>;
}

function EmptyState({ text }) { return <div className="empty-state">{text}</div>; }
