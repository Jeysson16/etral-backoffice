import React from "react";

const amount = (value) => Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 3 });
const date = (value) => value ? new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";
const keyOf = (item) => `${item.code}:${item.needed}`;

export default function PhaseSuggestionBoard({ board, query, ceco, onCeco, showCovered, onShowCovered, selected, onSelect, onSelectMany, onCreateMany, busy }) {
  const filter = query.trim().toLocaleLowerCase("es-PE");
  const groups = board.groups.filter((group) => !ceco || group.ceco === ceco).map((group) => ({ ...group, totalCount: group.rows.length,
    totalCovered: group.rows.filter((row) => row.status === "covered").length, rows: group.rows.filter((row) =>
    (!filter || `${row.code} ${row.material.description} ${group.product} ${group.stageName} ${group.ceco}`.toLocaleLowerCase("es-PE").includes(filter))
    && (showCovered || row.status !== "covered")) })).filter((group) => group.rows.length);
  const visibleSuggestions = groups.flatMap((group) => group.rows.map((row) => row.suggestion).filter(Boolean));
  const selectedVisible = visibleSuggestions.filter((item) => selected.has(keyOf(item)));
  const allSelected = visibleSuggestions.length > 0 && selectedVisible.length === visibleSuggestions.length;
  const cecos = [...new Map(board.groups.map((group) => [group.ceco, group.product])).entries()];
  const scopedGroups = board.groups.filter((group) => !ceco || group.ceco === ceco);
  const scopedPhaseKeys = new Set(scopedGroups.map((group) => group.key));
  const stageCount = scopedGroups.filter((group) => group.requestCount).length;
  const suggestionCount = board.suggestions.filter((item) => scopedPhaseKeys.has(item.phaseKey)).length;

  return <section className="phase-board">
    <div className="phase-board-overview">
      <div><span>CECO activos</span><strong>{ceco ? 1 : cecos.length}</strong></div>
      <div><span>Fases con reposición</span><strong>{stageCount}</strong></div>
      <div><span>Materiales por solicitar</span><strong>{suggestionCount}</strong></div>
    </div>
    <div className="phase-board-toolbar">
      <label>Producto / CECO<select value={ceco} onChange={(event) => onCeco(event.target.value)}><option value="">Todos los CECO</option>{cecos.map(([code, product]) => <option key={code} value={code}>{code} · {product}</option>)}</select></label>
      <label className="phase-board-switch"><input type="checkbox" checked={showCovered} onChange={(event) => onShowCovered(event.target.checked)} /> Mostrar cubiertos</label>
      <label className="phase-board-switch"><input type="checkbox" checked={allSelected} disabled={!visibleSuggestions.length} onChange={(event) => onSelectMany(visibleSuggestions, event.target.checked)} /> Seleccionar visibles</label>
      <button className="planning-primary" disabled={!selected.size || busy} onClick={onCreateMany}>{busy ? "Guardando…" : `Crear ${selected.size} solicitud${selected.size === 1 ? "" : "es"}`}</button>
    </div>
    <div className="phase-board-groups">{groups.map((group) => {
      const selectable = group.rows.map((row) => row.suggestion).filter(Boolean);
      const allGroupSelected = selectable.length > 0 && selectable.every((item) => selected.has(keyOf(item)));
      const coverage = group.totalCount ? Math.round(group.totalCovered / group.totalCount * 100) : 0;
      return <article className="phase-group" key={group.key}>
        <header className="phase-group-header">
          <div className="phase-group-id"><span className="phase-group-number">{String(group.routeOrder + 1).padStart(2, "0")}</span><div><small>CECO {group.ceco} · {group.product}</small><h3>{group.stageName}</h3></div></div>
          <div className="phase-group-meta"><span>{date(group.needed)}</span><b>{group.requestCount} por solicitar</b><small>{group.totalCovered}/{group.totalCount} cubiertos</small></div>
        </header>
        <div className="phase-group-progress"><span style={{ width: `${coverage}%` }} /></div>
        {selectable.length > 0 && <label className="phase-group-select"><input type="checkbox" checked={allGroupSelected} onChange={(event) => onSelectMany(selectable, event.target.checked)} /> Seleccionar esta fase</label>}
        <div className="phase-materials">{group.rows.map((row) => <div className={`phase-material ${row.status}`} key={`${group.key}:${row.code}`}>
          <div className="phase-material-main">
            {row.suggestion ? <input type="checkbox" aria-label={`Seleccionar ${row.code} para CECO ${group.ceco}`} checked={selected.has(keyOf(row.suggestion))} onChange={(event) => onSelect(row.suggestion, event.target.checked)} /> : <span className="phase-material-dot" />}
            <div><strong>{row.code}</strong><span>{row.material.description}</span></div>
          </div>
          <div className="phase-material-figures"><div><small>Requiere</small><b>{amount(row.quantity)} {row.material.unit}</b></div><div className={row.projected < row.safety ? "below" : ""}><small>Proyectado / SS</small><b>{amount(row.projected)} / {amount(row.safety)}</b></div><div><small>{row.suggestion ? "Solicitar" : row.status === "pending" ? "En trámite" : "Cobertura"}</small><b>{row.suggestion ? `${amount(row.suggestion.quantity)} ${row.material.unit}` : row.status === "pending" ? `${amount(row.pendingSupply)} ${row.material.unit}` : row.status === "covered" ? "Cubierto" : row.status === "planned" ? "Incluido" : "Revisar"}</b></div></div>
        </div>)}</div>
      </article>;
    })}</div>
    {!groups.length && <div className="phase-board-empty">No hay materiales para este filtro.</div>}
    {selected.size > 0 && <div className="phase-selection-bar"><strong>{selected.size} material{selected.size === 1 ? "" : "es"} seleccionado{selected.size === 1 ? "" : "s"}</strong><button className="planning-primary" disabled={busy} onClick={onCreateMany}>{busy ? "Guardando…" : "Crear solicitudes"}</button></div>}
  </section>;
}
