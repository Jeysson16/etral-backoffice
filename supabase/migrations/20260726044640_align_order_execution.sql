-- Separa los maestros (clientes/productos) de la ejecución de órdenes y hace
-- transaccionales las reservas y el avance productivo.

create table if not exists public.customers (
  id text primary key,
  document_number text unique,
  name text not null,
  contact_name text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ceco_orders add column if not exists customer_id text references public.customers(id);

insert into public.customers (id, name)
select 'customer-' || md5(lower(trim(customer))), trim(customer)
from public.ceco_orders
where trim(customer) <> ''
on conflict (id) do nothing;

update public.ceco_orders o
set customer_id = c.id
from public.customers c
where o.customer_id is null and lower(trim(o.customer)) = lower(trim(c.name));

create table if not exists public.order_material_reservations (
  id text primary key,
  ceco text not null references public.ceco_orders(ceco) on delete cascade,
  bom_item_id text references public.bom_items(id),
  stage_id text references public.flow_stages(id),
  material_code text not null references public.inventory_items(code),
  required_quantity numeric not null check (required_quantity > 0),
  reserved_quantity numeric not null default 0 check (reserved_quantity >= 0),
  issued_quantity numeric not null default 0 check (issued_quantity >= 0),
  consumed_quantity numeric not null default 0 check (consumed_quantity >= 0),
  status text not null default 'pending' check (status in ('pending','partial','reserved','issued','consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ceco, bom_item_id)
);

create index if not exists idx_reservations_ceco_stage on public.order_material_reservations(ceco, stage_id);
create index if not exists idx_reservations_material_status on public.order_material_reservations(material_code, status);

-- Reconstruye reservas de órdenes existentes desde la BOM, respetando stock
-- disponible y prioridad. A partir de aquí committed deriva de estas reservas.
do $$
declare v_order record; v_bom record; v_available numeric; v_reserved numeric;
begin
  if not exists (select 1 from public.order_material_reservations) then
    update public.inventory_items set committed = 0;
    for v_order in select * from public.ceco_orders where progress < 100 order by priority, created_at loop
      for v_bom in select * from public.bom_items where body_type_id = v_order.body_type_id order by material_code, id loop
        select greatest(0, physical - committed) into v_available from public.inventory_items where code = v_bom.material_code for update;
        v_reserved := least(v_bom.quantity, coalesce(v_available, 0));
        insert into public.order_material_reservations(id, ceco, bom_item_id, stage_id, material_code, required_quantity, reserved_quantity, status)
        values ('reservation-' || v_order.ceco || '-' || v_bom.id, v_order.ceco, v_bom.id, v_bom.stage_id, v_bom.material_code, v_bom.quantity, v_reserved,
          case when v_reserved = 0 then 'pending' when v_reserved < v_bom.quantity then 'partial' else 'reserved' end);
        update public.inventory_items set committed = committed + v_reserved where code = v_bom.material_code;
      end loop;
    end loop;
  end if;
end $$;

create or replace function public.calculate_inventory_safety()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.service_factor is not null and new.demand_std_dev is not null and new.lead_time_days is not null then
    new.safety := ceil(greatest(0, new.service_factor * new.demand_std_dev * sqrt(new.lead_time_days)));
  end if;
  return new;
end; $$;

drop trigger if exists trg_calculate_inventory_safety on public.inventory_items;
create trigger trg_calculate_inventory_safety
before insert or update of service_factor, demand_std_dev, lead_time_days
on public.inventory_items for each row execute function public.calculate_inventory_safety();

create or replace function public.recalculate_order_execution(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_product text;
  v_stage text;
  v_route_count int;
  v_total int;
  v_completed int;
  v_weighted numeric;
  v_blocked boolean;
  v_shortage boolean;
begin
  select body_type_id, stage_id into v_product, v_stage from ceco_orders where ceco = p_ceco;
  select count(*) into v_route_count from product_routes where product_id = v_product;
  select count(*), count(*) filter (where coalesce(p.status, 'pending') = 'completed'),
         coalesce(sum(coalesce(p.progress, 0)), 0),
         bool_or(coalesce(p.status, 'pending') = 'blocked')
  into v_total, v_completed, v_weighted, v_blocked
  from product_routes r
  join stage_activities a on a.stage_id = r.stage_id and a.active
  left join ceco_activity_progress p on p.ceco = p_ceco and p.activity_id = a.id
  where r.product_id = v_product;

  select exists(select 1 from order_material_reservations where ceco = p_ceco and reserved_quantity < required_quantity)
  into v_shortage;

  update ceco_orders
  set progress = case when v_total = 0 then 0 else round(v_weighted / v_total, 2) end,
      status = case when v_blocked or v_shortage then 'red' when v_total > 0 and v_completed = v_total then 'green' else 'orange' end,
      plant_state = case when v_shortage then 'Bloqueado por material' when v_blocked then 'Actividad bloqueada' when v_total > 0 and v_completed = v_total then 'Completado' else 'En proceso' end
  where ceco = p_ceco;
end; $$;

create or replace function public.set_order_activity_progress(
  p_ceco text, p_activity_id text, p_status text, p_progress numeric
) returns void language plpgsql security invoker set search_path = public as $$
declare v_now timestamptz := now();
begin
  if p_status not in ('pending','in_progress','completed','blocked') then raise exception 'Estado de actividad no válido'; end if;
  if p_progress < 0 or p_progress > 100 then raise exception 'El avance debe estar entre 0 y 100'; end if;
  if not exists (
    select 1 from ceco_orders o join product_routes r on r.product_id = o.body_type_id
    join stage_activities a on a.stage_id = r.stage_id
    where o.ceco = p_ceco and a.id = p_activity_id
  ) then raise exception 'La actividad no pertenece a la ruta de esta orden'; end if;

  insert into ceco_activity_progress(id, ceco, activity_id, status, progress, started_at, finished_at, updated_at)
  values ('progress-' || p_ceco || '-' || p_activity_id, p_ceco, p_activity_id, p_status, p_progress,
    case when p_status = 'pending' then null else v_now end,
    case when p_status = 'completed' then v_now else null end, v_now)
  on conflict (ceco, activity_id) do update set
    status = excluded.status, progress = excluded.progress,
    started_at = case when excluded.status = 'pending' then null else coalesce(ceco_activity_progress.started_at, excluded.started_at) end,
    finished_at = case when excluded.status = 'completed' then coalesce(ceco_activity_progress.finished_at, excluded.finished_at) else null end,
    updated_at = v_now;
  perform recalculate_order_execution(p_ceco);
end; $$;

create or replace function public.create_order_with_reservations(
  p_customer_id text, p_customer_name text, p_body_type_id text, p_line text, p_due_date date
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_ceco text;
  v_customer_id text;
  v_first_stage text;
  v_bom record;
  v_available numeric;
  v_reserved numeric;
begin
  v_customer_id := nullif(p_customer_id, '');
  if v_customer_id is null then
    if trim(coalesce(p_customer_name, '')) = '' then raise exception 'El cliente es obligatorio'; end if;
    v_customer_id := 'customer-' || md5(lower(trim(p_customer_name)));
    insert into customers(id, name) values (v_customer_id, trim(p_customer_name)) on conflict (id) do nothing;
  end if;
  select name into p_customer_name from customers where id = v_customer_id and active;
  if p_customer_name is null then raise exception 'Cliente no encontrado o inactivo'; end if;
  select stage_id into v_first_stage from product_routes where product_id = p_body_type_id order by sequence limit 1;
  if v_first_stage is null then raise exception 'El producto no tiene una ruta de fabricación'; end if;
  v_ceco := next_ceco_code();
  insert into ceco_orders(id, ceco, customer, customer_id, body_type_id, progress, line, status, stage_id, plant_state, priority, due_date)
  values ('order-' || v_ceco, v_ceco, p_customer_name, v_customer_id, p_body_type_id, 0, p_line, 'orange', v_first_stage, 'En cola', 999, p_due_date);

  for v_bom in select * from bom_items where body_type_id = p_body_type_id order by material_code, id loop
    select greatest(0, physical - committed) into v_available from inventory_items where code = v_bom.material_code for update;
    v_reserved := least(v_bom.quantity, coalesce(v_available, 0));
    insert into order_material_reservations(id, ceco, bom_item_id, stage_id, material_code, required_quantity, reserved_quantity, status)
    values ('reservation-' || v_ceco || '-' || v_bom.id, v_ceco, v_bom.id, v_bom.stage_id, v_bom.material_code, v_bom.quantity, v_reserved,
      case when v_reserved = 0 then 'pending' when v_reserved < v_bom.quantity then 'partial' else 'reserved' end);
    if v_reserved > 0 then
      update inventory_items set committed = committed + v_reserved where code = v_bom.material_code;
      insert into inventory_movements(id, type, code, ceco, quantity, note)
      values ('mov-' || v_ceco || '-' || v_bom.id, 'reserva', v_bom.material_code, v_ceco, v_reserved, 'Reserva automática por apertura CECO');
    end if;
  end loop;
  perform recalculate_order_execution(v_ceco);
  return v_ceco;
end; $$;

create or replace function public.move_order_to_stage(p_ceco text, p_stage_id text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_product text; v_current text; v_current_seq int; v_target_seq int; v_incomplete int;
begin
  select body_type_id, stage_id into v_product, v_current from ceco_orders where ceco = p_ceco for update;
  select sequence into v_current_seq from product_routes where product_id = v_product and stage_id = v_current;
  select sequence into v_target_seq from product_routes where product_id = v_product and stage_id = p_stage_id;
  if v_target_seq is null then raise exception 'La fase no pertenece a la ruta del producto'; end if;
  if v_target_seq > v_current_seq + 1 then raise exception 'La orden solo puede avanzar a la siguiente fase'; end if;
  if v_target_seq = v_current_seq + 1 then
    select count(*) into v_incomplete from stage_activities a left join ceco_activity_progress p on p.ceco = p_ceco and p.activity_id = a.id
    where a.stage_id = v_current and a.active and coalesce(p.status, 'pending') <> 'completed';
    if v_incomplete > 0 then raise exception 'Completa todas las actividades de la fase actual antes de avanzar'; end if;
  end if;
  update ceco_orders set stage_id = p_stage_id, plant_state = 'En proceso' where ceco = p_ceco;
  perform recalculate_order_execution(p_ceco);
end; $$;

create or replace function public.issue_material_to_order(p_ceco text, p_material_code text, p_quantity numeric)
returns text language plpgsql security invoker set search_path = public as $$
declare v_ticket text; v_physical numeric; v_pending numeric; v_left numeric := p_quantity; v_row record; v_take numeric;
begin
  if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
  if not exists (select 1 from ceco_orders where ceco = p_ceco) then raise exception 'CECO no encontrado'; end if;
  select physical into v_physical from inventory_items where code = p_material_code for update;
  if v_physical is null then raise exception 'Material no encontrado'; end if;
  select coalesce(sum(reserved_quantity - issued_quantity), 0) into v_pending
  from order_material_reservations where ceco = p_ceco and material_code = p_material_code;
  if v_pending < p_quantity then raise exception 'La cantidad supera la reserva pendiente de la orden'; end if;
  if v_physical < p_quantity then raise exception 'Stock físico insuficiente'; end if;

  for v_row in select id, reserved_quantity, issued_quantity from order_material_reservations
    where ceco = p_ceco and material_code = p_material_code and issued_quantity < reserved_quantity
    order by created_at for update loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.reserved_quantity - v_row.issued_quantity);
    update order_material_reservations set issued_quantity = issued_quantity + v_take,
      status = case when issued_quantity + v_take >= required_quantity then 'issued' else 'partial' end,
      updated_at = now() where id = v_row.id;
    v_left := v_left - v_take;
  end loop;

  v_ticket := next_warehouse_ticket();
  insert into warehouse_exits(id, ticket, ceco, material_code, quantity)
  values ('wh-' || v_ticket, v_ticket, p_ceco, p_material_code, p_quantity);
  update inventory_items set physical = physical - p_quantity, committed = greatest(0, committed - p_quantity) where code = p_material_code;
  insert into inventory_movements(id, type, code, ceco, quantity, note)
  values ('mov-' || v_ticket, 'salida', p_material_code, p_ceco, p_quantity, 'Entrega de reserva · ticket ' || v_ticket);
  return v_ticket;
end; $$;

create or replace function public.save_product_template(
  p_id text, p_code text, p_family text, p_name text, p_target_days numeric, p_output_unit text, p_route text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare v_id text := nullif(p_id, ''); v_stage text; v_sequence int := 0;
begin
  if cardinality(p_route) = 0 then raise exception 'Selecciona al menos una fase'; end if;
  if v_id is null then v_id := 'body-' || regexp_replace(lower(p_code), '[^a-z0-9]+', '-', 'g') || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint; end if;
  insert into body_types(id, code, family, name, target_days, output_unit)
  values(v_id, trim(p_code), trim(p_family), trim(p_name), p_target_days, p_output_unit)
  on conflict (id) do update set code=excluded.code, family=excluded.family, name=excluded.name, target_days=excluded.target_days, output_unit=excluded.output_unit;
  delete from product_routes where product_id = v_id;
  foreach v_stage in array p_route loop
    v_sequence := v_sequence + 1;
    insert into product_routes(product_id, stage_id, sequence) values(v_id, v_stage, v_sequence);
  end loop;
  return v_id;
end; $$;

alter table public.customers enable row level security;
alter table public.order_material_reservations enable row level security;
drop policy if exists demo_access on public.customers;
drop policy if exists demo_access on public.order_material_reservations;
create policy demo_access on public.customers for all to anon, authenticated using (true) with check (true);
create policy demo_access on public.order_material_reservations for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.customers, public.order_material_reservations to anon, authenticated;
revoke execute on function public.create_order_with_reservations(text,text,text,text,date) from public;
revoke execute on function public.set_order_activity_progress(text,text,text,numeric) from public;
revoke execute on function public.move_order_to_stage(text,text) from public;
revoke execute on function public.save_product_template(text,text,text,text,numeric,text,text[]) from public;
revoke execute on function public.issue_material_to_order(text,text,numeric) from public;
grant execute on function public.create_order_with_reservations(text,text,text,text,date),
  public.set_order_activity_progress(text,text,text,numeric), public.move_order_to_stage(text,text),
  public.save_product_template(text,text,text,text,numeric,text,text[]),
  public.issue_material_to_order(text,text,numeric) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='customers') then
    alter publication supabase_realtime add table public.customers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_material_reservations') then
    alter publication supabase_realtime add table public.order_material_reservations;
  end if;
end $$;
