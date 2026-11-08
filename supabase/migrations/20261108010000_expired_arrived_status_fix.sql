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

create or replace function public.ubamoto_guard_ride_status_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'requested' and new.status in ('assigned', 'cancelled', 'expired'))
      or (old.status = 'assigned' and new.status in ('arrived', 'in_progress', 'requested', 'cancelled', 'expired'))
      or (old.status = 'arrived' and new.status in ('in_progress', 'cancelled', 'expired'))
      or (old.status = 'in_progress' and new.status in ('completed', 'cancelled', 'expired'))
      or (old.status = new.status)
      or (old.status in ('completed', 'cancelled', 'expired') and new.status = old.status)
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
