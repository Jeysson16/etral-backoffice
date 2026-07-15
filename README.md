# ETRAL · Control de producción y gemelo digital

Aplicación React para registrar productos, rutas variables, fases, actividades, materiales, inventario, BOM, órdenes CECO y ejecución de planta. El simulador compara el plan vigente contra un escenario sin alterar los registros operativos.

## Ejecutar

```powershell
npm install
npm run dev:mocks
```

`dev:mocks` utiliza el repositorio local. `npm run dev` utiliza Supabase y requiere `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.

## Modelo funcional

- Producto → ruta variable de fabricación.
- Fase → actividades ordenadas, tiempo estándar y control de calidad.
- CECO → producto, fase actual, prioridad, avance y fecha pactada.
- Inventario → físico, comprometido, disponible, seguridad y proyección MRP.
- Inventario en proceso → CECO y componentes ubicados en cada fase.
- BOM → material, cantidad y fase en la que se consume.
- Gemelo digital → horizonte, personal, turnos, demanda, ajuste de stock y prioridad CECO.

Las fases y actividades de demostración se basan en `DOP DE FURGÓN ACANALADO.xlsx`, `RESUMEN DE PRODUCCION.xlsx` y `AVANCE DE CECOS.xlsx`.

## Configurar Supabase

1. Copia `.env.example` como `.env.supabase` y completa:

```text
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_ANON
VITE_DATA_MODE=supabase
```

2. Define la conexión PostgreSQL sin guardarla en Git y ejecuta el instalador:

```powershell
$env:SUPABASE_DB_URL="postgresql://postgres:TU_PASSWORD@db.TU_PROYECTO.supabase.co:5432/postgres"
npm run supabase:setup
```

El instalador exige `psql`, detiene la ejecución ante el primer error y aplica, en orden, `src/supabase/schema.sql` y `src/supabase/seed.sql`.

Para instalar solo el esquema:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-supabase.ps1 -SkipSeed
```

También puedes ejecutar ambos SQL manualmente desde Supabase SQL Editor. Las políticas incluidas permiten acceso `anon` para la demostración; deben restringirse por usuario/rol antes de producción.

## Verificación

```powershell
npm test
npm run build
```
