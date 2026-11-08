-- ============================================================================
-- Migration: 20261101000000_ride_platform.sql
-- ============================================================================


-- ============================================================================
-- Migration: 20261102100000_ride_platform.sql
-- ============================================================================
-- UBAmoto platform schema (additive).
-- Matches Edge Function usage: ride_bookings, riders, staff.
-- Safe to apply on an empty project. If tables already exist, this adds
-- missing columns/constraints/indexes only â€” it does not drop or rename.
--
-- Before applying to a live database that already has ride_bookings:
-- inspect id types. This migration uses uuid (Auth user ids are uuid).
-- A bigint id on an existing table will not be changed; stop and reconcile.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.ubamoto_add_check(p_table text, p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = p_name
      and conrelid = ('public.' || p_table)::regclass
  ) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_sql);
  end if;
end;
$$;

create or replace function public.ubamoto_add_fk(p_table text, p_name text, p_sql text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = p_name
      and conrelid = ('public.' || p_table)::regclass
  ) then
    execute format('alter table public.%I add constraint %I %s', p_table, p_name, p_sql);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- riders (Auth user id)
-- ---------------------------------------------------------------------------
create table if not exists public.riders (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  phone text not null,
  plate_number text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.riders add column if not exists name text;
alter table public.riders add column if not exists phone text;
alter table public.riders add column if not exists plate_number text;
alter table public.riders add column if not exists status text;
alter table public.riders add column if not exists created_at timestamptz;

alter table public.riders alter column status set default 'pending';
alter table public.riders alter column created_at set default now();

select public.ubamoto_add_fk(
  'riders',
  'riders_id_fkey',
  'foreign key (id) references auth.users (id) on delete cascade'
);

select public.ubamoto_add_check(
  'riders',
  'riders_status_check',
  $$check (status in ('pending', 'verified', 'suspended'))$$
);

-- ---------------------------------------------------------------------------
-- staff (Auth user id)
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.staff add column if not exists role text;
alter table public.staff add column if not exists created_at timestamptz;

alter table public.staff alter column role set default 'admin';
alter table public.staff alter column created_at set default now();

select public.ubamoto_add_fk(
  'staff',
  'staff_id_fkey',
  'foreign key (id) references auth.users (id) on delete cascade'
);

select public.ubamoto_add_check(
  'staff',
  'staff_role_check',
  $$check (role in ('admin'))$$
);

-- ---------------------------------------------------------------------------
-- ride_bookings
-- ---------------------------------------------------------------------------
create table if not exists public.ride_bookings (
  id uuid primary key default gen_random_uuid(),
  reference text,
  access_token_hash text,
  status text not null default 'requested',
  customer_name text not null,
  customer_phone text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  destination_name text not null,
  destination_lat double precision not null,
  destination_lng double precision not null,
  distance_km numeric not null,
  duration_minutes integer not null,
  fare_rwf integer not null,
  created_at timestamptz not null default now(),
  rider_id uuid,
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text
);

alter table public.ride_bookings add column if not exists reference text;
alter table public.ride_bookings add column if not exists access_token_hash text;
alter table public.ride_bookings add column if not exists status text;
alter table public.ride_bookings add column if not exists customer_name text;
alter table public.ride_bookings add column if not exists customer_phone text;
alter table public.ride_bookings add column if not exists pickup_lat double precision;
alter table public.ride_bookings add column if not exists pickup_lng double precision;
alter table public.ride_bookings add column if not exists destination_name text;
alter table public.ride_bookings add column if not exists destination_lat double precision;
alter table public.ride_bookings add column if not exists destination_lng double precision;
alter table public.ride_bookings add column if not exists distance_km numeric;
alter table public.ride_bookings add column if not exists duration_minutes integer;
alter table public.ride_bookings add column if not exists fare_rwf integer;
alter table public.ride_bookings add column if not exists created_at timestamptz;
alter table public.ride_bookings add column if not exists rider_id uuid;
alter table public.ride_bookings add column if not exists assigned_at timestamptz;
alter table public.ride_bookings add column if not exists started_at timestamptz;
alter table public.ride_bookings add column if not exists completed_at timestamptz;
alter table public.ride_bookings add column if not exists cancelled_at timestamptz;
alter table public.ride_bookings add column if not exists cancelled_by text;

alter table public.ride_bookings alter column status set default 'requested';
alter table public.ride_bookings alter column created_at set default now();

select public.ubamoto_add_check(
  'ride_bookings',
  'ride_bookings_status_check',
  $$check (status in ('requested', 'assigned', 'in_progress', 'completed', 'cancelled'))$$
);

select public.ubamoto_add_check(
  'ride_bookings',
  'ride_bookings_cancelled_by_check',
  $$check (cancelled_by is null or cancelled_by in ('customer', 'staff'))$$
);

select public.ubamoto_add_fk(
  'ride_bookings',
  'ride_bookings_rider_id_fkey',
  'foreign key (rider_id) references public.riders (id) on delete set null'
);

-- Unique booking reference (create-ride-booking retries on unique_violation 23505).
-- Existing duplicate values will cause this to fail; fix data before re-running.
create unique index if not exists ride_bookings_reference_key
  on public.ride_bookings (reference)
  where reference is not null;

create index if not exists ride_bookings_phone_created_at_idx
  on public.ride_bookings (customer_phone, created_at desc);

create index if not exists ride_bookings_phone_status_idx
  on public.ride_bookings (customer_phone, status);

create index if not exists ride_bookings_status_created_at_idx
  on public.ride_bookings (status, created_at desc);

create index if not exists ride_bookings_rider_id_status_idx
  on public.ride_bookings (rider_id, status);

create index if not exists riders_status_idx
  on public.riders (status);

create index if not exists staff_role_idx
  on public.staff (role);

-- ---------------------------------------------------------------------------
-- RLS: Data API (anon / authenticated) cannot read or write.
-- Edge Functions use the service role, which bypasses RLS.
-- No policies on purpose: deny by default.
-- ---------------------------------------------------------------------------
alter table public.riders enable row level security;
alter table public.riders force row level security;

alter table public.staff enable row level security;
alter table public.staff force row level security;

alter table public.ride_bookings enable row level security;
alter table public.ride_bookings force row level security;

revoke all on table public.riders from anon, authenticated, public;
revoke all on table public.staff from anon, authenticated, public;
revoke all on table public.ride_bookings from anon, authenticated, public;

grant all on table public.riders to service_role;
grant all on table public.staff to service_role;
grant all on table public.ride_bookings to service_role;

-- Drop helpers so they are not exposed via the Data API.
drop function public.ubamoto_add_check(text, text, text);
drop function public.ubamoto_add_fk(text, text, text);


-- ============================================================================
-- Migration: 20261106000000_rider_applications_and_assignment.sql
-- ============================================================================
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


-- ============================================================================
-- Migration: 20261106010000_fix_rider_application_phone_constraint.sql
-- ============================================================================
-- Correct the phone check added by 20261106000000.
alter table public.rider_applications
  drop constraint if exists rider_applications_phone_check;

alter table public.rider_applications
  add constraint rider_applications_phone_check
  check (phone ~ '^[+]2507[2389][0-9]{7}$');

alter table public.rider_applications enable row level security;
revoke all on table public.rider_applications from anon, authenticated, public;
grant all on table public.rider_applications to service_role;


-- ============================================================================
-- Migration: 20261106020000_rider_application_privileges.sql
-- ============================================================================
-- Explicit privileges for the service-role-only rider application table.
alter table public.rider_applications enable row level security;

revoke all on table public.rider_applications from anon, authenticated, public;
grant all on table public.rider_applications to service_role;


-- ============================================================================
-- Migration: 20261106030000_rider_photo_pin.sql
-- ============================================================================
-- Rider passport photos and phone/PIN authentication.
alter table public.rider_applications
  add column if not exists passport_photo_path text;

alter table public.riders
  add column if not exists passport_photo_path text,
  add column if not exists pin_salt text,
  add column if not exists pin_hash text;

create unique index if not exists riders_phone_unique_idx on public.riders (phone);
create index if not exists rider_applications_status_created_idx
  on public.rider_applications (status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-passports',
  'rider-passports',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on table public.riders from anon, authenticated, public;
grant select, update on table public.riders to authenticated;
grant all on table public.riders to service_role;


-- ============================================================================
-- Migration: 20261106040000_live_rider_location.sql
-- ============================================================================
alter table public.ride_bookings
  add column if not exists destination_address text,
  add column if not exists destination_type text,
  add column if not exists rider_lat double precision,
  add column if not exists rider_lng double precision,
  add column if not exists rider_location_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_destination_address_length_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_destination_address_length_check
      check (destination_address is null or length(destination_address) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_destination_type_length_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_destination_type_length_check
      check (destination_type is null or length(destination_type) <= 50);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_rider_location_pair_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_rider_location_pair_check
      check (
        (rider_lat is null and rider_lng is null and rider_location_updated_at is null)
        or
        (rider_lat between -2.9 and -1.0
          and rider_lng between 28.8 and 30.95
          and rider_location_updated_at is not null)
      );
  end if;
end
$$;

create index if not exists ride_bookings_active_location_idx
  on public.ride_bookings (status, rider_location_updated_at desc)
  where status in ('assigned', 'in_progress');


