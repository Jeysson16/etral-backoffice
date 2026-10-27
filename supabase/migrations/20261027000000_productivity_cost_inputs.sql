-- Valores económicos necesarios para productividad de materiales y multifactorial.
-- Los NULL distinguen un dato aún no registrado de un costo real de cero.
alter table public.ceco_orders
  add column if not exists energy_cost numeric,
  add column if not exists capital_cost numeric;

alter table public.personnel
  add column if not exists hourly_cost numeric;

alter table public.ceco_orders
  add constraint ceco_orders_energy_cost_nonnegative check (energy_cost >= 0),
  add constraint ceco_orders_capital_cost_nonnegative check (capital_cost >= 0);

alter table public.personnel
  add constraint personnel_hourly_cost_nonnegative check (hourly_cost >= 0);
