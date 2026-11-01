import {
  MAX_TRIP_KM,
  corsHeaders,
  fail,
  fareForKm,
  isValidPoint,
  json,
  signQuote,
} from '../_shared/common.ts';

const QUOTE_LIFETIME_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { pickup, destination } = await req.json();

    if (!isValidPoint(pickup) || !isValidPoint(destination)) {
      return fail('Pickup and destination must both be inside Rwanda.');
    }

    const token = Deno.env.get('MAPBOX_TOKEN');
    if (!token) return fail('Routing is not configured.', 500);

    const url =
      'https://api.mapbox.com/directions/v5/mapbox/driving/' +
      `${pickup[1]},${pickup[0]};${destination[1]},${destination[0]}` +
      `?overview=full&geometries=geojson&access_token=${token}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return fail('Routing is temporarily unavailable. Try again.', 502);
    }
    if (!response.ok) return fail('Routing is temporarily unavailable. Try again.', 502);

    const route = (await response.json()).routes?.[0];
    if (!route) return fail('No road route found between these points.', 422);

    const km = Math.round(route.distance / 10) / 100; // metres -> km, 2 decimals
    if (km < 0.05) {
      return fail('Pickup and destination are almost the same point. Choose a different destination.', 422);
    }
    if (km > MAX_TRIP_KM) {
      return fail(`Trips are limited to ${MAX_TRIP_KM} km. Choose a closer destination.`, 422);
    }

    const minutes = Math.max(1, Math.round(route.duration / 60));
    const fare = fareForKm(km);
    const expires_at = Date.now() + QUOTE_LIFETIME_MS;

    const quote = await signQuote({
      pickup,
      destination,
      km,
      minutes,
      fare,
      exp: expires_at,
    });

    return json({
      success: true,
      distance_km: km,
      duration_minutes: minutes,
      fare_rwf: fare,
      expires_at,
      quote,
      geometry: route.geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng]),
    });
  } catch {
    return fail('Invalid request.');
  }
});