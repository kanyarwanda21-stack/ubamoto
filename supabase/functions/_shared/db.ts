import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizePhone, normalizeReference, safeEqual, sha256Hex } from './common.ts';

// Service-role client: bypasses row level security, so every function must check
// who is asking before it reads or writes.
export const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Returns the signed-in user's id, or null (customers send no user token).
export async function callerId(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  return error || !data.user ? null : data.user.id;
}

export async function getRider(userId: string) {
  const { data } = await db.from('riders').select('*').eq('id', userId).maybeSingle();
  return data;
}

export async function getStaff(userId: string) {
  const { data } = await db.from('staff').select('*').eq('id', userId).maybeSingle();
  return data;
}

const BOOKING_COLUMNS =
  'id, reference, access_token_hash, status, customer_name, customer_phone, ' +
  'pickup_lat, pickup_lng, destination_name, destination_lat, destination_lng, ' +
  'distance_km, duration_minutes, fare_rwf, created_at, rider_id, ' +
  'rider:riders(name, phone, plate_number)';

// Finds a booking only if the caller proves it is theirs.
export async function authorizeBooking(cred: any) {
  const reference = normalizeReference(String(cred?.reference ?? ''));
  if (!reference) return null;

  const { data } = await db
    .from('ride_bookings')
    .select(BOOKING_COLUMNS)
    .eq('reference', reference)
    .maybeSingle();
  if (!data) return null;

  let allowed = false;
  if (typeof cred.token === 'string' && cred.token && data.access_token_hash) {
    allowed = safeEqual(await sha256Hex(cred.token), data.access_token_hash);
  }
  if (!allowed && cred.phone) {
    const phone = normalizePhone(String(cred.phone));
    allowed = !!phone && phone === data.customer_phone;
  }
  return allowed ? data : null;
}

// What a customer is allowed to see. The rider is shown only while a real
// assignment exists.
export function publicView(b: any) {
  const showRider = ['assigned', 'in_progress'].includes(b.status) && b.rider;
  return {
    reference: b.reference,
    status: b.status,
    destination_name: b.destination_name,
    pickup: [b.pickup_lat, b.pickup_lng],
    destination: [b.destination_lat, b.destination_lng],
    distance_km: b.distance_km,
    duration_minutes: b.duration_minutes,
    fare_rwf: b.fare_rwf,
    created_at: b.created_at,
    rider: showRider
      ? { name: b.rider.name, phone: b.rider.phone, plate_number: b.rider.plate_number }
      : null,
  };
}