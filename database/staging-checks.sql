begin;

do $$
declare
  v_rider_a uuid := '11111111-1111-4111-8111-111111111111';
  v_rider_b uuid := '22222222-2222-4222-8222-222222222222';
  v_ride_old uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_ride_two uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_ride_new uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  v_status_ride uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_capacity_exception text := '';
begin
  insert into auth.users (id, email) values (v_rider_a, 'staging-rider-a@invalid.local')
  on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_rider_b, 'staging-rider-b@invalid.local')
  on conflict (id) do nothing;

  insert into public.riders (id, name, phone, plate_number, status, is_available)
  values
    (v_rider_a, 'Synthetic A', '+250720000001', 'STG-A', 'verified', true),
    (v_rider_b, 'Synthetic B', '+250720000002', 'STG-B', 'verified', true)
  on conflict (id) do update set
    status = excluded.status,
    is_available = excluded.is_available;

  insert into public.ride_bookings (
    id, customer_name, customer_phone, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng, distance_km,
    duration_minutes, fare_rwf, status, rider_id,
    rider_lat, rider_lng, rider_location_updated_at
  ) values (
    v_ride_old, 'Synthetic', '+250720000003', -1.95, 30.06,
    'Synthetic destination', -1.96, 30.07, 2, 10, 1000,
    'assigned', v_rider_a, -1.95, 30.06, now()
  ) on conflict (id) do update set rider_id = excluded.rider_id;

  insert into public.ride_bookings (
    id, customer_name, customer_phone, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng, distance_km,
    duration_minutes, fare_rwf, status, rider_id
  ) values (
    v_ride_two, 'Synthetic', '+250720000004', -1.95, 30.06,
    'Synthetic destination', -1.96, 30.07, 2, 10, 1000,
    'assigned', v_rider_a
  ) on conflict (id) do update set rider_id = excluded.rider_id;

  insert into public.ride_bookings (
    id, customer_name, customer_phone, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng, distance_km,
    duration_minutes, fare_rwf, status
  ) values (
    v_ride_new, 'Synthetic', '+250720000005', -1.95, 30.06,
    'Synthetic destination', -1.96, 30.07, 2, 10, 1000,
    'requested'
  ) on conflict (id) do update set rider_id = null, status = 'requested';

  begin
    perform public.assign_booking_with_capacity(v_ride_new, v_rider_a, true);
    raise exception 'Expected capacity rejection did not occur';
  exception when raise_exception then
    v_capacity_exception := sqlerrm;
  end;

  if v_capacity_exception not like '%two active jobs%' then
    raise exception 'Unexpected capacity result: %', v_capacity_exception;
  end if;

  if not public.assign_booking_with_capacity(v_ride_old, v_rider_b, false) then
    raise exception 'Reassignment returned false';
  end if;

  if exists (
    select 1 from public.ride_bookings
    where id = v_ride_old
      and (rider_lat is not null or rider_lng is not null or rider_location_updated_at is not null)
  ) then
    raise exception 'Reassignment did not clear old rider GPS';
  end if;

  insert into public.ride_bookings (
    id, customer_name, customer_phone, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng, distance_km,
    duration_minutes, fare_rwf, status
  ) values (
    v_status_ride, 'Synthetic', '+250720000006', -1.95, 30.06,
    'Synthetic destination', -1.96, 30.07, 2, 10, 1000,
    'requested'
  ) on conflict (id) do update set rider_id = null, status = 'requested';

  update public.ride_bookings
  set rider_id = v_rider_b, status = 'assigned'
  where id = v_status_ride;

  update public.ride_bookings
  set status = 'arrived'
  where id = v_status_ride;

  update public.ride_bookings
  set status = 'expired'
  where id = v_status_ride;

  if not exists (
    select 1 from public.ride_bookings
    where id = v_status_ride and status = 'expired'
  ) then
    raise exception 'Expired status was not accepted';
  end if;
end;
$$;

rollback;
