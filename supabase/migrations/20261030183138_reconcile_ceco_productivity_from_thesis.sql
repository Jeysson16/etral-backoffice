alter table public.ceco_orders
  add column if not exists output_weight_kg numeric check (output_weight_kg > 0),
  add column if not exists reported_worker_count integer check (reported_worker_count > 0),
  add column if not exists reported_labor_hours numeric check (reported_labor_hours > 0),
  add column if not exists labor_hour_cost_pen numeric check (labor_hour_cost_pen >= 0),
  add column if not exists raw_material_cost_pen numeric check (raw_material_cost_pen >= 0),
  add column if not exists supplies_cost_pen numeric check (supplies_cost_pen >= 0),
  add column if not exists productivity_basis text;

update public.ceco_orders as o
set output_weight_kg = m.weight_kg,
    reported_worker_count = m.worker_count,
    reported_labor_hours = m.labor_hours,
    labor_hour_cost_pen = m.hourly_cost_pen,
    raw_material_cost_pen = m.raw_material_cost_pen,
    supplies_cost_pen = m.supplies_cost_pen,
    sale_amount_pen = m.output_value_pen,
    energy_cost = m.energy_cost_pen,
    capital_cost = m.capital_cost_pen,
    output_value_basis = 'Instrumento de tesis · Post MO y MAT',
    energy_cost_basis = case when m.energy_cost_pen is null then null else 'Instrumento de tesis · Post MO y MAT' end,
    capital_cost_basis = 'Instrumento de tesis · Post MO y MAT',
    productivity_basis = 'Instrumento de tesis · Post MO y MAT',
    actual_finish_date = coalesce(o.actual_finish_date, (
      select (p.finished_at at time zone 'America/Lima')::date
      from public.ceco_activity_progress as p
      where p.ceco = o.ceco and p.activity_id = 'act-delivery-2'
        and p.status = 'completed' and p.finished_at is not null
      order by p.finished_at desc limit 1
    ))
from public.thesis_productivity_measurements as m
where m.phase = 'post' and m.ceco = o.ceco;
