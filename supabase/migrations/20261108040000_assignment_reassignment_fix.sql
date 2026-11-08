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
      (p_only_open = false and status in ('requested', 'assigned'))
    );

  return found;
end;
$$;

revoke all on function public.assign_booking_with_capacity(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_booking_with_capacity(uuid, uuid, boolean) to service_role;
