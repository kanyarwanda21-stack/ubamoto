import {
  corsHeaders,
  rejectDisallowedOrigin,
  fail,
  json,
  newReference,
  newToken,
  normalizePhone,
  sha256Hex,
  verifyQuote,
} from '../_shared/common.ts';
import { db } from '../_shared/db.ts';

const MAX_REQUESTS_PER_PHONE = 3; // per 10 minutes
const MAX_ACTIVE_PER_PHONE = 2; // open rides at the same time

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const body = await req.json();

    const name = String(body.customer_name ?? '').trim();
    const phone = normalizePhone(String(body.customer_phone ?? ''));
    const destinationName =
      String(body.destination_name ?? '').trim().slice(0, 200) || 'Pinned location';
    const destinationAddress =
      String(body.destination_address ?? '').trim().slice(0, 500) || null;
    const destinationType =
      String(body.destination_type ?? '').trim().slice(0, 50) || null;

    if (body.accepted_terms !== true) {
      return fail('Please accept the Terms of Service and Privacy Policy to continue.');
    }
    if (!name || name.length > 100) return fail('Please enter your name.');
    if (!phone) return fail('Please enter a valid Rwandan phone number.');

    const riderPhone = await db
      .from('riders')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone);
    if ((riderPhone.count ?? 0) > 0) {
      return fail('Rider accounts cannot create customer bookings. Sign in to the rider app.');
    }

    // Route, distance and fare come from the signed quote, never from the client.
    const quote = await verifyQuote(String(body.quote ?? ''));
    if (!quote) return fail('Invalid fare estimate. Please calculate the route again.');
    if (Date.now() > quote.exp) {
      return fail('Your fare estimate expired. Please calculate the route again.');
    }

    // Spam limits per phone number.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await db
      .from('ride_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_phone', phone)
      .gte('created_at', since);
    if ((recent.count ?? 0) >= MAX_REQUESTS_PER_PHONE) {
      return fail('Too many requests. Please wait a few minutes and try again.', 429);
    }

    const active = await db
      .from('ride_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_phone', phone)
      .in('status', ['requested', 'assigned', 'arrived', 'in_progress']);
    if ((active.count ?? 0) >= MAX_ACTIVE_PER_PHONE) {
      return fail(
        'You already have open ride requests. Cancel one in My Rides or wait for it to finish.',
        429
      );
    }

    // The secret is shown once; only its hash is stored.
    const accessToken = newToken();
    const accessTokenHash = await sha256Hex(accessToken);

    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = newReference();
      const { data, error } = await db
        .from('ride_bookings')
        .insert({
          customer_name: name,
          customer_phone: phone,
          pickup_lat: quote.pickup[0],
          pickup_lng: quote.pickup[1],
          destination_name: destinationName,
          destination_address: destinationAddress,
          destination_type: destinationType,
          destination_lat: quote.destination[0],
          destination_lng: quote.destination[1],
          distance_km: quote.km,
          duration_minutes: quote.minutes,
          fare_rwf: quote.fare,
          fare_policy_version: quote.farePolicyVersion,
          rider_payout_rwf: quote.riderPayout,
          ubamoto_commission_rwf: quote.ubamotoCommission,
          status: 'requested',
          reference,
          access_token_hash: accessTokenHash,
        })
        .select('id, reference')
        .single();

      if (!error) {
        return json({
          success: true,
          booking_id: data.id,
          reference: data.reference,
          access_token: accessToken,
        });
      }
      if (error.code !== '23505') {
        console.error('Insert failed:', error);
        return fail('We could not save your request. Please try again.', 500);
      }
      // 23505 = that reference already exists: try another one.
    }

    return fail('We could not create your request. Please try again.', 500);
  } catch (error) {
    console.error('create-ride-booking failed:', error);
    return fail('Invalid request.');
  }
});