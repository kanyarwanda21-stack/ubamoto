-- Correct the phone check added by 20261106000000.
alter table public.rider_applications
  drop constraint if exists rider_applications_phone_check;

alter table public.rider_applications
  add constraint rider_applications_phone_check
  check (phone ~ '^[+]2507[2389][0-9]{7}$');

alter table public.rider_applications enable row level security;
revoke all on table public.rider_applications from anon, authenticated, public;
grant all on table public.rider_applications to service_role;
