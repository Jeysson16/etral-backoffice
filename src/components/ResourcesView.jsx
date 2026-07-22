import React, { useMemo, useState } from "react";

const tabs = [
  ["personnel", "Personal", "◉"], ["shifts", "Turnos", "◷"], ["equipment", "Equipos", "⚙"],
  ["assignments", "Asignaciones", "⇄"], ["calendar", "Calendario", "▦"], ["incidents", "Incidencias", "△"]
];

const labels = {
  available: "Disponible", assigned: "Asignado", absent: "Ausente", leave: "Permiso",
  operational: "Operativo", restricted: "Restringido", maintenance: "Mantenimiento", out_of_service: "Fuera de servicio",
  planned: "Planificado", in_progress: "En proceso", completed: "Completado", blocked: "Bloqueado",
  working: "Laborable", reduced: "Reducido", holiday: "Feriado", shutdown: "Parada",
  open: "Abierta", investigating: "En análisis", resolved: "Resuelta",
  equipment: "Equipo", material: "Material", quality: "Calidad", personnel: "Personal", safety: "Seguridad", other: "Otro"
};

function stageOf(dataset, id) { return dataset.flowStages.find((item) => item.id === id); }
function personOf(dataset, id) { return dataset.personnel.find((item) => item.id === id); }
function activityOf(dataset, id) { return dataset.stageActivities.find((item) => item.id === id); }
function shiftOf(dataset, id) { return dataset.shifts.find((item) => item.id === id); }

function Header({ eyebrow, title, detail, action }) {
  return <header className="resource-header"><div><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div>{action}</header>;
}

function ActionButton({ children, onClick }) { return <button className="button primary" onClick={onClick}>{children}</button>; }
function Badge({ value }) { return <span className={`resource-badge ${value}`}>{labels[value] ?? value}</span>; }

export default function ResourcesView({ dataset, openDrawer }) {
  const [tab, setTab] = useState("personnel");
  const metrics = useMemo(() => {
    const active = dataset.personnel.filter((item) => item.active);
    const available = active.filter((item) => item.status !== "absent" && item.status !== "leave");
    const productiveHours = available.reduce((sum, item) => sum + Number(item.weeklyHours) * Number(item.efficiency) / 100, 0);
    const equipmentReady = dataset.equipment.filter((item) => item.status === "operational").length;
    const downtime = dataset.incidents.filter((item) => item.status !== "resolved").reduce((sum, item) => sum + Number(item.downtimeHours), 0);
    return { active: active.length, available: available.length, productiveHours: Math.round(productiveHours), equipmentReady, downtime };
  }, [dataset]);

  return <div className="stack-lg resources-page">
    <section className="resource-feed-banner">
      <div className="feed-orbit"><span>ETRAL</span><i /><i /><i /></div>
      <div><span>Alimentación operativa</span><h2>Recursos conectados al gemelo digital</h2><p>La capacidad base se construye con disponibilidad de personal, turnos, equipos, calendario, asignaciones e incidencias.</p></div>
      <aside><strong>{metrics.productiveHours} h</strong><small>capacidad laboral efectiva / semana</small></aside>
    </section>

    <section className="resource-kpis">
      <article><span className="metric-symbol people">◉</span><div><small>Personal disponible</small><strong>{metrics.available} / {metrics.active}</strong><p>Dotación operativa</p></div></article>
      <article><span className="metric-symbol hours">◷</span><div><small>Horas efectivas</small><strong>{metrics.productiveHours} h</strong><p>Eficiencia incluida</p></div></article>
      <article><span className="metric-symbol machine">⚙</span><div><small>Equipos operativos</small><strong>{metrics.equipmentReady} / {dataset.equipment.length}</strong><p>Disponibles ahora</p></div></article>
      <article><span className="metric-symbol alert">△</span><div><small>Tiempo detenido</small><strong>{metrics.downtime} h</strong><p>Incidencias abiertas</p></div></article>
    </section>

    <div className="resource-tabs" role="tablist">{tabs.map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{icon}</span>{label}<b>{dataset[id === "calendar" ? "workCalendar" : id]?.length ?? 0}</b></button>)}</div>

    {tab === "personnel" && <section className="panel resource-section">
      <Header eyebrow="Maestro de recursos" title="Personal de planta" detail="Disponibilidad, especialidad, turno y eficiencia usada por el gemelo." action={<ActionButton onClick={() => openDrawer({ type: "personnel" })}>+ Nuevo trabajador</ActionButton>} />
      <div className="people-grid">{dataset.personnel.map((person) => <article key={person.id} className="person-card"><header><span>{person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><Badge value={person.status} /></header><h3>{person.name}</h3><p>{person.employeeCode} · {person.role}</p><dl><div><dt>Especialidad</dt><dd>{person.specialty || "General"}</dd></div><div><dt>Turno</dt><dd>{shiftOf(dataset, person.shiftId)?.name ?? "Sin turno"}</dd></div></dl><footer><div><span>Eficiencia</span><b>{person.efficiency}%</b></div><div className="mini-progress"><i style={{ width: `${Math.min(100, person.efficiency)}%` }} /></div><small>{person.weeklyHours} horas semanales</small></footer></article>)}</div>
    </section>}

    {tab === "shifts" && <section className="panel resource-section"><Header eyebrow="Disponibilidad temporal" title="Turnos de trabajo" detail="Horarios y descansos que determinan las horas productivas." action={<ActionButton onClick={() => openDrawer({ type: "shift" })}>+ Nuevo turno</ActionButton>} /><div className="shift-grid">{dataset.shifts.map((shift) => <article key={shift.id}><span>{shift.code}</span><div><h3>{shift.name}</h3><p>{shift.startTime} — {shift.endTime}</p></div><aside><strong>{shift.breakMinutes} min</strong><small>descanso</small></aside></article>)}</div></section>}

    {tab === "equipment" && <section className="panel resource-section"><Header eyebrow="Capacidad instalada" title="Equipos productivos" detail="Estado, fase asociada y mantenimiento de los activos críticos." action={<ActionButton onClick={() => openDrawer({ type: "equipment" })}>+ Nuevo equipo</ActionButton>} /><div className="responsive-table"><table><thead><tr><th>Equipo</th><th>Fase</th><th>Capacidad</th><th>Mantenimiento</th><th>Estado</th></tr></thead><tbody>{dataset.equipment.map((item) => <tr key={item.id}><td data-label="Equipo"><strong>{item.code}</strong><small>{item.name}</small></td><td data-label="Fase">{stageOf(dataset, item.stageId)?.name}</td><td data-label="Capacidad"><strong>{item.capacityHours} h/sem</strong></td><td data-label="Mantenimiento">{item.maintenanceDue || "Sin fecha"}</td><td data-label="Estado"><Badge value={item.status} /></td></tr>)}</tbody></table></div></section>}

    {tab === "assignments" && <section className="panel resource-section"><Header eyebrow="Carga diaria" title="Asignaciones a CECO" detail="Vincula personas con órdenes y actividades para medir la capacidad comprometida." action={<ActionButton onClick={() => openDrawer({ type: "assignment" })}>+ Asignar recurso</ActionButton>} /><div className="assignment-list">{dataset.assignments.map((item) => <article key={item.id}><time>{item.assignedDate}</time><div><strong>{personOf(dataset, item.personnelId)?.name}</strong><span>CECO {item.ceco} · {activityOf(dataset, item.activityId)?.name}</span></div><p><b>{item.plannedHours} h</b><Badge value={item.status} /></p></article>)}</div></section>}

    {tab === "calendar" && <section className="panel resource-section"><Header eyebrow="Horizonte operativo" title="Calendario laboral" detail="Días disponibles que delimitan la capacidad real de los escenarios." action={<ActionButton onClick={() => openDrawer({ type: "calendar" })}>+ Configurar día</ActionButton>} /><div className="calendar-grid">{[...dataset.workCalendar].sort((a, b) => a.date.localeCompare(b.date)).map((day) => <article key={day.id} className={day.dayType}><time><b>{new Date(`${day.date}T12:00:00`).toLocaleDateString("es-PE", { day: "2-digit" })}</b><span>{new Date(`${day.date}T12:00:00`).toLocaleDateString("es-PE", { month: "short" })}</span></time><div><Badge value={day.dayType} /><strong>{day.availableHours} horas disponibles</strong><small>{day.note}</small></div></article>)}</div></section>}

    {tab === "incidents" && <section className="panel resource-section"><Header eyebrow="Pérdidas de capacidad" title="Incidencias operativas" detail="Las horas detenidas afectan el estado base que recibe la simulación." action={<ActionButton onClick={() => openDrawer({ type: "incident" })}>+ Registrar incidencia</ActionButton>} /><div className="incident-list">{dataset.incidents.map((item) => <article key={item.id} className={item.severity}><span className="incident-mark">!</span><div><header><Badge value={item.type} /><Badge value={item.status} /></header><strong>{item.description}</strong><p>{stageOf(dataset, item.stageId)?.name}{item.ceco ? ` · CECO ${item.ceco}` : ""}</p></div><aside><strong>{item.downtimeHours} h</strong><small>detención</small><time>{item.occurredAt}</time></aside></article>)}</div></section>}
  </div>;
}
