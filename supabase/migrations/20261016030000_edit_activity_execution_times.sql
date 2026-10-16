-- Permite corregir el día y la hora reales de inicio y fin sin alterar el
-- comportamiento automático existente al iniciar o completar una actividad.

drop function if exists public.set_order_activity_progress(text, text, text, numeric, timestamptz, timestamptz, boolean);
drop function if exists public.set_order_activity_progress(text, text, text, numeric);

create function public.set_order_activity_progress(
  p_ceco text,
  p_activity_id text,
  p_status text,
  p_progress numeric,
  p_started_at timestamptz default null,
  p_finished_at timestamptz default null,
  p_update_timestamps boolean default false
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
  if p_update_timestamps and p_status <> 'pending' and p_started_at is null then
    raise exception 'La fecha y hora de inicio son obligatorias';
  end if;
  if p_update_timestamps and p_status = 'completed' and p_finished_at is null then
    raise exception 'La fecha y hora de fin son obligatorias para una actividad completada';
  end if;
  if p_update_timestamps and p_finished_at is not null and p_finished_at < p_started_at then
    raise exception 'La fecha y hora de fin no pueden ser anteriores al inicio';
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
  values (
    'progress-' || p_ceco || '-' || p_activity_id,
    p_ceco,
    p_activity_id,
    p_status,
    p_progress,
    case when p_status = 'pending' then null when p_update_timestamps then p_started_at else v_now end,
    case when p_status = 'completed' then case when p_update_timestamps then p_finished_at else v_now end else null end,
    v_now
  )
  on conflict (ceco, activity_id) do update set
    status = excluded.status,
    progress = excluded.progress,
    started_at = case
      when excluded.status = 'pending' then null
      when p_update_timestamps then p_started_at
      else coalesce(ceco_activity_progress.started_at, excluded.started_at)
    end,
    finished_at = case
      when excluded.status <> 'completed' then null
      when p_update_timestamps then p_finished_at
      else coalesce(ceco_activity_progress.finished_at, excluded.finished_at)
    end,
    updated_at = v_now;

  if p_status <> 'pending' and coalesce(v_activity_sequence, -1) > coalesce(v_current_sequence, -1) then
    update public.ceco_orders
    set stage_id = v_activity_stage, plant_state = 'En proceso'
    where ceco = p_ceco;
  end if;

  perform public.recalculate_order_execution(p_ceco);
end; $$;

revoke execute on function public.set_order_activity_progress(text, text, text, numeric, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.set_order_activity_progress(text, text, text, numeric, timestamptz, timestamptz, boolean) to authenticated;
