-- One-time baseline for the PRUEBAS research dataset.
-- Run after traceable_indicator_estimates. Never replace a positive recorded
-- price or a non-null payroll/CECO amount. The inventory trigger recalculates
-- safety from completed parameters. All generated values carry a basis.
-- Retail anchors (Peru, 2026): Soko fixings, ABA 1.2 mm galvanized sheet,
-- Promart thinner; other anchors are rough category estimates and require review.
begin;

with exact_price as (
  select upper(trim(description)) description, unit,
    percentile_cont(0.5) within group (order by unit_cost)::numeric cost
  from public.inventory_items where unit_cost > 0
  group by upper(trim(description)), unit
), category_price as (
  select category, unit,
    percentile_cont(0.5) within group (order by unit_cost)::numeric cost
  from public.inventory_items where unit_cost > 0
  group by category, unit
), unit_price as (
  select unit, percentile_cont(0.5) within group (order by unit_cost)::numeric cost
  from public.inventory_items where unit_cost > 0 group by unit
), candidates as (
  select i.code, round(coalesce(e.cost,
    case
      when upper(i.description) ~ 'REMACHE' then 0.25
      when upper(i.description) ~ 'ARANDELA' then 0.50
      when upper(i.description) ~ 'TUERCA' then 0.55
      when upper(i.description) ~ 'AUTOPERF|AUTORROSC|STOBOL|TORNILLO' then 0.35
      when upper(i.description) ~ 'PERNO' then 1.50
      when upper(i.description) ~ 'CINTILLO' then 0.25
      when upper(i.description) ~ 'TERMINAL OJO' then 1.50
      when upper(i.description) ~ 'CABLE' and i.unit in ('mts','m','ml') then 3.50
      when upper(i.description) ~ 'MANGUERA' and i.unit in ('mts','m','ml') then 6.00
      when upper(i.description) ~ 'PLANCHA GALVANIZADA.*1[.,]20' then 121.00
      when upper(i.description) ~ 'SELLADOR 3M' then 95.00
      when upper(i.description) ~ 'THINNER' and i.unit in ('gal','gl.','gl') then 25.00
      when upper(i.description) ~ 'DISCO DE CORTE' then 6.00
      when upper(i.description) ~ 'OXIGENO' and i.unit in ('lt.','lt') then 2.00
      when upper(i.description) ~ 'ARGO MIX' and i.unit = 'balon' then 240.00
      when upper(i.category) ~ 'GASES' and i.unit = 'balon' then 220.00
      when upper(i.category) ~ 'GASES' and i.unit in ('lt.','lt') then 2.00
      when upper(i.category) ~ 'ESMALTES|PINTURAS|ANTICORROSIVOS' and i.unit in ('gal','gl.','gl') then 85.00
      when upper(i.category) ~ 'DISOLVENTES' and i.unit in ('gal','gl.','gl') then 25.00
      when upper(i.category) ~ 'PLANCHAS' and i.unit = 'und' then 180.00
      when upper(i.category) ~ 'MATERIALES DE FIJACION|FIJACION' and i.unit = 'und' then 1.00
      else null end,
    c.cost, u.cost, 25.00), 2) as cost,
    case when e.cost is not null then 'Estimado: mismo material y unidad del catálogo'
      when upper(i.description) ~ 'REMACHE|ARANDELA|TUERCA|AUTOPERF|AUTORROSC|STOBOL|TORNILLO|PERNO|CINTILLO|TERMINAL OJO|CABLE|MANGUERA|PLANCHA GALVANIZADA|SELLADOR 3M|THINNER|DISCO DE CORTE|OXIGENO|ARGO MIX'
        then 'Estimado: referencia minorista Perú / familia'
      when c.cost is not null then 'Estimado: mediana categoría y unidad del catálogo'
      when u.cost is not null then 'Estimado: mediana unidad del catálogo; revisar'
      else 'Estimado: base referencial; revisar' end as basis
  from public.inventory_items i
  left join exact_price e on e.description = upper(trim(i.description)) and e.unit = i.unit
  left join category_price c on c.category = i.category and c.unit = i.unit
  left join unit_price u on u.unit = i.unit
  where i.unit_cost is null or i.unit_cost <= 0
)
update public.inventory_items i set unit_cost = c.cost,
  unit_cost_basis = c.basis
from candidates c where i.code = c.code;

-- Override broad unit medians when the item description identifies a much
-- cheaper consumable. BOM rows labelled und for cable/hose are treated as
-- single segments; these units require confirmation with the warehouse.
update public.inventory_items set
  unit_cost = case
    when upper(description) ~ 'LIJA' and unit = 'und' then 2.50
    when upper(description) ~ 'CABLE AUTOMOTRIZ' and unit = 'und' then 3.50
    when upper(description) ~ 'MANGUERA CORRUGADA' and unit = 'und' then 6.00
    when upper(description) ~ 'PLANCHA LAC.*1/8' and unit = 'und' then 300.00
    when upper(description) ~ 'LISTONES DE MADERA' and unit = 'und' then 35.00
    else unit_cost end,
  unit_cost_basis = 'Estimado: comparable minorista Perú; confirmar unidad de compra'
where unit_cost_basis ilike 'Estimado%' and (
  (upper(description) ~ 'LIJA|CABLE AUTOMOTRIZ|MANGUERA CORRUGADA|LISTONES DE MADERA' and unit = 'und')
  or (upper(description) ~ 'PLANCHA LAC.*1/8' and unit = 'und'));

-- Observed issues would take precedence, but there are currently none. Daily
-- BOM quantities from CECO dates are planning proxies, including zero-demand
-- rows. The existing inventory trigger recalculates safety from these values.
with bounds as (
  select min(coalesce(planned_start_date,due_date))::date as first_day,
    date '2026-10-29' as last_day
  from public.ceco_orders
), days as (
  select greatest(2, last_day-first_day+1) n from bounds
), order_windows as (
  select o.ceco,o.body_type_id,coalesce(o.planned_start_date,o.due_date)::date first_day,
    o.due_date::date last_day,
    greatest(1,(select count(*) from generate_series(
      coalesce(o.planned_start_date,o.due_date)::timestamp,
      o.due_date::timestamp, interval '1 day') working_day
      where extract(dow from working_day) <> 0)) workdays
  from public.ceco_orders o
), daily as (
  select b.material_code code, working_day::date plan_day,
    sum(b.quantity / o.workdays)::numeric qty
  from order_windows o
  join public.bom_items b on b.body_type_id = o.body_type_id
  cross join bounds p
  cross join lateral generate_series(o.first_day::timestamp,
    least(o.last_day,p.last_day)::timestamp, interval '1 day') working_day
  where extract(dow from working_day) <> 0
  group by b.material_code, working_day::date
), stats as (
  select code, sum(qty) total, sum(qty*qty) sum_squares
  from daily group by code
), values as (
  select i.code, round(coalesce(s.total,0) / d.n, 4) dp,
    round(sqrt(greatest(0, (coalesce(s.sum_squares,0)-power(coalesce(s.total,0),2)/d.n)/(d.n-1))),4) s1,
    case when upper(i.category) ~ 'FIJACION|PINTURA|DISOLVENTE|CORTE' then 5
      when upper(i.category) ~ 'HIDRAUL|MOTRIZ|NEUMATIC|VALVULA' then 14
      else 7 end::numeric assumed_lt,
    s.code is not null has_plan
  from public.inventory_items i cross join days d
  left join stats s on s.code=i.code
)
update public.inventory_items i set
  average_demand = case when i.average_demand is null or i.safety_parameters_basis ilike 'Estimado%' then v.dp else i.average_demand end,
  demand_std_dev = case when i.demand_std_dev is null or (i.safety_parameters_basis ilike 'Estimado%' and i.service_factor <> 1.65) then v.s1 else i.demand_std_dev end,
  lead_time_days = coalesce(i.lead_time_days,v.assumed_lt),
  lead_time_std_dev = coalesce(i.lead_time_std_dev,round(coalesce(i.lead_time_days,v.assumed_lt)*0.25,2)),
  service_level = coalesce(i.service_level,0.95),
  service_factor = coalesce(i.service_factor,1.645),
  safety_parameters_basis = case when v.has_plan
    then 'Estimado: demanda CECO/BOM, plazo referencial y servicio 95%'
    else 'Estimado: sin demanda observada ni planificada; plazo referencial y servicio 95%' end
from values v where i.code=v.code and (
  i.average_demand is null or i.demand_std_dev is null or i.lead_time_days is null
  or i.lead_time_std_dev is null or i.service_level is null or i.service_factor is null
  or i.safety_parameters_basis ilike 'Estimado%');

update public.personnel set name = btrim(name) where name <> btrim(name);

update public.personnel set hourly_cost = case
    when upper(role) like '%INGENIERO%' then 27.00
    when upper(role) like '%ELECTRIC%' then 17.00
    when upper(role) like '%SOLDADOR%' then 16.00
    when upper(role) like '%ASISTENTE%' then 11.00
    when upper(role) like '%PINTOR%' then 14.00
    else 13.00 end,
  hourly_cost_basis = 'Estimado: tarifa horaria referencial Trujillo 2026; revisar nómina'
where hourly_cost is null;

-- CECO estimates are cost-based research proxies, not invoices or actual sales.
with material_cost as (
  select r.ceco, sum(r.required_quantity * i.unit_cost)::numeric cost
  from public.order_material_reservations r
  join public.inventory_items i on i.code=r.material_code
  group by r.ceco
), labor_cost as (
  select l.ceco, sum(l.total_hours * coalesce(p.hourly_cost,13))::numeric cost
  from public.operation_logs l
  left join public.personnel p on p.name=l.worker
  group by l.ceco
), estimates as (
  select o.ceco, coalesce(m.cost,0)+coalesce(l.cost,0) base_cost,
    case when o.body_type_id ilike '%van%' then 19000::numeric
      when o.body_type_id ilike '%rail%' then 15500::numeric
      else 17000::numeric end reference_sale
  from public.ceco_orders o
  left join material_cost m on m.ceco=o.ceco
  left join labor_cost l on l.ceco=o.ceco
)
update public.ceco_orders o set
  energy_cost = case when o.energy_cost is null or o.energy_cost_basis ilike 'Estimado%' then round(e.base_cost*0.025,2) else o.energy_cost end,
  energy_cost_basis = case when o.energy_cost is null then 'Estimado: 2.5% del costo material y laboral' else o.energy_cost_basis end,
  capital_cost = case when o.capital_cost is null or o.capital_cost_basis ilike 'Estimado%' then round(e.base_cost*0.035,2) else o.capital_cost end,
  capital_cost_basis = case when o.capital_cost is null then 'Estimado: 3.5% del costo material y laboral' else o.capital_cost_basis end,
  sale_amount_pen = case when o.sale_amount_pen is null or o.output_value_basis ilike 'Estimado%' then round(greatest(e.reference_sale,e.base_cost*1.45),2) else o.sale_amount_pen end,
  output_value_basis = case when o.sale_amount_pen is null then 'Estimado: referencia carrocería Perú y costo más margen; no factura' else o.output_value_basis end
from estimates e where e.ceco=o.ceco and (
  o.energy_cost is null or o.capital_cost is null or o.sale_amount_pen is null
  or o.energy_cost_basis ilike 'Estimado%' or o.capital_cost_basis ilike 'Estimado%' or o.output_value_basis ilike 'Estimado%');

commit;
