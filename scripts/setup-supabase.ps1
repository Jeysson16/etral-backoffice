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
$migrations = Join-Path $root "supabase\migrations"
$seed = Join-Path $root "src\supabase\seed.sql"

Write-Host "Aplicando esquema ETRAL..."
& $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$schema"
if ($LASTEXITCODE -ne 0) { throw "Falló la aplicación del esquema." }

Get-ChildItem -Path $migrations -Filter "*.sql" | Sort-Object Name | ForEach-Object {
  Write-Host "Aplicando migración $($_.Name)..."
  & $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$($_.FullName)"
  if ($LASTEXITCODE -ne 0) { throw "Falló la migración $($_.Name)." }
}

if (-not $SkipSeed) {
  Write-Host "Cargando datos de referencia..."
  & $psql.Source $env:SUPABASE_DB_URL "--set=ON_ERROR_STOP=on" "--file=$seed"
  if ($LASTEXITCODE -ne 0) { throw "Falló la carga de datos de referencia." }
}

Write-Host "Supabase quedó preparado para ETRAL."
