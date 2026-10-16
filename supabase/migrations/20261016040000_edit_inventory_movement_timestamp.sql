-- Permite conservar la fecha y hora elegidas por el usuario durante una
-- reposición rápida, sin perder la atomicidad de la actualización de stock.
drop function if exists public.replenish_and_reserve_material(text, text, numeric, text, text, timestamptz);
drop function if exists public.replenish_and_reserve_material(text, text, numeric, text, text);

create function public.replenish_and_reserve_material(
  p_ceco text,
  p_material_code text,
  p_quantity numeric,
  p_movement_type text default 'ingreso',
  p_note text default null,
  p_timestamp timestamptz default now()
)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_reservation record;
  v_available numeric;
  v_missing numeric;
  v_reserved numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;
  if p_movement_type not in ('ingreso', 'ajuste') then
    raise exception 'La reposición debe ser un ingreso o ajuste positivo';
  end if;
  if not exists (select 1 from ceco_orders where ceco = p_ceco) then
    raise exception 'CECO no encontrado';
  end if;

  perform 1 from inventory_items where code = p_material_code for update;
  if not found then
    raise exception 'Material no encontrado';
  end if;

  update inventory_items
  set physical = physical + p_quantity
  where code = p_material_code;

  insert into inventory_movements(id, type, code, ceco, quantity, timestamp, note)
  values (
    'mov-replenish-' || p_ceco || '-' || p_material_code || '-' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
    p_movement_type,
    p_material_code,
    p_ceco,
    p_quantity,
    coalesce(p_timestamp, now()),
    coalesce(nullif(trim(p_note), ''), 'Reposición rápida para completar reservas')
  );

  for v_reservation in
    select * from order_material_reservations
    where ceco = p_ceco
      and material_code = p_material_code
      and reserved_quantity < required_quantity
    order by id
    for update
  loop
    select greatest(0, physical - committed) into v_available
    from inventory_items where code = p_material_code;
    v_missing := v_reservation.required_quantity - v_reservation.reserved_quantity;
    v_reserved := least(v_missing, coalesce(v_available, 0));
    if v_reserved <= 0 then continue; end if;

    update order_material_reservations
    set reserved_quantity = reserved_quantity + v_reserved,
        status = case when reserved_quantity + v_reserved >= required_quantity then 'reserved' else 'partial' end,
        updated_at = now()
    where id = v_reservation.id;
    update inventory_items set committed = committed + v_reserved where code = p_material_code;
    insert into inventory_movements(id, type, code, ceco, quantity, timestamp, note)
    values (
      'mov-reserve-' || p_ceco || '-' || v_reservation.id || '-' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
      'reserva',
      p_material_code,
      p_ceco,
      v_reserved,
      coalesce(p_timestamp, now()),
      'Reserva complementaria tras reposición rápida'
    );
  end loop;

  perform recalculate_order_execution(p_ceco);
end; $$;

revoke all on function public.replenish_and_reserve_material(text, text, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.replenish_and_reserve_material(text, text, numeric, text, text, timestamptz) to authenticated;
