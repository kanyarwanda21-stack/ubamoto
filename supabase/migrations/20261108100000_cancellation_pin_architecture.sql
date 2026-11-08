begin;

alter table public.riders
  add column if not exists pin_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz;

alter table public.ride_bookings
  add column if not exists cancelled_reason text,
  add column if not exists cancellation_fee_rwf integer;

alter table public.ride_bookings drop constraint if exists ride_bookings_cancelled_by_check;
alter table public.ride_bookings add constraint ride_bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('customer', 'staff', 'rider', 'system'));

alter table public.ride_bookings drop constraint if exists ride_bookings_status_transition_check;

create or replace function public.cancel_ride_booking(
  p_booking_id uuid,
  p_cancelled_by text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_status text;
begin
  if p_cancelled_by not in ('customer', 'staff', 'rider', 'system') then
    raise exception 'Invalid cancellation actor';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text, 0));
  select status into v_status from public.ride_bookings where id = p_booking_id for update;
  if v_status is null then return false; end if;

  if v_status in ('completed', 'cancelled', 'expired') then
    return false;
  end if;

  if p_cancelled_by = 'customer' and v_status not in ('requested', 'assigned') then
    return false;
  end if;
  if p_cancelled_by in ('staff', 'rider', 'system') and
     v_status not in ('requested', 'assigned', 'arrived', 'in_progress') then
    return false;
  end if;

  update public.ride_bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_cancelled_by,
      cancelled_reason = nullif(btrim(p_reason), ''),
      rider_lat = null,
      rider_lng = null,
      rider_location_updated_at = null
  where id = p_booking_id;

  return true;
end;
$function$;

revoke all on function public.cancel_ride_booking(uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_ride_booking(uuid, text, text) to service_role;

commit;
