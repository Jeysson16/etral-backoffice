create table public.historical_material_purchases (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id),
  ceco text not null references public.ceco_orders(ceco),
  material_code text not null references public.inventory_items(code),
  bom_quantity numeric not null check (bom_quantity > 0),
  purchased_quantity numeric check (purchased_quantity > 0),
  purchase_date date,
  supplier text,
  document_number text,
  declaration_basis text not null,
  quantity_basis text not null default 'Cantidad de referencia del BOM al reconstruir el historial',
  created_at timestamptz not null default now(),
  unique (ceco, material_code)
);
alter table public.historical_material_purchases enable row level security;
create policy owner_access on public.historical_material_purchases to authenticated
  using (created_by = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false))
  with check (created_by = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false));
grant select, insert, update on public.historical_material_purchases to authenticated;
create index historical_material_purchases_owner on public.historical_material_purchases(created_by);
