-- Schema dump for ride_bookings, riders, staff, and rider_applications.
-- Run as PostgreSQL/Supabase database owner in the SQL Editor.
-- Run each SELECT separately and export the result as CSV.

-- 1. RELATIONS AND RLS
select
  c.oid::regclass as relation,
  c.relkind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ride_bookings', 'riders', 'staff', 'rider_applications')
order by c.relname;

-- 2. COLUMNS
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
  is_identity,
  is_generated
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ride_bookings', 'riders', 'staff', 'rider_applications')
order by table_name, ordinal_position;

-- 3. CONSTRAINTS
select
  n.nspname as table_schema,
  t.relname as table_name,
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_get_constraintdef(c.oid, true) as constraint_definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('ride_bookings', 'riders', 'staff', 'rider_applications')
order by t.relname, c.conname;

-- 4. INDEXES
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('ride_bookings', 'riders', 'staff', 'rider_applications')
order by tablename, indexname;

-- 5. TABLE PRIVILEGES
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('ride_bookings', 'riders', 'staff', 'rider_applications')
group by grantee, table_name
order by table_name, grantee;

-- 6. RLS POLICIES
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('ride_bookings', 'riders', 'staff', 'rider_applications')
order by tablename, policyname;

-- 7. ASSIGNMENT FUNCTION
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'assign_booking_with_capacity';

-- A. EVERY PUBLIC FUNCTION AND EXECUTE PRIVILEGES
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proacl as privileges
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- B. ROW COUNTS BY STATUS
select 'ride_bookings' as t, status, count(*)
from public.ride_bookings group by status
union all
select 'riders', status, count(*)
from public.riders group by status
union all
select 'rider_applications', status, count(*)
from public.rider_applications group by status;

-- C. DUPLICATE RIDER PHONES
select phone, count(*)
from public.riders
group by phone
having count(*) > 1;

-- D. DUPLICATE BOOKING REFERENCES
select reference, count(*)
from public.ride_bookings
where reference is not null
group by reference
having count(*) > 1;
