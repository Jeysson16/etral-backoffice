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

### Diagrama de los patrones en una acción del front

```mermaid
sequenceDiagram
  participant UI as React · pantalla/formulario
  participant R as Repository (contrato)
  participant SR as SupabaseRepository o LocalRepository
  participant DB as Supabase / localStorage
  participant TA as twinApi (Adapter)
  participant EN as Motor JS o API Python (Strategy)

  UI->>R: createOrder(), createInventory(), getDataset()
  R->>SR: selecciona implementación activa
  SR->>DB: leer o persistir datos
  DB-->>SR: filas / dataset
  SR-->>UI: dataset normalizado
  UI->>TA: runTwinSimulation(snapshot, parámetros)
  TA->>EN: ejecutar motor seleccionado
  EN-->>TA: resultado normalizado
  TA-->>UI: comparación base vs. escenario
```

### Repository

`getRepository()` selecciona la implementación de persistencia. Los componentes trabajan con operaciones de negocio y no con consultas SQL o tablas concretas.

**Aplicación en el front:** `App.jsx` solicita un único dataset y llama métodos como `createInventory`, `createOrder` o `createCatalogItem`. No conoce si los datos vienen de Supabase o de `localStorage`.

### Strategy

`VITE_TWIN_ENGINE` selecciona el motor `browser` o `python`. Ambos entregan el mismo contrato de resultados al frontend.

**Beneficio:** se puede usar el cálculo ligero de JavaScript para una demostración o la API Python para reglas de simulación más avanzadas, sin cambiar las pantallas.

### Adapter

`twinApi.js` transforma el dataset de React en el snapshot esperado por FastAPI y adapta la respuesta del motor a la interfaz.

**Beneficio:** el formato interno de la API no se filtra a los componentes React.

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

## Responsabilidad por capa

| Capa | Responsabilidad | Ejemplos |
|---|---|---|
| Presentación | Captura y muestra la operación. | Formularios, Kanban de CECO, inventario, fases, resultados del gemelo. |
| Aplicación | Coordina acciones y normaliza datos. | `App.jsx`, `repository.js`, `twinApi.js`. |
| Persistencia | Lee y escribe el estado operativo. | `supabaseRepository.js`, `localRepository.js`. |
| Dominio | Calcula reglas y escenarios sin alterar la operación real. | MRP, capacidad, alertas y simulación What-if. |
| Datos | Conserva maestros y transacciones. | PostgreSQL/Supabase y sus relaciones. |
