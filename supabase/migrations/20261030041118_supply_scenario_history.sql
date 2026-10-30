alter table public.simulation_runs alter column created_by set default auth.uid();
alter table public.simulation_runs enable row level security;
alter policy simulation_read on public.simulation_runs to authenticated
using (created_by = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));
alter policy simulation_write on public.simulation_runs to authenticated
with check (created_by = (select auth.uid()) and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false));
revoke all on public.simulation_runs from anon, authenticated;
grant select, insert on public.simulation_runs to authenticated;
grant usage on sequence public.simulation_runs_id_seq to authenticated;
create index if not exists simulation_runs_owner_date on public.simulation_runs (created_by, created_at desc);
