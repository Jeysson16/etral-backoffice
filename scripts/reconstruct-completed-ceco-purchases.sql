-- Reconstrucción solicitada el 2026-10-30. Son estimaciones de historial, no
-- documentos de proveedor ni movimientos nuevos de inventario.
begin;

with completed as (
  select o.ceco, o.body_type_id from public.ceco_orders o
  where o.progress >= 100
), bom_totals as (
  select c.ceco, b.material_code, sum(b.quantity) as quantity,
    min(coalesce((
      select min(p.planned_start_date) from public.ceco_activity_progress p
      join public.stage_activities a on a.id = p.activity_id
      where p.ceco = c.ceco and a.stage_id = b.stage_id
    ), o.planned_start_date, o.due_date)) as phase_date,
    min(o.due_date) as due_date
  from completed c
  join public.ceco_orders o on o.ceco = c.ceco
  join public.bom_items b on b.body_type_id = c.body_type_id
  group by c.ceco, b.material_code
), reconstructed as (
  select t.*, greatest(date '2026-01-01',
    least(coalesce(t.phase_date, t.due_date), coalesce(t.due_date, t.phase_date))
    - coalesce(nullif(i.lead_time_days, 0), 0)::integer) as estimated_date
  from bom_totals t join public.inventory_items i on i.code = t.material_code
)
insert into public.historical_material_purchases
  (created_by, ceco, material_code, bom_quantity, purchased_quantity, purchase_date,
   declaration_basis, quantity_basis)
select (select created_by from public.purchase_requests limit 1), r.ceco, r.material_code,
  r.quantity, r.quantity, r.estimated_date,
  'Reconstrucción solicitada: CECO completado; compra e ingreso declarados, sin proveedor ni comprobante documentados.',
  'Cantidad estimada desde BOM; no representa una factura ni un movimiento nuevo de stock.'
from reconstructed r
on conflict (ceco, material_code) do update set
  bom_quantity = excluded.bom_quantity,
  purchased_quantity = excluded.purchased_quantity,
  purchase_date = excluded.purchase_date,
  declaration_basis = excluded.declaration_basis,
  quantity_basis = excluded.quantity_basis
where historical_material_purchases.purchase_date is null
  and historical_material_purchases.purchased_quantity is null
  and historical_material_purchases.supplier is null
  and historical_material_purchases.document_number is null;

update public.purchase_requests r set status = 'cancelled',
  note = concat_ws(' · ', nullif(r.note, ''),
    case when r.cecos = '{}' then 'Sin CECO abierto; solicitud MRP reclasificada fuera del flujo pendiente'
         else 'CECO completado; compra reconstruida en órdenes históricas' end)
where r.status = 'requested'
  and (r.cecos = '{}' or not exists (
    select 1 from unnest(r.cecos) as x(ceco)
    join public.ceco_orders o on o.ceco = x.ceco
    where o.active is not false and o.progress < 100
  ));

commit;
