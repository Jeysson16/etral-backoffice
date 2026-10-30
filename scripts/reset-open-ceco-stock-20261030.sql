-- Ajuste solicitado para que los CECO abiertos 260500 y 260530 partan sin
-- materiales disponibles. No modifica la BOM ni las compras históricas.
-- Cada movimiento conserva el saldo y las reservas previas para auditoría.
begin;

do $$
declare v_materials integer; v_reserved integer;
begin
  select count(*) into v_materials
  from public.inventory_items i
  where i.physical > 0 and exists (
    select 1 from public.ceco_orders o
    join public.bom_items b on b.body_type_id = o.body_type_id
    where o.ceco in ('260500', '260530') and o.progress < 100
      and o.active is not false and b.material_code = i.code
  );
  if v_materials <> 234 then
    raise exception 'Se esperaban 234 materiales con stock; se encontraron %', v_materials;
  end if;
  select count(*) into v_reserved
  from public.order_material_reservations
  where ceco in ('260500', '260530') and (issued_quantity > 0 or consumed_quantity > 0);
  if v_reserved > 0 then
    raise exception 'Hay entregas o consumos reales en % reservas; revisar antes del ajuste', v_reserved;
  end if;
end $$;

with target as materialized (
  select i.code, i.physical, i.committed,
    coalesce((select jsonb_agg(jsonb_build_object(
      'ceco', r.ceco, 'id', r.id, 'reserved', r.reserved_quantity))
      from public.order_material_reservations r
      where r.material_code = i.code and r.ceco in ('260500', '260530')), '[]'::jsonb) as open_reservations
  from public.inventory_items i
  where i.physical > 0 and exists (
    select 1 from public.ceco_orders o
    join public.bom_items b on b.body_type_id = o.body_type_id
    where o.ceco in ('260500', '260530') and o.progress < 100
      and o.active is not false and b.material_code = i.code
  )
  for update of i
)
insert into public.inventory_movements(id, type, code, ceco, quantity, timestamp, note)
select 'mov-stock-zero-20261030-' || code, 'ajuste', code, '', physical, now(),
  'Ajuste de stock a cero para CECO abiertos 260500/260530; reducción de ' ||
  physical || '; saldo físico anterior=' || physical ||
  '; comprometido anterior=' || committed ||
  '; reservas abiertas anteriores=' || open_reservations::text
from target;

update public.order_material_reservations
set reserved_quantity = 0, status = 'pending', updated_at = now()
where ceco in ('260500', '260530') and reserved_quantity > 0;

update public.inventory_items i
set physical = 0, committed = 0
where exists (
  select 1 from public.ceco_orders o
  join public.bom_items b on b.body_type_id = o.body_type_id
  where o.ceco in ('260500', '260530') and o.progress < 100
    and o.active is not false and b.material_code = i.code
);

commit;
