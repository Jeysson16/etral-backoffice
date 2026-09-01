-- ETRAL · Modelo operativo para Supabase
-- Ejecutar completo en SQL Editor antes de seed.sql.

create table if not exists material_categories (
  id text primary key,
  name text unique not null,
  description text,
  active boolean not null default true
);

create table if not exists measurement_units (
  id text primary key,
  name text unique not null,
  symbol text unique not null,
  active boolean not null default true
);

create table if not exists brands (
  id text primary key,
  name text unique not null,
  active boolean not null default true
);

create table if not exists activity_types (
  code text primary key,
  name text unique not null,
  diagram_symbol text not null
);

create table if not exists flow_stages (
  id text primary key,
  "order" int not null,
  name text not null,
  short_name text not null,
  capacity_hours numeric not null default 0 check (capacity_hours >= 0),
  standard_hours numeric not null default 0 check (standard_hours >= 0),
  color text not null default '#f36b21',
  gated_by_quality boolean not null default false,
  code text unique,
  created_at timestamptz not null default now()
);

create table if not exists stage_activities (
  id text primary key,
  stage_id text not null references flow_stages(id) on delete cascade,
  sequence int not null check (sequence > 0),
  name text not null,
  standard_minutes numeric not null default 0 check (standard_minutes >= 0),
  active boolean not null default true,
  activity_type_code text not null default 'operation' references activity_types(code),
  unique (stage_id, sequence)
);

create table if not exists body_types (
  id text primary key,
  code text unique not null,
  family text not null,
  name text not null,
  target_days numeric not null default 0 check (target_days >= 0),
  output_unit text not null default 'und'
);

create table if not exists product_routes (
  product_id text not null references body_types(id) on delete cascade,
  stage_id text not null references flow_stages(id),
  sequence int not null check (sequence > 0),
  primary key (product_id, stage_id),
  unique (product_id, sequence)
);

create table if not exists inventory_items (
  id text primary key,
  code text unique not null,
  category text not null default 'Material',
  description text not null,
  physical numeric not null default 0 check (physical >= 0),
  committed numeric not null default 0 check (committed >= 0),
  safety numeric not null default 0 check (safety >= 0),
  service_factor numeric,
  demand_std_dev numeric,
  lead_time_days numeric,
  unit_cost numeric,
  currency text not null default 'PEN',
  unit text not null default 'und',
  location text
  ,category_id text references material_categories(id)
  ,unit_id text references measurement_units(id)
  ,brand_id text references brands(id)
);

create table if not exists bom_items (
  id text primary key,
  body_type_id text not null references body_types(id) on delete cascade,
  stage_id text references flow_stages(id),
  material_code text not null references inventory_items(code),
  piece_code text not null,
  description text not null,
  length_mm numeric not null default 0 check (length_mm >= 0),
  quantity numeric not null check (quantity > 0)
);

create table if not exists ceco_orders (
  id text primary key,
  ceco text unique not null,
  customer text not null,
  body_type_id text not null references body_types(id),
  progress numeric not null default 0 check (progress between 0 and 100),
  line text not null,
  status text not null check (status in ('green', 'orange', 'red')),
  stage_id text references flow_stages(id),
  plant_state text not null,
  priority int not null default 999,
  planned_start_date date,
  due_date date,
  created_at timestamptz not null default now()
);

create table if not exists stage_inventory (
  id text primary key,
  stage_id text not null references flow_stages(id),
  ceco text not null references ceco_orders(ceco) on delete cascade,
  item text not null,
  quantity numeric not null default 0 check (quantity >= 0),
  unit text not null default 'und',
  status text not null check (status in ('waiting', 'processing', 'blocked', 'released')),
  updated_at timestamptz not null default now()
);

create table if not exists ceco_activity_progress (
  id text primary key,
  ceco text not null references ceco_orders(ceco) on delete cascade,
  activity_id text not null references stage_activities(id) on delete cascade,
  status text not null check (status in ('pending', 'in_progress', 'completed', 'blocked')),
  progress numeric not null default 0 check (progress between 0 and 100),
  started_at timestamptz,
  finished_at timestamptz,
  planned_start_date date,
  planned_end_date date,
  check (planned_start_date is null or planned_end_date is null or planned_start_date <= planned_end_date),
  updated_at timestamptz not null default now(),
  unique (ceco, activity_id)
);

create table if not exists work_shifts (
  id text primary key,
  code text unique not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 0 check (break_minutes between 0 and 240),
  active boolean not null default true
);

create table if not exists personnel (
  id text primary key,
  employee_code text unique not null,
  name text not null,
  role text not null,
  specialty text,
  shift_id text references work_shifts(id),
  status text not null check (status in ('available', 'assigned', 'absent', 'leave')),
  efficiency numeric not null default 100 check (efficiency between 1 and 150),
  weekly_hours numeric not null default 48 check (weekly_hours between 0 and 84),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists equipment (
  id text primary key,
  code text unique not null,
  name text not null,
  stage_id text not null references flow_stages(id),
  status text not null check (status in ('operational', 'restricted', 'maintenance', 'out_of_service')),
  capacity_hours numeric not null default 0 check (capacity_hours >= 0),
  maintenance_due date,
  created_at timestamptz not null default now()
);

create table if not exists work_calendar (
  id text primary key,
  calendar_date date unique not null,
  day_type text not null check (day_type in ('working', 'reduced', 'holiday', 'shutdown')),
  available_hours numeric not null default 8 check (available_hours between 0 and 24),
  note text
);

create table if not exists resource_assignments (
  id text primary key,
  personnel_id text not null references personnel(id),
  ceco text not null references ceco_orders(ceco),
  activity_id text not null references stage_activities(id),
  assigned_date date not null,
  planned_hours numeric not null check (planned_hours > 0 and planned_hours <= 24),
  status text not null check (status in ('planned', 'in_progress', 'completed', 'blocked')),
  created_at timestamptz not null default now()
);

create table if not exists operational_incidents (
  id text primary key,
  occurred_at timestamptz not null default now(),
  type text not null check (type in ('equipment', 'material', 'quality', 'personnel', 'safety', 'other')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  stage_id text not null references flow_stages(id),
  ceco text references ceco_orders(ceco),
  equipment_id text references equipment(id),
  downtime_hours numeric not null default 0 check (downtime_hours >= 0),
  description text not null,
  status text not null check (status in ('open', 'investigating', 'resolved')),
  created_at timestamptz not null default now()
);

create table if not exists operation_logs (
  id text primary key,
  date date not null,
  ceco text not null references ceco_orders(ceco),
  worker text not null,
  activity text not null,
  total_hours numeric not null default 0 check (total_hours > 0),
  created_at timestamptz not null default now()
);

create table if not exists warehouse_exits (
  id text primary key,
  ticket text unique not null,
  ceco text references ceco_orders(ceco),
  material_code text not null references inventory_items(code),
  quantity numeric not null default 0 check (quantity > 0),
  timestamp timestamptz not null default now()
);

create table if not exists quality_checks (
  id text primary key,
  ceco text not null references ceco_orders(ceco),
  stage_id text not null references flow_stages(id),
  inspector text not null,
  approval text not null check (approval in ('approved', 'observed', 'pending')),
  observations text,
  created_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id text primary key,
  type text not null check (type in ('ingreso', 'reserva', 'salida', 'consumo', 'ajuste', 'liberacion')),
  code text not null references inventory_items(code),
  ceco text,
  quantity numeric not null check (quantity > 0),
  timestamp timestamptz not null default now(),
  note text
);

create table if not exists simulation_runs (
  id bigint generated by default as identity primary key,
  name text not null,
  parameters jsonb not null,
  results jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Compatibilidad al aplicar este esquema sobre la versión inicial de la demo.
alter table flow_stages add column if not exists standard_hours numeric not null default 0;
alter table flow_stages add column if not exists code text;
alter table body_types add column if not exists code text;
alter table body_types add column if not exists family text;
alter table body_types add column if not exists output_unit text not null default 'und';
alter table inventory_items add column if not exists location text;
alter table inventory_items add column if not exists service_factor numeric;
alter table inventory_items add column if not exists demand_std_dev numeric;
alter table inventory_items add column if not exists lead_time_days numeric;
alter table inventory_items add column if not exists unit_cost numeric;
alter table inventory_items add column if not exists currency text not null default 'PEN';
alter table inventory_items add column if not exists category_id text references material_categories(id);
alter table inventory_items add column if not exists unit_id text references measurement_units(id);
alter table inventory_items add column if not exists brand_id text references brands(id);
alter table stage_activities add column if not exists activity_type_code text references activity_types(code);
alter table bom_items add column if not exists stage_id text references flow_stages(id);
create unique index if not exists idx_body_types_code on body_types(code) where code is not null;

create index if not exists idx_activity_stage on stage_activities(stage_id, sequence);
create index if not exists idx_inventory_category on inventory_items(category_id);
create index if not exists idx_routes_product on product_routes(product_id, sequence);
create index if not exists idx_orders_stage on ceco_orders(stage_id, status);
create index if not exists idx_orders_due on ceco_orders(due_date);
create index if not exists idx_orders_pmp_schedule on ceco_orders(planned_start_date, due_date);
create index if not exists idx_bom_product on bom_items(body_type_id);
create index if not exists idx_movements_code_time on inventory_movements(code, timestamp desc);
create index if not exists idx_wip_stage on stage_inventory(stage_id, status);
create index if not exists idx_activity_progress_ceco on ceco_activity_progress(ceco, status);
create index if not exists idx_personnel_shift on personnel(shift_id, status) where active;
create index if not exists idx_equipment_stage on equipment(stage_id, status);
create index if not exists idx_assignments_person_date on resource_assignments(personnel_id, assigned_date);
create index if not exists idx_assignments_ceco on resource_assignments(ceco, status);
create index if not exists idx_assignments_activity on resource_assignments(activity_id);
create index if not exists idx_incidents_stage_status on operational_incidents(stage_id, status);
create index if not exists idx_incidents_ceco on operational_incidents(ceco) where ceco is not null;
create index if not exists idx_incidents_equipment on operational_incidents(equipment_id) where equipment_id is not null;

create or replace function next_ceco_code()
returns text language plpgsql set search_path = public as $$
declare prefix text := to_char(now(), 'YY'); max_seq int;
begin
  select coalesce(max(substring(ceco from 3)::int), 0) into max_seq from ceco_orders where ceco like prefix || '%';
  return prefix || lpad((max_seq + 1)::text, 4, '0');
end; $$;

create or replace function next_inventory_code(category_prefix text)
returns text language plpgsql set search_path = public as $$
declare prefix text := upper(left(regexp_replace(category_prefix, '[^A-Za-z]', '', 'g'), 3)); max_seq int;
begin
  if prefix = '' then prefix := 'MAT'; end if;
  select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) into max_seq from inventory_items where code like prefix || '-%';
  return prefix || '-' || lpad((max_seq + 1)::text, 4, '0');
end; $$;

create or replace function next_warehouse_ticket()
returns text language plpgsql set search_path = public as $$
declare max_seq int;
begin
  select coalesce(max(nullif(split_part(ticket, '-', 2), '')::int), 7000) into max_seq from warehouse_exits where ticket like 'SAL-%';
  return 'SAL-' || (max_seq + 1)::text;
end; $$;

-- Acceso de producción: el navegador usa únicamente la clave pública y cada
-- operación requiere una sesión válida de Supabase Auth. Este proyecto opera
-- como una única planta; si se agregan sedes, reemplazar la regla por una
-- pertenencia de planta basada en auth.uid().
alter table flow_stages enable row level security;
alter table material_categories enable row level security;
alter table measurement_units enable row level security;
alter table brands enable row level security;
alter table activity_types enable row level security;
alter table stage_activities enable row level security;
alter table body_types enable row level security;
alter table product_routes enable row level security;
alter table inventory_items enable row level security;
alter table bom_items enable row level security;
alter table ceco_orders enable row level security;
alter table stage_inventory enable row level security;
alter table ceco_activity_progress enable row level security;
alter table operation_logs enable row level security;
alter table warehouse_exits enable row level security;
alter table quality_checks enable row level security;
alter table inventory_movements enable row level security;
alter table simulation_runs enable row level security;
alter table work_shifts enable row level security;
alter table personnel enable row level security;
alter table equipment enable row level security;
alter table work_calendar enable row level security;
alter table resource_assignments enable row level security;
alter table operational_incidents enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['material_categories','measurement_units','brands','activity_types','flow_stages','stage_activities','body_types','product_routes','inventory_items','bom_items','ceco_orders','stage_inventory','ceco_activity_progress','work_shifts','personnel','equipment','work_calendar','resource_assignments','operational_incidents','operation_logs','warehouse_exits','quality_checks','inventory_movements']
  loop
    execute format('drop policy if exists demo_access on %I', table_name);
    execute format('drop policy if exists authenticated_access on %I', table_name);
    execute format('create policy authenticated_access on %I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end $$;


drop policy if exists simulation_read on simulation_runs;
drop policy if exists simulation_write on simulation_runs;
create policy simulation_read on simulation_runs for select to authenticated using (created_by = auth.uid());
create policy simulation_write on simulation_runs for insert to authenticated with check (created_by = auth.uid());

-- Supabase Data API: no se concede acceso a anon. La clave pública puede
-- viajar al navegador; RLS y estos grants exigen un JWT de usuario válido.
revoke all on table public.flow_stages, public.stage_activities,
  public.material_categories, public.measurement_units, public.brands, public.activity_types,
  public.body_types, public.product_routes, public.inventory_items, public.bom_items,
  public.ceco_orders, public.stage_inventory, public.ceco_activity_progress,
  public.work_shifts, public.personnel, public.equipment, public.work_calendar,
  public.resource_assignments, public.operational_incidents,
  public.operation_logs, public.warehouse_exits, public.quality_checks,
  public.inventory_movements from anon;
grant select, insert, update, delete on table public.flow_stages, public.stage_activities,
  public.material_categories, public.measurement_units, public.brands, public.activity_types,
  public.body_types, public.product_routes, public.inventory_items, public.bom_items,
  public.ceco_orders, public.stage_inventory, public.ceco_activity_progress,
  public.work_shifts, public.personnel, public.equipment, public.work_calendar,
  public.resource_assignments, public.operational_incidents,
  public.operation_logs, public.warehouse_exits, public.quality_checks,
  public.inventory_movements to authenticated;
revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.next_ceco_code(), public.next_inventory_code(text),
  public.next_warehouse_ticket() from public, anon;
grant execute on function public.next_ceco_code(), public.next_inventory_code(text),
  public.next_warehouse_ticket() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['ceco_orders','inventory_items','inventory_movements','stage_inventory','ceco_activity_progress','personnel','equipment','work_calendar','resource_assignments','operational_incidents','operation_logs','quality_checks']
  loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then execute format('alter publication supabase_realtime add table %I', table_name); end if;
  end loop;
end $$;
