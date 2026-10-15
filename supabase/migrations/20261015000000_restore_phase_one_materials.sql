-- Restaura Abastecimiento como primera fase de los productos importados y
-- coloca allí los materiales identificados como fase 1 en los Excel fuente.
-- Los materiales de fase 2 permanecen en stage-prepaint.

update public.product_routes
set sequence = sequence + 100
where product_id in (
  select id from public.body_types
  where code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
);

insert into public.product_routes(product_id, stage_id, sequence)
select id, 'stage-supply', 1
from public.body_types
where code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
on conflict (product_id, stage_id) do update set sequence = excluded.sequence;

update public.product_routes
set sequence = sequence - 99
where product_id in (
  select id from public.body_types
  where code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
)
and sequence >= 101;

update public.bom_items
set stage_id = 'stage-supply'
where stage_id = 'stage-cut'
and body_type_id in (
  select id from public.body_types
  where code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
);

-- Sincroniza la copia de la BOM de una orden. Además de completar stock,
-- crea las reservas que faltan cuando la BOM fue importada después del CECO.
create or replace function public.refresh_order_material_reservations(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_reservation record;
  v_available numeric;
  v_missing numeric;
  v_reserved numeric;
begin
  if not exists (select 1 from public.ceco_orders where ceco = p_ceco) then
    raise exception 'CECO no encontrado';
  end if;

  update public.order_material_reservations reservation
  set stage_id = bom.stage_id,
      material_code = bom.material_code,
      required_quantity = bom.quantity,
      updated_at = now()
  from public.bom_items bom, public.ceco_orders orders
  where orders.ceco = p_ceco
    and reservation.ceco = orders.ceco
    and reservation.bom_item_id = bom.id
    and bom.body_type_id = orders.body_type_id;

  insert into public.order_material_reservations(
    id, ceco, bom_item_id, stage_id, material_code,
    required_quantity, reserved_quantity, issued_quantity,
    consumed_quantity, status
  )
  select
    'reservation-' || orders.id || '-' || bom.id,
    orders.ceco,
    bom.id,
    bom.stage_id,
    bom.material_code,
    bom.quantity,
    0,
    0,
    0,
    'pending'
  from public.ceco_orders orders
  join public.bom_items bom on bom.body_type_id = orders.body_type_id
  where orders.ceco = p_ceco
  on conflict (ceco, bom_item_id) do nothing;

  for v_reservation in
    select *
    from public.order_material_reservations
    where ceco = p_ceco and reserved_quantity < required_quantity
    order by stage_id, id
  loop
    select greatest(0, physical - committed)
    into v_available
    from public.inventory_items
    where code = v_reservation.material_code
    for update;

    v_missing := v_reservation.required_quantity - v_reservation.reserved_quantity;
    v_reserved := least(v_missing, coalesce(v_available, 0));

    if v_reserved > 0 then
      update public.order_material_reservations
      set reserved_quantity = reserved_quantity + v_reserved,
          status = case when reserved_quantity + v_reserved >= required_quantity then 'reserved' else 'partial' end,
          updated_at = now()
      where id = v_reservation.id;

      update public.inventory_items
      set committed = committed + v_reserved
      where code = v_reservation.material_code;

      insert into public.inventory_movements(id, type, code, ceco, stage_id, quantity, note)
      values (
        'mov-reserve-' || p_ceco || '-' || v_reservation.id || '-' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
        'reserva',
        v_reservation.material_code,
        p_ceco,
        v_reservation.stage_id,
        v_reserved,
        'Reserva sincronizada con la BOM de la orden'
      );
    end if;
  end loop;

  perform public.recalculate_order_execution(p_ceco);
end; $$;

grant execute on function public.refresh_order_material_reservations(text) to authenticated;

do $$
declare
  order_row record;
begin
  for order_row in
    select orders.ceco
    from public.ceco_orders orders
    join public.body_types product on product.id = orders.body_type_id
    where product.code in ('PROD-FAC', 'PROD-FLI', 'PROD-BMI', 'PROD-BTE', 'PROD-PLT')
  loop
    perform public.refresh_order_material_reservations(order_row.ceco);
  end loop;
end $$;
