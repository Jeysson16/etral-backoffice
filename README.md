# ETRAL · Control de producción y gemelo digital

La descripción del flujo, arquitectura y patrones del gemelo se encuentra en [`docs/arquitectura-gemelo-digital.md`](docs/arquitectura-gemelo-digital.md). El detalle de tablas, relaciones y su uso en el frontend está en [`docs/modelo-datos-y-flujo.md`](docs/modelo-datos-y-flujo.md).

Aplicación React para registrar productos, rutas variables, fases, actividades, materiales, inventario, BOM, órdenes CECO y ejecución de planta. El simulador compara el plan vigente contra un escenario sin alterar los registros operativos.

## Ejecutar

```powershell
npm install
npm run dev:simple
```

`dev:mocks` utiliza el repositorio local. `dev:simple` utiliza Supabase y ejecuta la simulación en el frontend con el motor JS. `dev:python` utiliza Supabase y delega el gemelo digital al backend Python mediante `VITE_TWIN_API_URL`.

## Modelo funcional

- Producto → ruta variable de fabricación.
- Fase → actividades ordenadas, tiempo estándar y control de calidad.
- CECO → producto, fase actual, prioridad, avance y fecha pactada.
- Inventario → físico, comprometido, disponible, seguridad y proyección MRP.
- Inventario en proceso → CECO y componentes ubicados en cada fase.
- BOM → material, cantidad y fase en la que se consume.
- Gemelo digital → horizonte, personal, turnos, demanda, ajuste de stock y prioridad CECO.

Las fases y actividades de demostración se basan en `DOP DE FURGÓN ACANALADO.xlsx`, `RESUMEN DE PRODUCCION.xlsx` y `AVANCE DE CECOS.xlsx`.

## Configurar Supabase y enlazar la aplicación

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard), abre **Connect** y copia la URL del proyecto y la clave pública publishable. Copia `.env.example` como `.env.supabase` y completa:

```text
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
VITE_DATA_MODE=supabase
VITE_TWIN_ENGINE=browser
VITE_TWIN_API_URL=http://127.0.0.1:8000
```

2. En **Connect**, copia la cadena de conexión directa de PostgreSQL y define la variable solo en la terminal. El instalador aplica el esquema, permisos explícitos Data API, RLS y datos iniciales:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:TU_PASSWORD@db.TU_PROYECTO.supabase.co:5432/postgres"
npm run supabase:setup
```

El instalador exige `psql`, detiene la ejecución ante el primer error y aplica, en orden, `src/supabase/schema.sql`, la migración de ejecución de órdenes y `src/supabase/seed.sql`.

Para instalar solo el esquema:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-supabase.ps1 -SkipSeed
```

También puedes ejecutar manualmente esos SQL desde Supabase SQL Editor respetando el mismo orden. Las políticas incluidas permiten acceso `anon` para la demostración; deben restringirse por usuario/rol antes de producción.

3. Para la versión simple, inicia solo el frontend. Esta versión sirve para validar flujos, data, selectores y toma de decisiones operativa sin depender de Python:

```powershell
npm run dev:simple
```

4. Para la versión avanzada, inicia el motor Python y luego el frontend. Esta versión conviene cuando el gemelo digital empiece a usar lógica más pesada: optimización, escenarios comparados, predicción, restricciones por capacidad fina o modelos de decisión:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# nueva terminal, desde la raíz del proyecto
npm run dev:python
```

No incluyas `SUPABASE_DB_URL`, la clave `service_role` ni la contraseña de base de datos en variables `VITE_*`: esas se exponen en el navegador. La publishable key es la única clave de Supabase que debe estar en el frontend. Las políticas actuales son deliberadamente abiertas para la demostración; antes de producción hay que incorporar autenticación y políticas por rol.

## Verificación

```powershell
npm test
npm run build
```

## Backend Python: motor del gemelo digital

El directorio `backend/` incorpora la API que concentra la lógica de negocio: generación de CECO, reserva MRP por prioridad y simulación aislada de escenarios *what-if*. El frontend seguirá siendo responsable de visualizar los resultados, no de tomar decisiones de planificación.

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Documentación interactiva: `http://127.0.0.1:8000/docs`.

Los endpoints iniciales son `POST /api/v1/cecos/code`, `POST /api/v1/mrp/evaluate` y `POST /api/v1/simulations`. Las corridas reciben un snapshot de planta y son aisladas: no modifican inventario, prioridades ni órdenes reales. La siguiente integración conectará estos snapshots al esquema de PostgreSQL/Supabase ya incluido en `src/supabase/schema.sql`.
