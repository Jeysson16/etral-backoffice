-- Administración del ciclo de vida CECO: inactivar, renombrar y eliminar.
alter table public.ceco_orders
  add column if not exists active boolean not null default true;

-- Todo correlativo se usa como vínculo operativo. Al editarlo, PostgreSQL
-- propaga el nuevo valor a cada registro asociado; al eliminarlo los datos de
-- ejecución vinculados se eliminan de forma explícita junto con la orden.
do $$
declare
  fk record;
begin
  for fk in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'public.ceco_orders'::regclass
  loop
    execute format('alter table %s drop constraint %I', fk.table_name, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (ceco) references public.ceco_orders(ceco) on update cascade on delete cascade',
      fk.table_name,
      fk.conname
    );
  end loop;
end $$;

create or replace function public.delete_ceco_order(p_ceco text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  reservation record;
begin
  if not exists (select 1 from ceco_orders where ceco = p_ceco) then
    raise exception 'CECO no encontrado';
  end if;

  -- Solo se libera lo reservado que todavía no salió hacia planta.
  for reservation in
    select material_code,
           sum(greatest(0, reserved_quantity - issued_quantity)) as quantity
    from order_material_reservations
    where ceco = p_ceco
    group by material_code
  loop
    update inventory_items
    set committed = greatest(0, committed - reservation.quantity)
    where code = reservation.material_code;
  end loop;

  delete from inventory_movements where ceco = p_ceco;
  delete from ceco_orders where ceco = p_ceco;
end; $$;

grant execute on function public.delete_ceco_order(text) to authenticated;
