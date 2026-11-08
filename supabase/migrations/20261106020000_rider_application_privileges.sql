-- Explicit privileges for the service-role-only rider application table.
alter table public.rider_applications enable row level security;

revoke all on table public.rider_applications from anon, authenticated, public;
grant all on table public.rider_applications to service_role;
