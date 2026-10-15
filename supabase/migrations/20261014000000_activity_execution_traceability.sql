-- Mantiene sincronizada la fase actual del CECO con la actividad realmente
-- iniciada y conserva la actividad/fase en partes diarios y entregas de material.

alter table public.operation_logs
  add column if not exists activity_id text references public.stage_activities(id),
  add column if not exists stage_id text references public.flow_stages(id);

alter table public.warehouse_exits
  add column if not exists activity_id text references public.stage_activities(id),
  add column if not exists stage_id text references public.flow_stages(id);

alter table public.inventory_movements
  add column if not exists activity_id text references public.stage_activities(id),
  add column if not exists stage_id text references public.flow_stages(id);

create index if not exists idx_operation_logs_activity on public.operation_logs(ceco, activity_id);
create index if not exists idx_warehouse_exits_activity on public.warehouse_exits(ceco, activity_id);
create index if not exists idx_inventory_movements_activity on public.inventory_movements(ceco, activity_id);

create or replace function public.set_order_activity_progress(
  p_ceco text, p_activity_id text, p_status text, p_progress numeric
) returns void language plpgsql security invoker set search_path = public as $$
declare
  v_now timestamptz := now();
  v_product text;
  v_current_stage text;
  v_activity_stage text;
  v_current_sequence int;
  v_activity_sequence int;
begin
  if p_status not in ('pending','in_progress','completed','blocked') then
    raise exception 'Estado de actividad no válido';
  end if;
  if p_progress < 0 or p_progress > 100 then
    raise exception 'El avance debe estar entre 0 y 100';
  end if;

  select o.body_type_id, o.stage_id, a.stage_id, current_route.sequence, activity_route.sequence
  into v_product, v_current_stage, v_activity_stage, v_current_sequence, v_activity_sequence
  from public.ceco_orders o
  join public.product_routes activity_route on activity_route.product_id = o.body_type_id
  join public.stage_activities a on a.stage_id = activity_route.stage_id and a.id = p_activity_id and a.active
  left join public.product_routes current_route on current_route.product_id = o.body_type_id and current_route.stage_id = o.stage_id
  where o.ceco = p_ceco;

  if v_activity_stage is null then
    raise exception 'La actividad no pertenece a la ruta de esta orden';
  end if;

  insert into public.ceco_activity_progress(id, ceco, activity_id, status, progress, started_at, finished_at, updated_at)
  values ('progress-' || p_ceco || '-' || p_activity_id, p_ceco, p_activity_id, p_status, p_progress,
    case when p_status = 'pending' then null else v_now end,
    case when p_status = 'completed' then v_now else null end, v_now)
  on conflict (ceco, activity_id) do update set
    status = excluded.status,
    progress = excluded.progress,
    started_at = case when excluded.status = 'pending' then null else coalesce(ceco_activity_progress.started_at, excluded.started_at) end,
    finished_at = case when excluded.status = 'completed' then coalesce(ceco_activity_progress.finished_at, excluded.finished_at) else null end,
    updated_at = v_now;

  -- Una actividad iniciada es evidencia de que la orden ya llegó a esa fase.
  -- Solo se avanza: corregir un registro anterior nunca retrocede el CECO.
  if p_status <> 'pending' and coalesce(v_activity_sequence, -1) > coalesce(v_current_sequence, -1) then
    update public.ceco_orders
    set stage_id = v_activity_stage, plant_state = 'En proceso'
    where ceco = p_ceco;
  end if;

  perform public.recalculate_order_execution(p_ceco);
end; $$;

create or replace function public.register_operation_activity(
  p_date date,
  p_ceco text,
  p_worker text,
  p_activity_id text,
  p_total_hours numeric
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_id text := 'op-' || (extract(epoch from clock_timestamp()) * 1000000)::bigint;
  v_activity_name text;
  v_stage_id text;
  v_status text;
  v_progress numeric;
begin
  if p_total_hours <= 0 then raise exception 'Las horas deben ser mayores que cero'; end if;

  select a.name, a.stage_id
  into v_activity_name, v_stage_id
  from public.ceco_orders o
  join public.product_routes r on r.product_id = o.body_type_id
  join public.stage_activities a on a.stage_id = r.stage_id and a.id = p_activity_id and a.active
  where o.ceco = p_ceco;

  if v_activity_name is null then raise exception 'La actividad no pertenece a la ruta de esta orden'; end if;

  insert into public.operation_logs(id, date, ceco, worker, activity_id, stage_id, activity, total_hours)
  values (v_id, p_date, p_ceco, trim(p_worker), p_activity_id, v_stage_id, v_activity_name, p_total_hours);

  select status, progress into v_status, v_progress
  from public.ceco_activity_progress
  where ceco = p_ceco and activity_id = p_activity_id;

  if coalesce(v_status, 'pending') <> 'completed' then
    perform public.set_order_activity_progress(p_ceco, p_activity_id, 'in_progress', coalesce(v_progress, 0));
  end if;

  return v_id;
end; $$;

create or replace function public.issue_material_to_activity(
  p_ceco text,
  p_material_code text,
  p_quantity numeric,
  p_activity_id text
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_ticket text;
  v_physical numeric;
  v_pending numeric;
  v_left numeric := p_quantity;
  v_stage_id text;
  v_activity_name text;
  v_row record;
  v_take numeric;
begin
  if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;

  select a.stage_id, a.name into v_stage_id, v_activity_name
  from public.ceco_orders o
  join public.product_routes r on r.product_id = o.body_type_id
  join public.stage_activities a on a.stage_id = r.stage_id and a.id = p_activity_id and a.active
  where o.ceco = p_ceco;
  if v_stage_id is null then raise exception 'La actividad no pertenece a la ruta de esta orden'; end if;

  select physical into v_physical from public.inventory_items where code = p_material_code for update;
  if v_physical is null then raise exception 'Material no encontrado'; end if;

  select coalesce(sum(reserved_quantity - issued_quantity), 0) into v_pending
  from public.order_material_reservations
  where ceco = p_ceco and material_code = p_material_code and stage_id = v_stage_id;
  if v_pending < p_quantity then raise exception 'La cantidad supera la reserva pendiente de esta fase'; end if;
  if v_physical < p_quantity then raise exception 'Stock físico insuficiente'; end if;

  for v_row in
    select id, reserved_quantity, issued_quantity
    from public.order_material_reservations
    where ceco = p_ceco and material_code = p_material_code and stage_id = v_stage_id and issued_quantity < reserved_quantity
    order by created_at for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_row.reserved_quantity - v_row.issued_quantity);
    update public.order_material_reservations
    set issued_quantity = issued_quantity + v_take,
        status = case when issued_quantity + v_take >= required_quantity then 'issued' else 'partial' end,
        updated_at = now()
    where id = v_row.id;
    v_left := v_left - v_take;
  end loop;

  v_ticket := public.next_warehouse_ticket();
  insert into public.warehouse_exits(id, ticket, ceco, material_code, activity_id, stage_id, quantity)
  values ('wh-' || v_ticket, v_ticket, p_ceco, p_material_code, p_activity_id, v_stage_id, p_quantity);

  update public.inventory_items
  set physical = physical - p_quantity, committed = greatest(0, committed - p_quantity)
  where code = p_material_code;

  insert into public.inventory_movements(id, type, code, ceco, activity_id, stage_id, quantity, note)
  values ('mov-' || v_ticket, 'salida', p_material_code, p_ceco, p_activity_id, v_stage_id, p_quantity,
    'Entrega a ' || v_activity_name || ' · ticket ' || v_ticket);

  return v_ticket;
end; $$;

revoke execute on function public.register_operation_activity(date,text,text,text,numeric) from public, anon;
revoke execute on function public.issue_material_to_activity(text,text,numeric,text) from public, anon;
grant execute on function public.register_operation_activity(date,text,text,text,numeric) to authenticated;
grant execute on function public.issue_material_to_activity(text,text,numeric,text) to authenticated;
