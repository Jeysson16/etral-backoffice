# Base provisional de indicadores · ETRAL Trujillo

Fecha de corte: 29 de octubre de 2026. Proyecto: `PRUEBAS`. Estos valores permiten calcular los indicadores de investigación; **no son facturas, cotizaciones de ETRAL ni consumos observados**. La columna de procedencia y las notas del libro de tesis los distinguen de los importes registrados.

| Campo | Origen y criterio | Resultado de la carga |
|---|---|---:|
| Costo unitario de material | Se conservaron 296 precios existentes. Para 602 faltantes se usó la misma descripción y unidad del catálogo, comparables minoristas peruanos o una mediana de categoría y unidad. Los comparables menos precisos indican “revisar”. | 898/898 con valor |
| `dp` y `s1` | Demanda planificada de BOM por CECO distribuida entre inicio y fecha pactada, de lunes a sábado. Se incluye el día sin demanda en el cálculo de la desviación. No había salidas ni consumos observados en los 1,674 movimientos; eran ingresos y reservas. Para material sin BOM en el periodo: `dp = 0`, `s1 = 0`. | 898/898 con ficha completa |
| `Lt`, `s2`, nivel, `z` | Se conservó lo previamente registrado. Faltantes: plazo referencial de 5 días para fijaciones, pintura, disolventes y corte; 14 para sistemas especializados; 7 para otros. `s2 = 25% × Lt`, servicio 95%, `z = 1.645`. | 898/898 con ficha completa |
| Tarifa laboral | Para 9 trabajadores sin tarifa se estimaron S/ 11 a S/ 27 por hora según cargo. Se limpiaron dos nombres con espacios finales para vincularlos con los partes. | 243/243 partes con trabajador valorizable |
| Venta, energía, capital de CECO | Para 10 CECO se estimó venta con una referencia de carrocería y al menos 1.45 veces materiales más mano de obra. Energía = 2.5% y capital = 3.5% de esa base. Son escenarios de investigación, no importes facturados. | 10/10 con importes |

La base conserva la procedencia en `unit_cost_basis`, `safety_parameters_basis`, `hourly_cost_basis`, `output_value_basis`, `energy_cost_basis` y `capital_cost_basis`. Editar un precio en Inventario, una tarifa en Personal o un importe en Datos del CECO permite sustituir la estimación. La hoja **Precios** importa únicamente precios modificados y no cambia existencias.

## Validación al corte

- Cinco CECO terminados: costo estimado de materiales **S/ 71,124.50**, mano de obra **S/ 5,265.25**, energía y capital **S/ 4,583.38**, valor de salida **S/ 117,288.39**.
- Productividad de materiales: **0.000070 unidades/S/** (la tarjeta muestra 0.0001 por redondeo a cuatro decimales).
- Productividad multifactorial: **1.448**.
- Cobertura de SS: **467/898 = 52.0%**. El disparador de inventario recalculó el SS al completar sus parámetros. Esta cobertura usa supuestos de demanda y plazo; revisar antes de emplearla para compras.
- El avance de fase acredita cantidades BOM de CECO terminados. No había salidas o consumos explícitos, así que el costo de materiales sigue siendo una valoración estimada. La fecha real de entrega permanece vacía cuando no se registró; el formulario del CECO ya permite completarla.

## Referencias de precios y contexto peruano

- [Fijaciones, Soko Perú](https://soko.pe/collections/fijaciones): remaches y arandelas como referencia de unidad.
- [Plancha galvanizada 1.2 × 1200 × 2400, ABA](https://aba.com.pe/producto/plancha-galvanizada-1-2x1200x2400mm/): S/ 121 como comparable para la medida exacta.
- [Lija para fierro, Sodimac Perú](https://www.sodimac.com.pe/sodimac-pe/b/lija-para-fierro) y [lija al agua, Ferretería Jireh](https://ferreteriajireh.com.pe/pinturas-acabados/lija-al-agua): base S/ 2.50 por pliego.
- [Carrocerías tipo furgón, Autoline Perú](https://autoline.pe/-/carrocerias-furgones--c894): rango de mercado usado solo como control de plausibilidad de la estimación de venta.
- [RMV vigente desde octubre de 2026, El Peruano](https://elperuano.pe/noticia/305879-desde-hoy-rige-la-nueva-rmv-sueldo-minimo-sube-a-s-1230-y-cambia-otros-conceptos-laborales): contexto para las tarifas horarias referenciales.

Procedimiento reproducible: [`scripts/backfill-indicator-estimates.sql`](../scripts/backfill-indicator-estimates.sql). El script respeta precios e importes registrados; recalcula únicamente valores marcados como estimados cuando cambian sus supuestos.
