import {
  MAX_TRIP_KM,
  allocateFare,
  fail,
  fareForKm,
  FARE_POLICY_VERSION,
  isValidPoint,
  normalizeProviderRoute,
  json,
  rejectDisallowedOrigin,
  preflightHeaders,
  signQuote,
} from '../_shared/common.ts';
import { checkRateLimit } from '../_shared/db.ts';

const QUOTE_LIFETIME_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: preflightHeaders(req) });
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  try {
    const { pickup, destination } = await req.json();
    if (!await checkRateLimit(req, 'estimate-route', 30, 60)) {
      return fail('Too many route estimates. Please try again later.', 429);
    }

    if (!isValidPoint(pickup) || !isValidPoint(destination)) {
      return fail('Pickup and destination must both be inside Rwanda.');
    }

    const osrmUrl =
      'https://router.project-osrm.org/route/v1/driving/' +
      `${pickup[1]},${pickup[0]};${destination[1]},${destination[0]}` +
      '?overview=full&geometries=geojson&steps=false';

    let route: any = null;
    let routingProvider = 'osrm';
    let normalizedRoute: { geometry: Array<[number, number]>; distanceKm: number; durationMinutes: number } | null = null;

    try {
      const osrmResponse = await fetch(osrmUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (osrmResponse.ok) {
        const osrmData = await osrmResponse.json();
        route = osrmData.routes?.[0] ?? null;
        normalizedRoute = normalizeProviderRoute(route);
      }
    } catch {
      route = null;
    }

    if (!normalizedRoute) {
      const token = Deno.env.get('MAPBOX_TOKEN');
      if (!token) return fail('Routing is temporarily unavailable. Try again.', 502);

      routingProvider = 'mapbox';
      const mapboxUrl =
        'https://api.mapbox.com/directions/v5/mapbox/driving/' +
        `${pickup[1]},${pickup[0]};${destination[1]},${destination[0]}` +
        `?overview=full&geometries=geojson&access_token=${token}`;

      try {
        const mapboxResponse = await fetch(mapboxUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (mapboxResponse.ok) {
          const mapboxData = await mapboxResponse.json();
          route = mapboxData.routes?.[0] ?? null;
          normalizedRoute = normalizeProviderRoute(route);
        }
      } catch {
        route = null;
      }
    }

    if (!normalizedRoute) return fail('No valid road route found between these points.', 422);

    const { geometry, distanceKm: km, durationMinutes: minutes } = normalizedRoute;
    if (km < 0.05) {
      return fail('Pickup and destination are almost the same point. Choose a different destination.', 422);
    }
    if (km > MAX_TRIP_KM) {
      return fail(`Trips are limited to ${MAX_TRIP_KM} km. Choose a closer destination.`, 422);
    }

    const fare = fareForKm(km);
    const allocation = allocateFare(fare);
    const expires_at = Date.now() + QUOTE_LIFETIME_MS;

    const quote = await signQuote({
      pickup,
      destination,
      km,
      minutes,
      geometry,
      routingProvider,
      fare,
      farePolicyVersion: FARE_POLICY_VERSION,
      riderPayout: allocation.riderPayout,
      ubamotoCommission: allocation.ubamotoCommission,
      exp: expires_at,
    });

    return json({
      success: true,
      distance_km: km,
      duration_minutes: minutes,
      fare_rwf: fare,
      expires_at,
      quote,
      geometry,
      routing_provider: routingProvider,
    });
  } catch {
    return fail('Invalid request.');
  }
});