create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  created_by uuid not null default auth.uid() references auth.users(id),
  material_code text not null references public.inventory_items(code),
  quantity numeric not null check (quantity > 0),
  received_quantity numeric not null default 0 check (received_quantity >= 0 and received_quantity <= quantity),
  status text not null default 'requested' check (status in ('requested','ordered','received','cancelled')),
  requested_date date not null default (now() at time zone 'America/Lima')::date,
  needed_date date,
  cecos text[] not null default '{}',
  note text not null default '',
  supplier text,
  order_number text,
  order_date date,
  expected_date date,
  unit_cost numeric check (unit_cost >= 0),
  receipt_at timestamptz,
  receipt_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchase_requests enable row level security;
create policy owner_access on public.purchase_requests to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
grant select, insert, update on public.purchase_requests to authenticated;
grant usage, select on sequence public.purchase_requests_request_number_seq to authenticated;
create index purchase_requests_owner_material on public.purchase_requests(created_by, material_code) where status in ('requested','ordered');

create function public.validate_purchase_request() returns trigger
language plpgsql security invoker set search_path = public as $$
declare delta numeric;
begin
  if TG_OP = 'INSERT' then
    if new.status <> 'requested' or new.received_quantity <> 0 then
      raise exception 'Primero registra la solicitud';
    end if;
  else
    if old.status in ('received','cancelled') then raise exception 'El registro ya está cerrado'; end if;
    if new.created_by <> old.created_by or new.material_code <> old.material_code or new.requested_date <> old.requested_date then
      raise exception 'No se puede cambiar el origen de la solicitud';
    end if;
    if old.status = 'requested' and new.status not in ('requested','ordered','cancelled') then raise exception 'Falta registrar la orden de compra'; end if;
    if old.status = 'ordered' and new.status not in ('ordered','received','cancelled') then raise exception 'La orden ya fue registrada'; end if;
    if old.status = 'ordered' and (new.quantity <> old.quantity or new.order_date <> old.order_date or new.order_number <> old.order_number) then raise exception 'No se puede cambiar una orden emitida'; end if;
    delta := new.received_quantity - old.received_quantity;
    if delta < 0 then raise exception 'No se puede reducir una recepción registrada'; end if;
    if delta > 0 then
      if old.status <> 'ordered' or new.status not in ('ordered','received') then raise exception 'La recepción requiere una orden de compra'; end if;
      if new.receipt_at is null or nullif(trim(new.receipt_reference),'') is null then raise exception 'Indica fecha y documento de recepción'; end if;
      if (new.receipt_at at time zone 'America/Lima')::date < old.order_date or new.receipt_at > now() then raise exception 'La fecha de recepción debe estar entre la orden y hoy'; end if;
      update public.inventory_items set physical = physical + delta where code = new.material_code;
      insert into public.inventory_movements(id,type,code,ceco,quantity,timestamp,note)
      values ('mov-purchase-' || gen_random_uuid(), 'ingreso', new.material_code, '', delta, new.receipt_at,
        'OC ' || new.order_number || ' · Solicitud ' || new.request_number || ' · ' || new.receipt_reference);
    end if;
  end if;
  if new.status in ('ordered','received') then
    if nullif(trim(new.supplier),'') is null or nullif(trim(new.order_number),'') is null or new.order_date is null or new.expected_date is null or new.unit_cost is null then raise exception 'Completa proveedor, número OC, fechas y precio unitario'; end if;
    if new.order_date < new.requested_date or new.expected_date < new.order_date then raise exception 'Revisa la secuencia de fechas'; end if;
    if (new.status = 'received') <> (new.received_quantity = new.quantity) then raise exception 'El estado debe coincidir con la cantidad recibida'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger validate_purchase_request before insert or update on public.purchase_requests for each row execute function public.validate_purchase_request();
revoke execute on function public.validate_purchase_request() from public, anon;

create function public.receive_purchase_request(p_id uuid, p_quantity numeric, p_timestamp timestamptz, p_reference text)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.purchase_requests;
begin
  select * into r from public.purchase_requests where id=p_id for update;
  if not found or r.status <> 'ordered' then raise exception 'Orden de compra no disponible'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > r.quantity-r.received_quantity then raise exception 'La cantidad excede el saldo pendiente o no es válida'; end if;
  update public.purchase_requests set received_quantity=received_quantity+p_quantity,
    status=case when received_quantity+p_quantity=quantity then 'received' else 'ordered' end,
    receipt_at=p_timestamp, receipt_reference=p_reference where id=p_id;
end;
$$;
revoke execute on function public.receive_purchase_request(uuid,numeric,timestamptz,text) from public, anon;
grant execute on function public.receive_purchase_request(uuid,numeric,timestamptz,text) to authenticated;
