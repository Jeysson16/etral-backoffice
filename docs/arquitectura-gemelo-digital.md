# Arquitectura del gemelo digital ETRAL

## Flujo operativo

```mermaid
flowchart LR
  A["Maestros<br/>personal, turnos y equipos"] --> D["Supabase<br/>estado operativo"]
  B["Producción<br/>CECO, fases y actividades"] --> D
  C["Inventario<br/>materiales, BOM y movimientos"] --> D
  E["Calendario, asignaciones<br/>e incidencias"] --> D
  D --> F["Repositorio de datos"]
  F --> G["Snapshot inmutable de planta"]
  G --> H["Motor determinístico<br/>JavaScript o Python"]
  H --> I["Escenario base"]
  H --> J["Escenario What-if"]
  I --> K["Comparación, alertas<br/>y apoyo a decisiones"]
  J --> K
  K -. "decisión humana" .-> A
```

Los formularios mantienen el estado real. La simulación recibe una copia de ese estado y nunca modifica directamente los registros operativos.

## Arquitectura lógica

```mermaid
flowchart TB
  subgraph UI["Presentación · React"]
    NAV["Navegación responsiva"]
    VIEWS["Producción, inventario y recursos"]
    TWIN["Configuración y resultados del gemelo"]
  end
  subgraph APP["Aplicación"]
    REPO["Contrato Repository"]
    ADAPTER["Adaptador twinApi"]
  end
  subgraph DATA["Infraestructura"]
    SUPA["Supabase Repository"]
    LOCAL["Local Repository"]
    DB[("PostgreSQL / Supabase")]
  end
  subgraph ENGINE["Dominio de simulación"]
    JS["Motor JS"]
    API["FastAPI"]
    PY["Servicios Python<br/>MRP + capacidad + What-if"]
  end
  NAV --> VIEWS
  VIEWS --> REPO
  TWIN --> ADAPTER
  REPO --> SUPA --> DB
  REPO --> LOCAL
  ADAPTER --> JS
  ADAPTER --> API --> PY
```

## Patrones de diseño utilizados

### Repository

`getRepository()` selecciona la implementación de persistencia. Los componentes trabajan con operaciones de negocio y no con consultas SQL o tablas concretas.

### Strategy

`VITE_TWIN_ENGINE` selecciona el motor `browser` o `python`. Ambos entregan el mismo contrato de resultados al frontend.

### Adapter

`twinApi.js` transforma el dataset de React en el snapshot esperado por FastAPI y adapta la respuesta del motor a la interfaz.

### Service Layer

`backend/app/services.py` concentra MRP, stock de seguridad, capacidad y comparación de escenarios. Las rutas FastAPI solo validan y delegan.

### DTO / Schema

Los modelos Pydantic validan materiales, órdenes, recursos, equipos, calendario e incidencias antes de ejecutar una simulación.

### Snapshot

Cada corrida usa una fotografía aislada del estado de planta. Esto garantiza reproducibilidad y evita que un escenario altere inventario, CECO o asignaciones reales.

## Alimentación de capacidad

```mermaid
flowchart TD
  P["Personal activo + eficiencia"] --> C["Capacidad disponible por fase"]
  S["Turnos y descansos"] --> C
  E["Estado de equipos"] --> C
  L["Calendario laboral"] --> C
  I["Horas de incidencias abiertas"] --> C
  A["Asignaciones comprometidas"] --> O["Carga operativa"]
  C --> R["Utilización = demanda / disponibilidad"]
  O --> R
  R --> B["Cuellos de botella y alertas"]
```

El motor es determinístico y auditable. No usa machine learning: cada resultado se deriva de datos registrados, reglas MRP y fórmulas explícitas.
