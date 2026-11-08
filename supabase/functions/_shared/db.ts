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

export async function checkRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
  identity?: string,
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')?.trim()
    ?? 'unknown';
  const key = await sha256Hex(`${scope}:${identity ?? ip}`);
  const { data } = await db.rpc('check_rate_limit', {
    p_key_hash: key,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  return data === true;
}

const BOOKING_COLUMNS =
  'id, reference, access_token_hash, status, customer_name, customer_phone, ' +
  'pickup_lat, pickup_lng, destination_name, destination_lat, destination_lng, ' +
  'destination_address, destination_type, rider_lat, rider_lng, rider_location_updated_at, ' +
  'distance_km, duration_minutes, fare_rwf, created_at, rider_id, ' +
  'rider:riders(name, phone, plate_number, passport_photo_path)';

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
export async function publicView(b: any) {
  const showRider = ['assigned', 'arrived', 'in_progress'].includes(b.status) && b.rider;
  const locationAgeMs = b.rider_location_updated_at
    ? Date.now() - new Date(b.rider_location_updated_at).getTime()
    : Infinity;
  const liveRiderLocation =
    showRider &&
    Number.isFinite(b.rider_lat) &&
    Number.isFinite(b.rider_lng) &&
    locationAgeMs >= 0 &&
    locationAgeMs <= 2 * 60 * 1000
      ? [b.rider_lat, b.rider_lng]
      : null;
  let passportPhotoUrl = null;
  if (showRider && b.rider.passport_photo_path) {
    const signed = await db.storage
      .from('rider-passports')
      .createSignedUrl(b.rider.passport_photo_path, 600);
    if (!signed.error) passportPhotoUrl = signed.data.signedUrl;
  }
  return {
    reference: b.reference,
    status: b.status,
    destination_name: b.destination_name,
    destination_address: b.destination_address ?? null,
    destination_type: b.destination_type ?? null,
    pickup: [b.pickup_lat, b.pickup_lng],
    destination: [b.destination_lat, b.destination_lng],
    rider_location: liveRiderLocation,
    rider_location_updated_at: liveRiderLocation ? b.rider_location_updated_at : null,
    distance_km: b.distance_km,
    duration_minutes: b.duration_minutes,
    fare_rwf: b.fare_rwf,
    created_at: b.created_at,
    rider: showRider
      ? {
          name: b.rider.name,
          phone: b.rider.phone,
          plate_number: b.rider.plate_number,
          passport_photo_url: passportPhotoUrl,
        }
      : null,
  };
}