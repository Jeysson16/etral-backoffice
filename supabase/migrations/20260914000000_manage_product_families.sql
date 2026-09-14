-- Permite administrar las familias desde Inventario > Catálogos.
alter table public.product_families enable row level security;
drop policy if exists authenticated_access on public.product_families;
create policy authenticated_access on public.product_families
  for all to authenticated using (true) with check (true);

revoke all on table public.product_families from anon;
grant select, insert, update, delete on table public.product_families to authenticated;
