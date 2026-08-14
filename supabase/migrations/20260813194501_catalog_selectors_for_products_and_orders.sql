-- Catálogos reales para los selectores de Productos y Órdenes.
-- Se conservan family/output_unit/line como textos de lectura para no romper
-- reportes ni integraciones existentes, pero las nuevas relaciones guardan el ID.

create table if not exists public.product_families (
  id text primary key,
  name text unique not null,
  active boolean not null default true
);

create table if not exists public.production_lines (
  id text primary key,
  name text unique not null,
  active boolean not null default true
);

insert into public.measurement_units (id, name, symbol)
values ('unit-serv', 'Servicio', 'serv')
on conflict (id) do update set name = excluded.name, symbol = excluded.symbol;

insert into public.product_families (id, name)
select 'family-' || md5(lower(trim(family))), trim(family)
from public.body_types
where trim(family) <> ''
on conflict (name) do nothing;

insert into public.production_lines (id, name)
select 'line-' || md5(lower(trim(line))), trim(line)
from public.ceco_orders
where trim(line) <> ''
on conflict (name) do nothing;

insert into public.production_lines (id, name) values
  ('line-1', 'Línea 1'),
  ('line-2', 'Línea 2'),
  ('line-3', 'Línea 3')
on conflict (name) do nothing;

alter table public.body_types
  add column if not exists family_id text references public.product_families(id),
  add column if not exists brand_id text references public.brands(id),
  add column if not exists output_unit_id text references public.measurement_units(id);

alter table public.ceco_orders
  add column if not exists production_line_id text references public.production_lines(id);

update public.body_types p
set family_id = f.id
from public.product_families f
where p.family_id is null and lower(trim(p.family)) = lower(trim(f.name));

update public.body_types p
set output_unit_id = u.id
from public.measurement_units u
where p.output_unit_id is null and lower(trim(p.output_unit)) = lower(trim(u.symbol));

update public.body_types
set brand_id = (select id from public.brands where lower(name) = 'etral' limit 1)
where brand_id is null;

update public.ceco_orders o
set production_line_id = l.id
from public.production_lines l
where o.production_line_id is null and lower(trim(o.line)) = lower(trim(l.name));

create or replace function public.sync_order_production_line()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_line public.production_lines%rowtype;
begin
  select * into v_line
  from public.production_lines
  where active and (id = new.line or lower(name) = lower(trim(new.line)))
  limit 1;
  if v_line.id is null then raise exception 'Línea de producción no encontrada o inactiva'; end if;
  new.production_line_id := v_line.id;
  new.line := v_line.name;
  return new;
end; $$;

drop trigger if exists trg_sync_order_production_line on public.ceco_orders;
create trigger trg_sync_order_production_line
before insert or update of line, production_line_id on public.ceco_orders
for each row execute function public.sync_order_production_line();

create or replace function public.save_product_template(
  p_id text, p_code text, p_family_id text, p_brand_id text, p_name text,
  p_target_days numeric, p_output_unit_id text, p_route text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_id text := nullif(p_id, '');
  v_family text;
  v_output_unit text;
  v_stage text;
  v_sequence int := 0;
begin
  select name into v_family from product_families where id = p_family_id and active;
  if v_family is null then raise exception 'Familia de producto no encontrada o inactiva'; end if;
  if not exists (select 1 from brands where id = p_brand_id and active) then raise exception 'Marca no encontrada o inactiva'; end if;
  select symbol into v_output_unit from measurement_units where id = p_output_unit_id and active;
  if v_output_unit is null then raise exception 'Unidad de salida no encontrada o inactiva'; end if;
  if cardinality(p_route) = 0 then raise exception 'Selecciona al menos una fase'; end if;
  if v_id is null then
    v_id := 'body-' || regexp_replace(lower(p_code), '[^a-z0-9]+', '-', 'g') || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  end if;
  insert into body_types(id, code, family, family_id, brand_id, name, target_days, output_unit, output_unit_id)
  values(v_id, trim(p_code), v_family, p_family_id, p_brand_id, trim(p_name), p_target_days, v_output_unit, p_output_unit_id)
  on conflict (id) do update set
    code = excluded.code, family = excluded.family, family_id = excluded.family_id,
    brand_id = excluded.brand_id, name = excluded.name, target_days = excluded.target_days,
    output_unit = excluded.output_unit, output_unit_id = excluded.output_unit_id;
  delete from product_routes where product_id = v_id;
  foreach v_stage in array p_route loop
    v_sequence := v_sequence + 1;
    insert into product_routes(product_id, stage_id, sequence) values(v_id, v_stage, v_sequence);
  end loop;
  return v_id;
end; $$;

alter table public.product_families enable row level security;
alter table public.production_lines enable row level security;
drop policy if exists demo_access on public.product_families;
drop policy if exists demo_access on public.production_lines;
create policy demo_access on public.product_families for select to anon, authenticated using (true);
create policy demo_access on public.production_lines for select to anon, authenticated using (true);

grant select on public.product_families, public.production_lines to anon, authenticated;
revoke execute on function public.save_product_template(text,text,text,text,text,numeric,text,text[]) from public;
grant execute on function public.save_product_template(text,text,text,text,text,numeric,text,text[]) to anon, authenticated;
