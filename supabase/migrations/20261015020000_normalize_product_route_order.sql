-- Las cargas masivas pueden traer las filas del BOM fuera del orden de planta.
-- La ruta siempre debe respetar flow_stages.order para que una fase visualmente
-- consecutiva también sea consecutiva para las reglas de avance.

update public.product_routes
set sequence = sequence + 1000;

with ordered_routes as (
  select
    route.product_id,
    route.stage_id,
    row_number() over (
      partition by route.product_id
      order by stage."order", route.stage_id
    ) as normalized_sequence
  from public.product_routes route
  join public.flow_stages stage on stage.id = route.stage_id
)
update public.product_routes route
set sequence = ordered.normalized_sequence
from ordered_routes ordered
where ordered.product_id = route.product_id
  and ordered.stage_id = route.stage_id;

create or replace function public.save_product_template(
  p_id text, p_code text, p_family_id text, p_brand_id text, p_name text,
  p_target_days numeric, p_output_unit_id text, p_route text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_id text := nullif(p_id, '');
  v_family text;
  v_output_unit text;
  v_stage text;
  v_sequence int := 0;
  v_valid_stages int;
begin
  select name into v_family from product_families where id = p_family_id and active;
  if v_family is null then raise exception 'Familia de producto no encontrada o inactiva'; end if;
  if not exists (select 1 from brands where id = p_brand_id and active) then raise exception 'Marca no encontrada o inactiva'; end if;
  select symbol into v_output_unit from measurement_units where id = p_output_unit_id and active;
  if v_output_unit is null then raise exception 'Unidad de salida no encontrada o inactiva'; end if;
  if coalesce(cardinality(p_route), 0) = 0 then raise exception 'Selecciona al menos una fase'; end if;

  select count(*) into v_valid_stages
  from flow_stages
  where id = any(p_route);
  if v_valid_stages <> cardinality(p_route) then
    raise exception 'La ruta contiene fases inexistentes o repetidas';
  end if;

  if v_id is null then
    v_id := 'body-' || regexp_replace(lower(p_code), '[^a-z0-9]+', '-', 'g') || '-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  end if;
  insert into body_types(id, code, family, family_id, brand_id, name, target_days, output_unit, output_unit_id)
  values(v_id, trim(p_code), v_family, p_family_id, p_brand_id, trim(p_name), p_target_days, v_output_unit, p_output_unit_id)
  on conflict (id) do update set
    code = excluded.code, family = excluded.family, family_id = excluded.family_id,
    brand_id = excluded.brand_id, name = excluded.name, target_days = excluded.target_days,
    output_unit = excluded.output_unit, output_unit_id = excluded.output_unit_id;

  delete from product_routes where product_id = v_id;
  for v_stage in
    select stage.id
    from flow_stages stage
    where stage.id = any(p_route)
    order by stage."order", stage.id
  loop
    v_sequence := v_sequence + 1;
    insert into product_routes(product_id, stage_id, sequence) values(v_id, v_stage, v_sequence);
  end loop;
  return v_id;
end; $$;

revoke execute on function public.save_product_template(text,text,text,text,text,numeric,text,text[]) from public;
grant execute on function public.save_product_template(text,text,text,text,text,numeric,text,text[]) to anon, authenticated;
