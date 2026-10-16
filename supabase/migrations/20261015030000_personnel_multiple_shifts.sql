-- Un trabajador puede cubrir uno o varios segmentos de la jornada semanal.
-- Las horas semanales dejan de ser un dato manual y se derivan de sus turnos.

alter table public.work_shifts
  add column if not exists days_per_week smallint not null default 1
  check (days_per_week between 1 and 7);

update public.work_shifts set days_per_week = 4 where id = 'shift-mon-thu';
update public.work_shifts set days_per_week = 1 where id in ('shift-friday', 'shift-saturday');

create table if not exists public.personnel_work_shifts (
  personnel_id text not null references public.personnel(id) on update cascade on delete cascade,
  shift_id text not null references public.work_shifts(id) on update cascade on delete restrict,
  primary key (personnel_id, shift_id)
);

create index if not exists idx_personnel_work_shifts_shift
  on public.personnel_work_shifts(shift_id, personnel_id);

insert into public.personnel_work_shifts(personnel_id, shift_id)
select id, shift_id
from public.personnel
where shift_id is not null
on conflict do nothing;

-- Une las filas que se crearon para la misma persona solo por cambiar el turno.
create temporary table personnel_merge_map on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by lower(btrim(name))
      order by created_at, id
    ) as canonical_id,
    row_number() over (
      partition by lower(btrim(name))
      order by created_at, id
    ) as row_number
  from public.personnel
)
select id as duplicate_id, canonical_id
from ranked
where row_number > 1;

insert into public.personnel_work_shifts(personnel_id, shift_id)
select map.canonical_id, link.shift_id
from personnel_merge_map map
join public.personnel_work_shifts link on link.personnel_id = map.duplicate_id
on conflict do nothing;

update public.resource_assignments assignment
set personnel_id = map.canonical_id
from personnel_merge_map map
where assignment.personnel_id = map.duplicate_id;

delete from public.personnel person
using personnel_merge_map map
where person.id = map.duplicate_id;

create unique index if not exists personnel_normalized_name_unique
  on public.personnel(lower(btrim(name)));

create or replace function public.calculate_shift_weekly_hours(p_shift_id text)
returns numeric language sql stable security invoker set search_path = public as $$
  select greatest(
    0,
    extract(epoch from (
      case
        when shift.end_time > shift.start_time then shift.end_time - shift.start_time
        else shift.end_time - shift.start_time + interval '24 hours'
      end
    )) / 3600 - (shift.break_minutes::numeric / 60)
  ) * shift.days_per_week
  from public.work_shifts shift
  where shift.id = p_shift_id and shift.active;
$$;

create or replace function public.recalculate_personnel_weekly_hours(p_personnel_id text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.personnel person
  set
    weekly_hours = coalesce((
      select sum(public.calculate_shift_weekly_hours(link.shift_id))
      from public.personnel_work_shifts link
      where link.personnel_id = p_personnel_id
    ), 0),
    shift_id = (
      select link.shift_id
      from public.personnel_work_shifts link
      join public.work_shifts shift on shift.id = link.shift_id
      where link.personnel_id = p_personnel_id
      order by shift.code, shift.id
      limit 1
    )
  where person.id = p_personnel_id;
end; $$;

create or replace function public.sync_personnel_weekly_hours()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op <> 'INSERT' then
    perform public.recalculate_personnel_weekly_hours(old.personnel_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.recalculate_personnel_weekly_hours(new.personnel_id);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists trg_sync_personnel_weekly_hours on public.personnel_work_shifts;
create trigger trg_sync_personnel_weekly_hours
after insert or update or delete on public.personnel_work_shifts
for each row execute function public.sync_personnel_weekly_hours();

create or replace function public.sync_shift_personnel_weekly_hours()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_personnel_id text;
begin
  for v_personnel_id in
    select personnel_id from public.personnel_work_shifts where shift_id = new.id
  loop
    perform public.recalculate_personnel_weekly_hours(v_personnel_id);
  end loop;
  return new;
end; $$;

drop trigger if exists trg_sync_shift_personnel_weekly_hours on public.work_shifts;
create trigger trg_sync_shift_personnel_weekly_hours
after update of start_time, end_time, break_minutes, days_per_week, active on public.work_shifts
for each row execute function public.sync_shift_personnel_weekly_hours();

do $$
declare v_personnel_id text;
begin
  for v_personnel_id in select id from public.personnel loop
    perform public.recalculate_personnel_weekly_hours(v_personnel_id);
  end loop;
end $$;

create or replace function public.save_personnel_with_shifts(
  p_id text,
  p_employee_code text,
  p_name text,
  p_role text,
  p_specialty text,
  p_shift_ids text[],
  p_status text,
  p_efficiency numeric
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_id text := nullif(p_id, '');
  v_valid_shifts int;
begin
  if btrim(coalesce(p_employee_code, '')) = '' then raise exception 'El código del trabajador es obligatorio'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'El nombre del trabajador es obligatorio'; end if;
  if coalesce(cardinality(p_shift_ids), 0) = 0 then raise exception 'Selecciona al menos un turno'; end if;

  select count(*) into v_valid_shifts
  from public.work_shifts
  where id = any(p_shift_ids) and active;
  if v_valid_shifts <> cardinality(p_shift_ids) then
    raise exception 'La selección contiene turnos inexistentes, inactivos o repetidos';
  end if;

  if exists (
    select 1 from public.personnel
    where lower(btrim(name)) = lower(btrim(p_name))
      and id <> coalesce(v_id, '')
  ) then
    raise exception 'Ya existe un trabajador con ese nombre. Edítalo para cambiar o agregar turnos';
  end if;

  if v_id is null then
    v_id := 'person-' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  elsif not exists (select 1 from public.personnel where id = v_id) then
    raise exception 'Trabajador no encontrado';
  end if;

  insert into public.personnel(
    id, employee_code, name, role, specialty, shift_id,
    status, efficiency, weekly_hours, active
  ) values (
    v_id, btrim(p_employee_code), btrim(p_name), btrim(p_role), nullif(btrim(p_specialty), ''), p_shift_ids[1],
    p_status, p_efficiency, 0, true
  )
  on conflict (id) do update set
    employee_code = excluded.employee_code,
    name = excluded.name,
    role = excluded.role,
    specialty = excluded.specialty,
    status = excluded.status,
    efficiency = excluded.efficiency;

  delete from public.personnel_work_shifts where personnel_id = v_id;
  insert into public.personnel_work_shifts(personnel_id, shift_id)
  select v_id, shift.id
  from public.work_shifts shift
  where shift.id = any(p_shift_ids)
  order by shift.code, shift.id;

  perform public.recalculate_personnel_weekly_hours(v_id);
  return v_id;
end; $$;

alter table public.personnel_work_shifts enable row level security;
drop policy if exists authenticated_access on public.personnel_work_shifts;
create policy authenticated_access on public.personnel_work_shifts
for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.personnel_work_shifts to authenticated;
revoke all on table public.personnel_work_shifts from anon;

revoke execute on function public.save_personnel_with_shifts(text,text,text,text,text,text[],text,numeric) from public;
grant execute on function public.save_personnel_with_shifts(text,text,text,text,text,text[],text,numeric) to authenticated;
revoke execute on function public.calculate_shift_weekly_hours(text) from public;
revoke execute on function public.recalculate_personnel_weekly_hours(text) from public;
grant execute on function public.calculate_shift_weekly_hours(text) to authenticated;
grant execute on function public.recalculate_personnel_weekly_hours(text) to authenticated;
