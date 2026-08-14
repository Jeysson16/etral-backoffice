create index if not exists idx_body_types_family_id on public.body_types(family_id);
create index if not exists idx_body_types_brand_id on public.body_types(brand_id);
create index if not exists idx_body_types_output_unit_id on public.body_types(output_unit_id);
create index if not exists idx_ceco_orders_production_line_id on public.ceco_orders(production_line_id);
