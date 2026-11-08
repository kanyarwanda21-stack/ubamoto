begin;

create table if not exists public.ubamoto_settings (
  key text primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.ubamoto_settings (key, value, description)
values ('ride_request_expiry_minutes', '30', 'Minutes before an unassigned requested ride expires')
on conflict (key) do nothing;

create table if not exists public.ubamoto_rate_limits (
  key_hash text not null,
  scope text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (key_hash, scope)
);

create or replace function public.check_rate_limit(
  p_key_hash text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  select window_started_at, request_count
    into v_started, v_count
    from public.ubamoto_rate_limits
   where key_hash = p_key_hash and scope = p_scope
   for update;
  if not found or v_started + (p_window_seconds || ' seconds')::interval <= now() then
    insert into public.ubamoto_rate_limits (key_hash, scope, window_started_at, request_count)
    values (p_key_hash, p_scope, now(), 1)
    on conflict (key_hash, scope) do update
      set window_started_at = now(), request_count = 1;
    return true;
  end if;
  if v_count >= p_limit then return false; end if;
  update public.ubamoto_rate_limits
     set request_count = request_count + 1
   where key_hash = p_key_hash and scope = p_scope;
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;

create unique index if not exists riders_plate_unique_idx
  on public.riders (upper(btrim(plate_number)))
  where plate_number is not null;

create or replace function public.expire_rider_documents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.riders
     set status = 'suspended',
         is_available = false
   where status = 'verified'
     and (
       driving_licence_expiry < current_date
       or insurance_expiry < current_date
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.expire_requested_rides()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer;
  v_count integer;
begin
  select greatest(1, least(1440, value::integer))
    into v_minutes
    from public.ubamoto_settings
   where key = 'ride_request_expiry_minutes';
  if v_minutes is null then v_minutes := 30; end if;
  update public.ride_bookings
     set status = 'expired'
   where status = 'requested'
     and created_at <= now() - (v_minutes || ' minutes')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_rider_documents() from public, anon, authenticated;
revoke all on function public.expire_requested_rides() from public, anon, authenticated;
grant execute on function public.expire_rider_documents() to service_role;
grant execute on function public.expire_requested_rides() to service_role;

create or replace function public.rider_document_status(p_rider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider record;
begin
  select driving_licence_expiry, insurance_expiry, status, is_available
    into v_rider
    from public.riders
   where id = p_rider_id;
  if not found then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'driving_licence_expiry', v_rider.driving_licence_expiry,
    'insurance_expiry', v_rider.insurance_expiry,
    'warning',
      case when (
        (v_rider.driving_licence_expiry is not null and v_rider.driving_licence_expiry >= current_date and v_rider.driving_licence_expiry <= current_date + 3)
        or (v_rider.insurance_expiry is not null and v_rider.insurance_expiry >= current_date and v_rider.insurance_expiry <= current_date + 3)
      ) then true else false end,
    'blocked', v_rider.status = 'suspended' or v_rider.is_available is distinct from true
  );
end;
$$;
revoke all on function public.rider_document_status(uuid) from public, anon, authenticated;
grant execute on function public.rider_document_status(uuid) to service_role;

alter table public.riders
  add column if not exists document_warning_sent_at timestamptz;

alter table public.rider_applications
  add column if not exists driving_licence_expiry date,
  add column if not exists insurance_expiry date,
  add column if not exists motorcycle_type text
  check (motorcycle_type is null or motorcycle_type in ('electric', 'fuel'));

create or replace function public.ubamoto_block_expired_rider_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'verified'
     and (
       new.driving_licence_expiry < current_date
       or new.insurance_expiry < current_date
     ) then
    new.status := 'suspended';
    new.is_available := false;
  end if;
  return new;
end;
$$;

drop trigger if exists ubamoto_block_expired_rider_documents on public.riders;
create trigger ubamoto_block_expired_rider_documents
before insert or update of status, driving_licence_expiry, insurance_expiry, is_available
on public.riders
for each row execute function public.ubamoto_block_expired_rider_documents();

drop function if exists public.assign_booking_with_capacity(uuid, uuid, boolean);
create function public.assign_booking_with_capacity(
  p_booking_id uuid,
  p_rider_id uuid,
  p_only_open boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jobs integer;
  v_status text;
  v_available boolean;
  v_licence_expiry date;
  v_insurance_expiry date;
begin
  perform public.expire_rider_documents();
  perform pg_advisory_xact_lock(hashtextextended(p_rider_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));

  select status, is_available, driving_licence_expiry, insurance_expiry
    into v_status, v_available, v_licence_expiry, v_insurance_expiry
    from public.riders
   where id = p_rider_id
   for update;

  if v_status is distinct from 'verified' then
    raise exception 'Only verified riders can be assigned';
  end if;
  if v_available is distinct from true then
    raise exception 'Only available riders can be assigned';
  end if;
  if (v_licence_expiry is not null and v_licence_expiry < current_date)
     or (v_insurance_expiry is not null and v_insurance_expiry < current_date) then
    raise exception 'Rider documents have expired';
  end if;

  select count(*) into v_jobs
  from public.ride_bookings
  where rider_id = p_rider_id
    and status in ('assigned', 'arrived', 'in_progress')
    and id <> p_booking_id;
  if v_jobs >= 2 then
    raise exception 'This rider already has two active jobs';
  end if;

  update public.ride_bookings
  set rider_id = p_rider_id,
      status = 'assigned',
      assigned_at = now(),
      rider_lat = case when rider_id is distinct from p_rider_id then null else rider_lat end,
      rider_lng = case when rider_id is distinct from p_rider_id then null else rider_lng end,
      rider_location_updated_at = case when rider_id is distinct from p_rider_id then null else rider_location_updated_at end
  where id = p_booking_id
    and ((p_only_open = true and status = 'requested')
      or (p_only_open = false and status in ('requested', 'assigned')));

  return found;
end;
$$;

revoke all on function public.assign_booking_with_capacity(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_booking_with_capacity(uuid, uuid, boolean) to service_role;

commit;
