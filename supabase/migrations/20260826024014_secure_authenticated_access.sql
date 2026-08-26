-- ETRAL: cierre de acceso público antes de publicar la aplicación.
-- El frontend conserva solo la publishable/anon key; toda lectura y escritura
-- operativa exige una sesión de Supabase Auth y pasa por RLS.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'material_categories','measurement_units','brands','activity_types',
    'flow_stages','stage_activities','body_types','product_routes',
    'inventory_items','bom_items','ceco_orders','stage_inventory',
    'ceco_activity_progress','work_shifts','personnel','equipment',
    'work_calendar','resource_assignments','operational_incidents',
    'operation_logs','warehouse_exits','quality_checks','inventory_movements'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists demo_access on public.%I', table_name);
    execute format('drop policy if exists authenticated_access on public.%I', table_name);
    execute format('create policy authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end $$;

revoke all on table public.flow_stages, public.stage_activities,
  public.material_categories, public.measurement_units, public.brands, public.activity_types,
  public.body_types, public.product_routes, public.inventory_items, public.bom_items,
  public.ceco_orders, public.stage_inventory, public.ceco_activity_progress,
  public.work_shifts, public.personnel, public.equipment, public.work_calendar,
  public.resource_assignments, public.operational_incidents,
  public.operation_logs, public.warehouse_exits, public.quality_checks,
  public.inventory_movements from anon;
grant select, insert, update, delete on table public.flow_stages, public.stage_activities,
  public.material_categories, public.measurement_units, public.brands, public.activity_types,
  public.body_types, public.product_routes, public.inventory_items, public.bom_items,
  public.ceco_orders, public.stage_inventory, public.ceco_activity_progress,
  public.work_shifts, public.personnel, public.equipment, public.work_calendar,
  public.resource_assignments, public.operational_incidents,
  public.operation_logs, public.warehouse_exits, public.quality_checks,
  public.inventory_movements to authenticated;

revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.next_ceco_code(), public.next_inventory_code(text),
  public.next_warehouse_ticket() from public, anon;
grant execute on function public.next_ceco_code(), public.next_inventory_code(text),
  public.next_warehouse_ticket() to authenticated;
