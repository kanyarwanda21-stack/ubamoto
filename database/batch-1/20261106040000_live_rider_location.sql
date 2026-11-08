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
