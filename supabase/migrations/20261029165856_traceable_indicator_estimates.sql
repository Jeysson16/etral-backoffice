-- Provenance for provisional inputs used by thesis indicators. Existing values
-- remain untouched; a blank basis means a value entered before this migration.
alter table public.inventory_items
  add column if not exists unit_cost_basis text,
  add column if not exists safety_parameters_basis text;

alter table public.personnel
  add column if not exists hourly_cost_basis text;

alter table public.ceco_orders
  add column if not exists output_value_basis text,
  add column if not exists energy_cost_basis text,
  add column if not exists capital_cost_basis text;
