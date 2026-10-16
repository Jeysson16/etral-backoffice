-- La fase actual del CECO se deriva del avance real de sus actividades.
-- Así no queda apuntando a una etapa ya completada cuando existen etapas posteriores pendientes.

create or replace function public.recalculate_order_execution(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_product text;
  v_total bigint;
  v_completed bigint;
  v_stage_average numeric;
  v_blocked boolean;
  v_shortage boolean;
  v_current_stage text;
begin
  select body_type_id into v_product from public.ceco_orders where ceco = p_ceco;
  if v_product is null then return; end if;

  select
    coalesce(sum(activity_count), 0),
    coalesce(sum(completed_count), 0),
    coalesce(avg(stage_progress), 0),
    coalesce(bool_or(blocked), false)
  into v_total, v_completed, v_stage_average, v_blocked
  from (
    select
      route.stage_id,
      count(activity.id) as activity_count,
      count(activity.id) filter (where coalesce(progress.status, 'pending') = 'completed') as completed_count,
      coalesce(avg(coalesce(progress.progress, 0)), 0) as stage_progress,
      coalesce(bool_or(coalesce(progress.status, 'pending') = 'blocked'), false) as blocked
    from public.product_routes route
    left join public.stage_activities activity on activity.stage_id = route.stage_id and activity.active
    left join public.ceco_activity_progress progress on progress.ceco = p_ceco and progress.activity_id = activity.id
    where route.product_id = v_product
    group by route.stage_id
  ) stage_execution;

  select route.stage_id
  into v_current_stage
  from public.product_routes route
  where route.product_id = v_product
    and exists (
      select 1
      from public.stage_activities activity
      where activity.stage_id = route.stage_id and activity.active
    )
    and exists (
      select 1
      from public.stage_activities activity
      left join public.ceco_activity_progress progress
        on progress.ceco = p_ceco and progress.activity_id = activity.id
      where activity.stage_id = route.stage_id
        and activity.active
        and coalesce(progress.status, 'pending') <> 'completed'
    )
  order by route.sequence
  limit 1;

  if v_current_stage is null then
    select route.stage_id into v_current_stage
    from public.product_routes route
    where route.product_id = v_product
    order by route.sequence desc
    limit 1;
  end if;

  select exists(
    select 1 from public.order_material_reservations
    where ceco = p_ceco and reserved_quantity < required_quantity
  ) into v_shortage;

  update public.ceco_orders
  set stage_id = coalesce(v_current_stage, stage_id),
      progress = round(v_stage_average, 2),
      status = case when v_blocked or v_shortage then 'red' when v_total > 0 and v_completed = v_total then 'green' else 'orange' end,
      plant_state = case when v_shortage then 'Bloqueado por material' when v_blocked then 'Actividad bloqueada' when v_total > 0 and v_completed = v_total then 'Completado' else 'En proceso' end
  where ceco = p_ceco;
end; $$;

do $$
declare item record;
begin
  for item in select ceco from public.ceco_orders loop
    perform public.recalculate_order_execution(item.ceco);
  end loop;
end; $$;
