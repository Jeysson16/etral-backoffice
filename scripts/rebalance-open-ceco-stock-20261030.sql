-- Corrige el ajuste a cero del mismo día para reflejar stock parcial.
-- Base: necesidad BOM por CECO menos la cantidad aún solicitada. Si la
-- solicitud cubre toda una medida divisible, conserva 25% como saldo parcial;
-- una pieza indivisible de 1 und/kit/par queda en cero hasta recibirla.
-- Los materiales sin solicitud recuperan su saldo anterior documentado.
begin;

do $$
declare v_materials integer; v_reservations integer;
begin
  select count(*) into v_materials from public.inventory_items i
  where i.physical = 0 and i.committed = 0 and exists (
    select 1 from public.ceco_orders o join public.bom_items b on b.body_type_id=o.body_type_id
    where o.ceco in ('260500','260530') and b.material_code=i.code
  );
  if v_materials <> 234 then
    raise exception 'Se esperaban 234 materiales del ajuste previo en cero; hay %', v_materials;
  end if;
  select count(*) into v_reservations from public.order_material_reservations
  where ceco in ('260500','260530') and (reserved_quantity <> 0 or issued_quantity <> 0 or consumed_quantity <> 0);
  if v_reservations > 0 then
    raise exception 'Las reservas cambiaron después del ajuste previo: %', v_reservations;
  end if;
end $$;

with demand as (
  select o.ceco, b.material_code, sum(b.quantity) required
  from public.ceco_orders o join public.bom_items b on b.body_type_id=o.body_type_id
  where o.ceco in ('260500','260530') and o.progress < 100 and o.active is not false
  group by o.ceco,b.material_code
), requests as (
  select x.ceco,r.material_code,sum(r.quantity-r.received_quantity) pending
  from public.purchase_requests r cross join lateral unnest(r.cecos) x(ceco)
  where r.status in ('requested','ordered') and x.ceco in ('260500','260530')
  group by x.ceco,r.material_code
), original as (
  select code,quantity physical_before from public.inventory_movements
  where id like 'mov-stock-zero-20261030-%'
), target as materialized (
  select d.ceco,d.material_code,d.required,r.pending,o.physical_before,i.unit,
    least(o.physical_before,
      case when r.pending is null then o.physical_before
           when r.pending >= d.required and i.unit not in ('und','kit','par') then round(d.required * 0.25,3)
           else greatest(0,d.required-r.pending) end) as physical_target
  from demand d join original o on o.code=d.material_code
  join public.inventory_items i on i.code=d.material_code
  left join requests r on r.ceco=d.ceco and r.material_code=d.material_code
), updated_inventory as (
  update public.inventory_items i
  set physical=t.physical_target, committed=least(t.physical_target,t.required)
  from target t where i.code=t.material_code
  returning i.code
), updated_reservations as (
  update public.order_material_reservations r
  set reserved_quantity=least(t.physical_target,r.required_quantity),
      status=case when t.physical_target >= r.required_quantity then 'reserved'
                  when t.physical_target > 0 then 'partial' else 'pending' end,
      updated_at=now()
  from target t where r.ceco=t.ceco and r.material_code=t.material_code
  returning r.id
)
insert into public.inventory_movements(id,type,code,ceco,quantity,timestamp,note)
select 'mov-stock-partial-20261030-' || t.material_code,'ajuste',t.material_code,'',
  t.physical_target,now(),
  'Corrección del ajuste a cero para CECO ' || t.ceco ||
  '; saldo original=' || t.physical_before ||
  '; necesidad BOM=' || t.required ||
  '; solicitud pendiente=' || coalesce(t.pending::text,'ninguna') ||
  '; nuevo stock físico=' || t.physical_target ||
  '; regla: BOM menos solicitud; 25% parcial para unidad divisible si solicitud cubre todo'
from target t join updated_inventory u on u.code=t.material_code
where t.physical_target > 0;

commit;
