-- Habilita el módulo de Recursos en instalaciones creadas antes de este módulo.
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
  ceco text not null references ceco_orders(ceco) on update cascade on delete cascade,
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
  ceco text references ceco_orders(ceco) on update cascade on delete cascade,
  equipment_id text references equipment(id),
  downtime_hours numeric not null default 0 check (downtime_hours >= 0),
  description text not null,
  status text not null check (status in ('open', 'investigating', 'resolved')),
  created_at timestamptz not null default now()
);

alter table work_shifts enable row level security;
alter table personnel enable row level security;
alter table equipment enable row level security;
alter table work_calendar enable row level security;
alter table resource_assignments enable row level security;
alter table operational_incidents enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['work_shifts', 'personnel', 'equipment', 'work_calendar', 'resource_assignments', 'operational_incidents']
  loop
    execute format('drop policy if exists authenticated_access on %I', table_name);
    execute format('create policy authenticated_access on %I for all to authenticated using (true) with check (true)', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
  end loop;
end $$;

-- Jornada ordinaria de ETRAL: descanso de 13:00 a 14:00 de lunes a viernes.
insert into work_shifts (id, code, name, start_time, end_time, break_minutes, active) values
  ('shift-mon-thu', 'T1', 'Lunes a jueves', '08:00', '17:20', 60, true),
  ('shift-friday', 'T2', 'Viernes', '08:00', '18:00', 60, true),
  ('shift-saturday', 'T3', 'Sábado', '08:00', '13:00', 0, true)
on conflict (code) do update set
  name = excluded.name,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  break_minutes = excluded.break_minutes,
  active = excluded.active;
