-- Reintenta las reservas incompletas después de registrar una reposición.
create or replace function public.refresh_order_material_reservations(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_reservation record;
  v_available numeric;
  v_missing numeric;
  v_reserved numeric;
begin
  if not exists (select 1 from ceco_orders where ceco = p_ceco) then
    raise exception 'CECO no encontrado';
  end if;

  for v_reservation in
    select * from order_material_reservations
    where ceco = p_ceco and reserved_quantity < required_quantity
    order by id
  loop
    select greatest(0, physical - committed) into v_available
    from inventory_items where code = v_reservation.material_code for update;
    v_missing := v_reservation.required_quantity - v_reservation.reserved_quantity;
    v_reserved := least(v_missing, coalesce(v_available, 0));
    if v_reserved > 0 then
      update order_material_reservations
      set reserved_quantity = reserved_quantity + v_reserved,
          status = case when reserved_quantity + v_reserved >= required_quantity then 'reserved' else 'partial' end
      where id = v_reservation.id;
      update inventory_items set committed = committed + v_reserved where code = v_reservation.material_code;
      insert into inventory_movements(id, type, code, ceco, quantity, note)
      values ('mov-reserve-' || p_ceco || '-' || v_reservation.id || '-' || extract(epoch from clock_timestamp())::bigint,
        'reserva', v_reservation.material_code, p_ceco, v_reserved, 'Reserva complementaria tras reposición rápida');
    end if;
  end loop;
  perform recalculate_order_execution(p_ceco);
end; $$;

grant execute on function public.refresh_order_material_reservations(text) to authenticated;
