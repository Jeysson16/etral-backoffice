import React from "react";
import criticalMaterials from "../data/criticalStockReference.json";

const amount = (value, digits = 2) => Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: digits });
const totalValue = criticalMaterials.reduce((sum, item) => sum + Number(item.safetyStock || 0) * Number(item.unitCost || 0), 0);

export default function AcademicStockReference() {
  return <details className="academic-stock-reference">
    <summary>Ver análisis del Excel adjunto · {criticalMaterials.length} materiales críticos</summary>
    <p>Referencia académica de la hoja «3_Calculo_SS». La producción mensual y los plazos señalados como simulados en el archivo no sustituyen CECO, existencias ni compras registradas. El SS y el punto de reorden de esta tabla son informativos.</p>
    <div className="academic-stock-totals"><span><strong>{criticalMaterials.length}</strong> críticos evaluados</span><span><strong>{criticalMaterials.filter((item) => Number(item.safetyStock) > 0).length}</strong> con SS mayor a cero</span><span><strong>S/ {amount(totalValue)}</strong> valor referencial del SS</span><span><strong>S/ {amount(totalValue * 0.25)}</strong> costo anual al 25% del Excel</span></div>
    <div className="table-scroll academic-stock-scroll"><table><thead><tr><th>Código del Excel</th><th>Material</th><th>Criticidad</th><th>Demanda diaria</th><th>LT promedio</th><th>Desv. LT</th><th>Z</th><th>SS Excel</th><th>ROP referencial</th><th>Precio S/</th><th>SS valorizado S/</th><th>Procedencia</th></tr></thead><tbody>{criticalMaterials.map((item) => <tr key={item.code}><td><strong>{item.code}</strong></td><td>{item.name}</td><td>{item.decision}</td><td>{amount(item.dailyDemand, 4)}</td><td>{amount(item.leadTime)}</td><td>{amount(item.leadTimeStdDev)}</td><td>1.645</td><td><strong>{amount(item.safetyStock)}</strong></td><td>{amount(Number(item.dailyDemand || 0) * Number(item.leadTime || 0) + Number(item.safetyStock || 0))}</td><td>{amount(item.unitCost)}</td><td>{amount(Number(item.safetyStock || 0) * Number(item.unitCost || 0))}</td><td>{String(item.sourceNote || "").startsWith("Simulado") ? "LT simulado" : "Según Excel"}</td></tr>)}</tbody></table></div>
    <p>SS = redondear hacia arriba(1.645 × demanda diaria × desviación de LT); ROP = demanda diaria × LT promedio + SS. Los códigos únicos del anexo pueden diferir de los códigos actuales de Inventario; no se fusionan automáticamente.</p>
  </details>;
}
