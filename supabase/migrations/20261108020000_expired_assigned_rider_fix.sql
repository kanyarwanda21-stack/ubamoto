alter table public.ride_bookings drop constraint if exists ride_bookings_rider_assignment_check;
alter table public.ride_bookings add constraint ride_bookings_rider_assignment_check
  check (
    (rider_id is null and status in ('requested', 'cancelled', 'expired'))
    or
    (rider_id is not null and status in ('assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'))
  );
