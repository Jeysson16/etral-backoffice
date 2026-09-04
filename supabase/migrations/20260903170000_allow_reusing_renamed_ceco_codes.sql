-- Un correlativo CECO puede volver a utilizarse después de que la orden
-- original haya sido renombrada. Los IDs técnicos no deben derivarse de él,
-- porque al renombrar permanecen intactos y causarían una colisión de PK.
create or replace function public.create_order_with_reservations(
  p_customer_id text,
  p_customer_name text,
  p_body_type_id text,
  p_planned_start_date date,
  p_due_date date,
  p_ceco text
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_ceco text;
  v_customer_id text;
  v_first_stage text;
  v_bom record;
  v_available numeric;
  v_reserved numeric;
  v_instance_id text := substring(md5(random()::text || clock_timestamp()::text) for 16);
begin
  if p_planned_start_date is null then raise exception 'El inicio PMP es obligatorio'; end if;
  if p_due_date is not null and p_planned_start_date > p_due_date then
    raise exception 'El inicio PMP no puede ser posterior a la fecha pactada';
  end if;

  v_ceco := nullif(trim(p_ceco), '');
  if v_ceco is null then
    v_ceco := next_ceco_code();
  elsif v_ceco !~ '^[0-9]{6}$' then
    raise exception 'El correlativo CECO debe tener 6 dígitos numéricos';
  elsif exists (select 1 from ceco_orders where ceco = v_ceco) then
    raise exception 'El CECO % ya existe', v_ceco;
  end if;

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

  insert into ceco_orders(id, ceco, customer, customer_id, body_type_id, progress, line, status, stage_id, plant_state, priority, planned_start_date, due_date)
  values ('order-' || v_instance_id, v_ceco, p_customer_name, v_customer_id, p_body_type_id, 0, null, 'orange', v_first_stage, 'En cola', 999, p_planned_start_date, p_due_date);

  for v_bom in select * from bom_items where body_type_id = p_body_type_id order by material_code, id loop
    select greatest(0, physical - committed) into v_available from inventory_items where code = v_bom.material_code for update;
    v_reserved := least(v_bom.quantity, coalesce(v_available, 0));
    insert into order_material_reservations(id, ceco, bom_item_id, stage_id, material_code, required_quantity, reserved_quantity, status)
    values ('reservation-' || v_instance_id || '-' || v_bom.id, v_ceco, v_bom.id, v_bom.stage_id, v_bom.material_code, v_bom.quantity, v_reserved,
      case when v_reserved = 0 then 'pending' when v_reserved < v_bom.quantity then 'partial' else 'reserved' end);
    if v_reserved > 0 then
      update inventory_items set committed = committed + v_reserved where code = v_bom.material_code;
      insert into inventory_movements(id, type, code, ceco, quantity, note)
      values ('mov-' || v_instance_id || '-' || v_bom.id, 'reserva', v_bom.material_code, v_ceco, v_reserved, 'Reserva automática por apertura CECO');
    end if;
  end loop;
  perform recalculate_order_execution(v_ceco);
  return v_ceco;
end; $$;

grant execute on function public.create_order_with_reservations(text, text, text, date, date, text) to authenticated;
