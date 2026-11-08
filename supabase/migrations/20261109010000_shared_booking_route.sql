-- Persist the server-approved route for every new booking.
-- Existing bookings keep NULL route geometry and continue to use coordinates
-- plus their already stored distance and duration.
alter table public.ride_bookings
  add column if not exists pickup_name text,
  add column if not exists route_geometry jsonb,
  add column if not exists route_provider text;

update public.ride_bookings
set pickup_name = coalesce(pickup_name, 'Pickup point')
where pickup_name is null;

alter table public.ride_bookings
  alter column pickup_name set default 'Pickup point';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_pickup_name_length_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_pickup_name_length_check
      check (pickup_name is null or char_length(pickup_name) <= 200);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_route_geometry_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_route_geometry_check
      check (
        route_geometry is null
        or (
          jsonb_typeof(route_geometry) = 'array'
          and jsonb_array_length(route_geometry) >= 2
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ride_bookings_route_provider_check'
      and conrelid = 'public.ride_bookings'::regclass
  ) then
    alter table public.ride_bookings
      add constraint ride_bookings_route_provider_check
      check (route_provider is null or route_provider in ('osrm', 'mapbox'));
  end if;
end $$;
