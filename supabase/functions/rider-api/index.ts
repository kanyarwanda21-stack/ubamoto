import { fail, json, rejectDisallowedOrigin, preflightHeaders } from '../_shared/common.ts';
import { callerId, db, getRider } from '../_shared/db.ts';

const OPEN_WINDOW_MS = 6 * 60 * 60 * 1000; // ignore requests older than 6 hours

const round3 = (n: number) => Math.round(Number(n) * 1000) / 1000; // about 100 m

const OPEN_COLUMNS =
  'id, destination_name, distance_km, duration_minutes, fare_rwf, created_at, ' +
  'pickup_lat, pickup_lng, destination_lat, destination_lng';
const JOB_COLUMNS =
  'id, reference, status, customer_name, customer_phone, destination_name, ' +
  'destination_address, destination_type, ' +
  'distance_km, duration_minutes, fare_rwf, created_at, assigned_at, ' +
  'pickup_lat, pickup_lng, destination_lat, destination_lng';

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders(req) });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const userId = await callerId(req);
    if (!userId) return fail('Please sign in.', 401);

    const rider = await getRider(userId);
    if (!rider) return fail('This account is not a rider account.', 403);

    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'me') {
      return json({
        success: true,
        rider: {
          name: rider.name,
          phone: rider.phone,
          plate_number: rider.plate_number,
          status: rider.status,
        },
      });
    }

    // Everything below is for verified riders only.
    if (rider.status !== 'verified') {
      return fail('Your rider account is not verified yet.', 403);
    }

    // New requests: the exact pickup and the customer's details stay hidden until accepted.
    if (action === 'list_open') {
      const since = new Date(Date.now() - OPEN_WINDOW_MS).toISOString();
      const { data, error } = await db
        .from('ride_bookings')
        .select(OPEN_COLUMNS)
        .eq('status', 'requested')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return fail('Could not load requests.', 500);

      return json({
        success: true,
        jobs: (data ?? []).map((b: any) => ({
          id: b.id,
          destination_name: b.destination_name,
          distance_km: b.distance_km,
          duration_minutes: b.duration_minutes,
          fare_rwf: b.fare_rwf,
          created_at: b.created_at,
          pickup_area: [round3(b.pickup_lat), round3(b.pickup_lng)],
        })),
      });
    }

    if (action === 'my_jobs') {
      const { data, error } = await db
        .from('ride_bookings')
        .select(JOB_COLUMNS)
        .eq('rider_id', rider.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return fail('Could not load your rides.', 500);

      return json({
        success: true,
        jobs: (data ?? []).map((b: any) => {
          const live = ['assigned', 'in_progress'].includes(b.status);
          return {
            id: b.id,
            reference: b.reference,
            status: b.status,
            destination_name: b.destination_name,
            destination_address: b.destination_address ?? null,
            destination_type: b.destination_type ?? null,
            distance_km: b.distance_km,
            duration_minutes: b.duration_minutes,
            fare_rwf: b.fare_rwf,
            created_at: b.created_at,
            // Customer details only while the ride is live.
            customer_name: live ? b.customer_name : null,
            customer_phone: live ? b.customer_phone : null,
            pickup: live ? [b.pickup_lat, b.pickup_lng] : [round3(b.pickup_lat), round3(b.pickup_lng)],
            destination: live
              ? [b.destination_lat, b.destination_lng]
              : [round3(b.destination_lat), round3(b.destination_lng)],
          };
        }),
      });
    }

    const id = body.id;
    if (id === undefined || id === null || String(id).length > 64) return fail('Invalid request.');

    if (action === 'accept') {
      const { data, error } = await db.rpc('assign_booking_with_capacity', {
        p_booking_id: id,
        p_rider_id: rider.id,
        p_only_open: true,
      });
      if (error) {
        console.error('Ride acceptance RPC failed:', error);
        if (error.message?.includes('two active jobs')) {
          return fail('Finish your current rides before accepting another.', 409);
        }
        return fail('Could not accept this ride. Please try again.', 500);
      }
      if (!data) return fail('This request is no longer available.', 409);
      return json({ success: true });
    }

    if (action === 'update_location') {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < -2.9 || lat > -1.0 || lng < 28.8 || lng > 30.95) {
        return fail('A valid Rwanda location is required.', 422);
      }
      const updatedAt = new Date().toISOString();
      const { data, error } = await db
        .from('ride_bookings')
        .update({ rider_lat: lat, rider_lng: lng, rider_location_updated_at: updatedAt })
        .eq('id', id)
        .eq('rider_id', rider.id)
        .in('status', ['assigned', 'in_progress'])
        .select('id')
        .maybeSingle();
      if (error || !data) return fail('Location sharing is only available for an active assigned ride.', 409);
      return json({ success: true, updated_at: updatedAt });
    }

    // Moves a ride this rider owns from one status to the next.
    const move = async (from: string, patch: Record<string, unknown>, message: string) => {
      const { data } = await db
        .from('ride_bookings')
        .update(patch)
        .eq('id', id)
        .eq('rider_id', rider.id)
        .eq('status', from)
        .select('id')
        .maybeSingle();
      return data ? json({ success: true }) : fail(message, 409);
    };

    if (action === 'start') {
      return move('assigned', { status: 'in_progress', started_at: new Date().toISOString() },
        'This ride cannot be started (it may have been cancelled).');
    }
    if (action === 'complete') {
      return move('in_progress', {
        status: 'completed',
        completed_at: new Date().toISOString(),
        rider_lat: null,
        rider_lng: null,
        rider_location_updated_at: null,
      },
        'This ride is not in progress.');
    }
    if (action === 'release') {
      // Hands the ride back so another rider can take it (only before it starts).
      return move('assigned', {
        status: 'requested',
        rider_id: null,
        assigned_at: null,
        rider_lat: null,
        rider_lng: null,
        rider_location_updated_at: null,
      },
        'This ride can no longer be released.');
    }

    return fail('Unknown action.');
  } catch (error) {
    console.error('rider-api failed:', error);
    return fail('Invalid request.');
  }
});