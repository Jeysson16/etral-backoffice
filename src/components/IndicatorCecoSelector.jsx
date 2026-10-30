import React from "react";

export default function IndicatorCecoSelector({ dataset, selectedCecos, excelCecos, onToggle, onSelectExcel, onSelectAll }) {
  if (!excelCecos.size) return null;
  const orders = [...(dataset.orders ?? [])].sort((a, b) => String(a.ceco).localeCompare(String(b.ceco), "es"));
  const products = new Map((dataset.bodyTypes ?? []).map((item) => [item.id, item.name]));
  const excelSelected = selectedCecos.size === excelCecos.size && [...excelCecos].every((ceco) => selectedCecos.has(ceco));
  const allSelected = selectedCecos.size === orders.length;
  return <details className="panel indicator-ceco-selector">
    <summary><span><b>CECO del análisis</b><small>{selectedCecos.size} de {orders.length} seleccionados · resultados del periodo</small></span><strong>Elegir CECO <span aria-hidden="true">⌄</span></strong></summary>
    <div className="indicator-ceco-content">
      <div className="indicator-ceco-actions"><button type="button" className={excelSelected ? "active" : ""} onClick={onSelectExcel}>Los {excelCecos.size} del Excel</button><button type="button" className={allSelected ? "active" : ""} onClick={onSelectAll}>Todos los CECO</button></div>
      <div className="indicator-ceco-list">{orders.map((order) => <label key={order.ceco} className={selectedCecos.has(order.ceco) ? "selected" : ""}>
        <input type="checkbox" checked={selectedCecos.has(order.ceco)} disabled={selectedCecos.size === 1 && selectedCecos.has(order.ceco)} onChange={() => onToggle(order.ceco)} />
        <span><b>{order.ceco}</b><small>{products.get(order.bodyTypeId) ?? order.line ?? "CECO"}</small></span>
        {excelCecos.has(order.ceco) && <em>Excel</em>}
      </label>)}</div>
    </div>
  </details>;
}
