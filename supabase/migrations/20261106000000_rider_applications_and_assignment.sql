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

create or replace function public.assign_booking_with_capacity(
  p_booking_id uuid,
  p_rider_id uuid
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
    and status in ('requested', 'assigned')
  returning status into v_status;

  return found;
end;
$$;

revoke all on function public.assign_booking_with_capacity(uuid, uuid) from public;
