-- UBAmoto combined live-schema reconciliation and business hardening.
-- Reconciles live objects without recreating existing tables and preserves old rows.

-- ---------------------------------------------------------------------------
-- Ride and rider compatibility columns
-- ---------------------------------------------------------------------------
alter table public.ride_bookings
  add column if not exists arrived_at timestamptz,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists cancellation_fee_rwf integer not null default 0,
  add column if not exists payment_method text;

alter table public.ride_bookings alter column payment_method set default 'cash';

alter table public.riders
  add column if not exists is_available boolean default true,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists national_id_number text,
  add column if not exists driving_licence_number text,
  add column if not exists driving_licence_expiry date,
  add column if not exists insurance_provider text,
  add column if not exists insurance_policy_number text,
  add column if not exists insurance_details text,
  add column if not exists insurance_expiry date,
  add column if not exists motorcycle_category text,
  add column if not exists motorcycle_power_type text,
  add column if not exists motorcycle_manufacturer text,
  add column if not exists motorcycle_model text,
  add column if not exists motorcycle_colour text;

alter table public.rider_applications
  add column if not exists national_id_number text,
  add column if not exists driving_licence_number text,
  add column if not exists driving_licence_expiry date,
  add column if not exists insurance_provider text,
  add column if not exists insurance_policy_number text,
  add column if not exists insurance_details text,
  add column if not exists insurance_expiry date,
  add column if not exists motorcycle_category text,
  add column if not exists motorcycle_power_type text,
  add column if not exists motorcycle_manufacturer text,
  add column if not exists motorcycle_model text,
  add column if not exists motorcycle_colour text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ride_bookings_payment_status_check' and conrelid = 'public.ride_bookings'::regclass) then
    alter table public.ride_bookings add constraint ride_bookings_payment_status_check
      check (payment_status in ('pending', 'paid', 'failed', 'partially_refunded', 'refunded', 'waived')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ride_bookings_payment_method_check' and conrelid = 'public.ride_bookings'::regclass) then
    alter table public.ride_bookings add constraint ride_bookings_payment_method_check
      check (payment_method is null or payment_method in ('cash', 'mtn_momo', 'airtel_money')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ride_bookings_cancellation_fee_check' and conrelid = 'public.ride_bookings'::regclass) then
    alter table public.ride_bookings add constraint ride_bookings_cancellation_fee_check
      check (cancellation_fee_rwf >= 0 and cancellation_fee_rwf <= 500) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'riders_phone_format_check' and conrelid = 'public.riders'::regclass) then
    alter table public.riders add constraint riders_phone_format_check
      check (phone ~ '^\+2507[2389][0-9]{7}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ride_bookings_phone_format_check' and conrelid = 'public.ride_bookings'::regclass) then
    alter table public.ride_bookings add constraint ride_bookings_phone_format_check
      check (customer_phone ~ '^\+2507[2389][0-9]{7}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'riders_motorcycle_category_check' and conrelid = 'public.riders'::regclass) then
    alter table public.riders add constraint riders_motorcycle_category_check
      check (motorcycle_category is null or motorcycle_category = 'motorcycle') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'riders_motorcycle_power_check' and conrelid = 'public.riders'::regclass) then
    alter table public.riders add constraint riders_motorcycle_power_check
      check (motorcycle_power_type is null or motorcycle_power_type in ('petrol', 'electric')) not valid;
  end if;
end
$$;

create unique index if not exists riders_phone_unique_idx on public.riders (phone);

do $$
begin
  if not exists (
    select 1
    from public.riders
    where plate_number is not null
    group by upper(btrim(plate_number))
    having count(*) > 1
  ) then
    execute 'create unique index if not exists riders_plate_unique_idx on public.riders (upper(btrim(plate_number))) where plate_number is not null';
  else
    raise notice 'Duplicate normalized rider plates found; riders_plate_unique_idx was not created';
  end if;
end
$$;

alter table public.ride_bookings drop constraint if exists ride_bookings_fare_policy_check;
alter table public.ride_bookings add constraint ride_bookings_fare_policy_check
  check (fare_policy_version is null or fare_policy_version ~ '^ubamoto-fare-[0-9]{4}-[0-9]{2}-[0-9]{2}$') not valid;

alter table public.ride_bookings drop constraint if exists ride_bookings_status_check;
alter table public.ride_bookings add constraint ride_bookings_status_check
  check (status in ('requested', 'assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'));

alter table public.ride_bookings drop constraint if exists ride_bookings_rider_assignment_check;
alter table public.ride_bookings add constraint ride_bookings_rider_assignment_check
  check (
    (rider_id is null and status in ('requested', 'cancelled', 'expired'))
    or
    (rider_id is not null and status in ('assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'))
  );

-- ---------------------------------------------------------------------------
-- OTP and event history
-- ---------------------------------------------------------------------------
create table if not exists public.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique default gen_random_uuid(),
  user_id uuid,
  phone text not null,
  purpose text not null check (purpose in ('customer_registration', 'customer_login', 'rider_application', 'rider_recovery', 'admin_recovery')),
  otp_hash text not null,
  expires_at timestamptz not null,
  resend_available_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (resend_available_at >= created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create index if not exists otp_verifications_phone_purpose_created_idx
  on public.otp_verifications (phone, purpose, created_at desc);
create index if not exists otp_verifications_expiry_idx
  on public.otp_verifications (expires_at) where consumed_at is null;

create table if not exists public.ride_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_bookings(id) on delete restrict,
  event_type text not null,
  from_status text,
  to_status text,
  actor_type text check (actor_type in ('customer', 'rider', 'staff', 'system')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ride_events_ride_created_idx on public.ride_events (ride_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Payments and append-only double-entry ledger
-- ---------------------------------------------------------------------------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision,
  longitude double precision,
  place_type text,
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.ride_bookings(id) on delete restrict,
  payer_customer_id uuid,
  amount_rwf integer not null check (amount_rwf >= 0),
  method text not null check (method in ('cash', 'mtn_momo', 'airtel_money')),
  status text not null check (status in ('pending', 'paid', 'failed', 'partially_refunded', 'refunded', 'waived')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, provider_reference)
);

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (account_type in ('asset', 'liability', 'revenue', 'expense', 'equity')),
  code text not null unique,
  name text not null,
  rider_id uuid references public.riders(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid references public.ride_bookings(id) on delete restrict,
  rider_id uuid references public.riders(id) on delete restrict,
  event_key text not null unique,
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  reversal_of uuid references public.ledger_transactions(id) on delete restrict,
  source text not null,
  description text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  debit_rwf integer not null default 0 check (debit_rwf >= 0),
  credit_rwf integer not null default 0 check (credit_rwf >= 0),
  created_at timestamptz not null default now(),
  check ((debit_rwf = 0) <> (credit_rwf = 0))
);

create table if not exists public.rider_payouts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders(id) on delete restrict,
  ride_id uuid references public.ride_bookings(id) on delete restrict,
  amount_rwf integer not null check (amount_rwf >= 0),
  status text not null check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, provider_reference)
);

create index if not exists payment_records_ride_created_idx on public.payment_records (ride_id, created_at desc);
create index if not exists ledger_transactions_ride_event_idx on public.ledger_transactions (ride_id, event_key);
create index if not exists ledger_entries_transaction_idx on public.ledger_entries (transaction_id);
create index if not exists rider_payouts_rider_created_idx on public.rider_payouts (rider_id, created_at desc);

create or replace function public.ubamoto_guard_ledger_entries()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    raise exception 'Posted ledger entries are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists ubamoto_ledger_entries_immutable on public.ledger_entries;
create trigger ubamoto_ledger_entries_immutable
before update or delete on public.ledger_entries
for each row execute function public.ubamoto_guard_ledger_entries();

create or replace function public.ubamoto_check_transaction_balance()
returns trigger
language plpgsql
as $$
declare
  v_debits bigint;
  v_credits bigint;
begin
  if new.status = 'posted' then
    select coalesce(sum(debit_rwf), 0), coalesce(sum(credit_rwf), 0)
      into v_debits, v_credits
      from public.ledger_entries
      where transaction_id = new.id;
    if v_debits <> v_credits or v_debits = 0 then
      raise exception 'A posted ledger transaction must balance';
    end if;
    if new.posted_at is null then
      new.posted_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ubamoto_transaction_balance on public.ledger_transactions;
create trigger ubamoto_transaction_balance
before update on public.ledger_transactions
for each row execute function public.ubamoto_check_transaction_balance();

create or replace function public.ubamoto_guard_posted_transaction()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.status = 'posted' then
    raise exception 'Posted ledger transactions cannot be deleted';
  end if;
  if tg_op = 'UPDATE' and old.status = 'posted' and new.status = 'posted' then
    raise exception 'Posted ledger transaction fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists ubamoto_posted_transaction_guard on public.ledger_transactions;
create trigger ubamoto_posted_transaction_guard
before update or delete on public.ledger_transactions
for each row execute function public.ubamoto_guard_posted_transaction();

-- ---------------------------------------------------------------------------
-- Ride status transition guard
-- ---------------------------------------------------------------------------
create or replace function public.ubamoto_guard_ride_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'requested' and new.status in ('assigned', 'cancelled', 'expired'))
      or (old.status = 'assigned' and new.status in ('arrived', 'in_progress', 'requested', 'cancelled'))
      or (old.status = 'arrived' and new.status in ('in_progress', 'cancelled', 'expired'))
      or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))
      or (old.status = new.status)
      or (old.status in ('completed', 'cancelled') and new.status = old.status)
    ) then
      raise exception 'Invalid ride status transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ubamoto_ride_status_transition on public.ride_bookings;
create trigger ubamoto_ride_status_transition
before update of status on public.ride_bookings
for each row execute function public.ubamoto_guard_ride_status_transition();

-- ---------------------------------------------------------------------------
-- Capacity-safe assignment
-- ---------------------------------------------------------------------------
drop function if exists public.assign_booking_with_capacity(uuid, uuid);
drop function if exists public.assign_booking_with_capacity(uuid, uuid, boolean);

create or replace function public.assign_booking_with_capacity(
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
  v_old_rider_id uuid;
  v_jobs integer;
  v_status text;
  v_available boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_rider_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));

  select status, is_available
    into v_status, v_available
    from public.riders
   where id = p_rider_id;

  if v_status is distinct from 'verified' then
    raise exception 'Only verified riders can be assigned';
  end if;

  if v_available is distinct from true then
    raise exception 'Only available riders can be assigned';
  end if;

  select rider_id into v_old_rider_id
  from public.ride_bookings
  where id = p_booking_id
  for update;

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
    and (
      (p_only_open = true and status = 'requested')
      or
      (p_only_open = false and (
        status = 'requested'
        or status = 'assigned'
      ))
    );

  return found;
end;
$$;

revoke all on function public.assign_booking_with_capacity(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_booking_with_capacity(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- RLS, privileges, and private service-only tables
-- ---------------------------------------------------------------------------
alter table public.ride_bookings enable row level security;
alter table public.ride_bookings force row level security;
alter table public.riders enable row level security;
alter table public.riders force row level security;
alter table public.staff enable row level security;
alter table public.staff force row level security;
alter table public.rider_applications enable row level security;
alter table public.rider_applications force row level security;

revoke all on public.ride_bookings from anon, authenticated, public;
revoke all on public.riders from anon, authenticated, public;
revoke all on public.staff from anon, authenticated, public;
revoke all on public.rider_applications from anon, authenticated, public;

grant all on public.ride_bookings to service_role;
grant all on public.riders to service_role;
grant all on public.staff to service_role;
grant all on public.rider_applications to service_role;

alter table if exists public.otp_verifications enable row level security;
alter table if exists public.otp_verifications force row level security;
alter table if exists public.ride_events enable row level security;
alter table if exists public.ride_events force row level security;
alter table if exists public.places enable row level security;
alter table if exists public.places force row level security;
alter table if exists public.payment_records enable row level security;
alter table if exists public.payment_records force row level security;
alter table if exists public.ledger_accounts enable row level security;
alter table if exists public.ledger_accounts force row level security;
alter table if exists public.ledger_transactions enable row level security;
alter table if exists public.ledger_transactions force row level security;
alter table if exists public.ledger_entries enable row level security;
alter table if exists public.ledger_entries force row level security;
alter table if exists public.rider_payouts enable row level security;
alter table if exists public.rider_payouts force row level security;

revoke all on public.otp_verifications from anon, authenticated, public;
revoke all on public.ride_events from anon, authenticated, public;
revoke all on public.places from anon, authenticated, public;
revoke all on public.payment_records from anon, authenticated, public;
revoke all on public.ledger_accounts from anon, authenticated, public;
revoke all on public.ledger_transactions from anon, authenticated, public;
revoke all on public.ledger_entries from anon, authenticated, public;
revoke all on public.rider_payouts from anon, authenticated, public;

grant all on public.otp_verifications to service_role;
grant all on public.ride_events to service_role;
grant all on public.places to service_role;
grant all on public.payment_records to service_role;
grant all on public.ledger_accounts to service_role;
grant all on public.ledger_transactions to service_role;
grant all on public.ledger_entries to service_role;
grant all on public.rider_payouts to service_role;
