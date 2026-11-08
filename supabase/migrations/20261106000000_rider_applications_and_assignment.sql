-- Rider applications and operational assignment controls.

alter table public.ride_bookings add column if not exists fare_policy_version text;
alter table public.ride_bookings add column if not exists rider_payout_rwf integer;
alter table public.ride_bookings add column if not exists ubamoto_commission_rwf integer;

create table if not exists public.rider_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  plate_number text not null,
  licence_number text not null,
  consent boolean not null default false,
  ip_hash text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

alter table public.rider_applications enable row level security;
revoke all on table public.rider_applications from anon, authenticated, public;
grant all on table public.rider_applications to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_name_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_name_check
      check (length(btrim(name)) between 2 and 100);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_phone_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_phone_check
      check (phone ~ '^[+]2507[2389][0-9]{7}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_plate_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_plate_check
      check (length(btrim(plate_number)) between 2 and 20);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_licence_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_licence_check
      check (length(btrim(licence_number)) between 2 and 30);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_consent_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_consent_check
      check (consent = true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_review_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_review_check
      check (
        (status = 'new' and reviewed_at is null and reviewed_by is null)
        or
        (status in ('approved', 'rejected') and reviewed_at is not null and reviewed_by is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_status_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_status_check
      check (status in ('new', 'approved', 'rejected'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'rider_applications'
      and policyname = 'deny_public_rider_applications'
  ) then
    create policy deny_public_rider_applications
      on public.rider_applications
      for all
      to public
      using (false)
      with check (false);
  end if;
end $$;

create index if not exists rider_applications_phone_created_idx
  on public.rider_applications (phone, created_at desc);
create index if not exists rider_applications_ip_created_idx
  on public.rider_applications (ip_hash, created_at desc);
create index if not exists ride_bookings_active_rider_idx
  on public.ride_bookings (rider_id, status)
  where status in ('assigned', 'in_progress');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rider_applications_ip_hash_check'
      and conrelid = 'public.rider_applications'::regclass
  ) then
    alter table public.rider_applications
      add constraint rider_applications_ip_hash_check
      check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_fare_policy_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_fare_policy_check
      check (
        fare_policy_version is null
        or fare_policy_version = 'ubamoto-fare-2026-11-01'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_fare_allocation_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_fare_allocation_check
      check (
        (
          fare_policy_version is null
          and rider_payout_rwf is null
          and ubamoto_commission_rwf is null
        )
        or
        (
          fare_policy_version = 'ubamoto-fare-2026-11-01'
          and rider_payout_rwf between 500 and fare_rwf
          and ubamoto_commission_rwf >= 0
          and rider_payout_rwf + ubamoto_commission_rwf = fare_rwf
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_distance_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_distance_check
      check (distance_km > 0 and distance_km <= 40);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_rider_assignment_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_rider_assignment_check
      check (
        (rider_id is null and status in ('requested', 'cancelled'))
        or
        (rider_id is not null and status in ('assigned', 'in_progress', 'completed', 'cancelled'))
      );
  end if;
end $$;

drop function if exists public.assign_booking_with_capacity(uuid, uuid);

create or replace function public.assign_booking_with_capacity(
  p_booking_id uuid,
  p_rider_id uuid,
  p_only_open boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs integer;
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_rider_id::text, 0));
  select status into v_status from public.riders where id = p_rider_id;
  if v_status is distinct from 'verified' then
    raise exception 'Only verified riders can be assigned';
  end if;

  select count(*) into v_jobs
  from public.ride_bookings
  where rider_id = p_rider_id
    and status in ('assigned', 'in_progress');

  if v_jobs >= 2 then
    raise exception 'This rider already has two active jobs';
  end if;

  update public.ride_bookings
  set rider_id = p_rider_id,
      status = 'assigned',
      assigned_at = now()
  where id = p_booking_id
    and (p_only_open and status = 'requested' or not p_only_open and status in ('requested', 'assigned'))
  returning status into v_status;

  return found;
end;
$$;

revoke all on function public.assign_booking_with_capacity(uuid, uuid, boolean) from public;
grant execute on function public.assign_booking_with_capacity(uuid, uuid, boolean) to service_role;
