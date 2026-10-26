-- La ficha de la tesis utiliza demanda promedio y dispersión del plazo del proveedor.
alter table public.inventory_items
  add column if not exists average_demand numeric check (average_demand >= 0),
  add column if not exists lead_time_std_dev numeric check (lead_time_std_dev >= 0),
  add column if not exists service_level numeric check (service_level between 0 and 1);

create or replace function public.calculate_inventory_safety()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.service_factor > 0 and new.demand_std_dev >= 0 and new.lead_time_days > 0
     and new.average_demand >= 0 and new.lead_time_std_dev >= 0 then
    new.safety := ceil(new.service_factor * sqrt(
      power(new.demand_std_dev, 2) * new.lead_time_days
      + power(new.lead_time_std_dev, 2) * power(new.average_demand, 2)
    ));
  end if;
  return new;
end; $$;

drop trigger if exists trg_calculate_inventory_safety on public.inventory_items;
create trigger trg_calculate_inventory_safety
before insert or update of service_factor, demand_std_dev, lead_time_days, average_demand, lead_time_std_dev
on public.inventory_items for each row execute function public.calculate_inventory_safety();
