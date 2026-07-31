param([switch]$SkipSeed)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw "Define SUPABASE_DB_URL con la cadena de conexión PostgreSQL de Supabase antes de ejecutar este script."
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
  throw "No se encontró psql. Instala PostgreSQL Client Tools o ejecuta los SQL desde Supabase SQL Editor."
}

$root = Split-Path -Parent $PSScriptRoot
$schema = Join-Path $root "src\supabase\schema.sql"
$orderExecutionMigration = Join-Path $root "supabase\migrations\20260726044640_align_order_execution.sql"
$seed = Join-Path $root "src\supabase\seed.sql"

Write-Host "Aplicando esquema ETRAL..."
& $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$schema"
if ($LASTEXITCODE -ne 0) { throw "Falló la aplicación del esquema." }

Write-Host "Aplicando modelo transaccional de órdenes..."
& $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$orderExecutionMigration"
if ($LASTEXITCODE -ne 0) { throw "Falló la migración de ejecución de órdenes." }

if (-not $SkipSeed) {
  Write-Host "Cargando datos de referencia..."
  & $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$seed"
  if ($LASTEXITCODE -ne 0) { throw "Falló la carga de datos de referencia." }
}

Write-Host "Supabase quedó preparado para ETRAL."
