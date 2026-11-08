-- UBAmoto platform schema (additive).
-- Matches Edge Function usage: ride_bookings, riders, staff.
-- Safe to apply on an empty project. If tables already exist, this adds
-- missing columns/constraints/indexes only — it does not drop or rename.
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
