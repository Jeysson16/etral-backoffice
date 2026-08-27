-- Cada etapa de la ruta aporta el mismo peso al avance del CECO.
-- Dentro de una etapa, sus actividades se promedian para obtener el porcentaje de etapa.
create or replace function public.recalculate_order_execution(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_product text;
  v_total bigint;
  v_completed bigint;
  v_stage_average numeric;
  v_blocked boolean;
  v_shortage boolean;
begin
  select body_type_id into v_product from ceco_orders where ceco = p_ceco;
  if v_product is null then return; end if;

  select
    coalesce(sum(activity_count), 0),
    coalesce(sum(completed_count), 0),
    coalesce(avg(stage_progress), 0),
    coalesce(bool_or(blocked), false)
  into v_total, v_completed, v_stage_average, v_blocked
  from (
    select
      r.stage_id,
      count(a.id) as activity_count,
      count(a.id) filter (where coalesce(p.status, 'pending') = 'completed') as completed_count,
      coalesce(avg(coalesce(p.progress, 0)), 0) as stage_progress,
      coalesce(bool_or(coalesce(p.status, 'pending') = 'blocked'), false) as blocked
    from product_routes r
    left join stage_activities a on a.stage_id = r.stage_id and a.active
    left join ceco_activity_progress p on p.ceco = p_ceco and p.activity_id = a.id
    where r.product_id = v_product
    group by r.stage_id
  ) stage_execution;

  select exists(select 1 from order_material_reservations where ceco = p_ceco and reserved_quantity < required_quantity)
  into v_shortage;

  update ceco_orders
  set progress = round(v_stage_average, 2),
      status = case when v_blocked or v_shortage then 'red' when v_total > 0 and v_completed = v_total then 'green' else 'orange' end,
      plant_state = case when v_shortage then 'Bloqueado por material' when v_blocked then 'Actividad bloqueada' when v_total > 0 and v_completed = v_total then 'Completado' else 'En proceso' end
  where ceco = p_ceco;
end; $$;

-- Actualiza las órdenes ya existentes al nuevo criterio de cálculo.
do $$
declare row record;
begin
  for row in select ceco from ceco_orders loop
    perform public.recalculate_order_execution(row.ceco);
  end loop;
end; $$;
