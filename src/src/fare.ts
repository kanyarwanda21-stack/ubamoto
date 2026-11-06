// supabase/functions/_shared/fare.ts
// MUST stay identical in behaviour to src/fare.js in the React app.
// If you change a number there, change it here and redeploy the function.

export const FARE_POLICY_VERSION = 'ubamoto-fare-2026-11-01';
export const MIN_FARE_RWF = 500;
export const BASE_FARE_RWF = 250;
export const MAX_TRIP_KM = 40;

export function calculateFare(distanceKm: number): number {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) throw new Error('Distance must be positive.');
  if (km > MAX_TRIP_KM) throw new Error('Trips are limited to 40 km.');
  if (km <= 2) return 589;
  if (km <= 8) return Math.max(500, Math.ceil(250 + km * 200));
  if (km <= 20) return Math.max(500, Math.ceil(250 + 8 * 200 + (km - 8) * 140));
  return Math.max(500, Math.ceil(250 + 8 * 200 + 12 * 140 + (km - 20) * 100));
}

export function allocateFare(customerFare: number) {
  if (!Number.isInteger(customerFare) || customerFare <= 0) throw new Error('Invalid customer fare.');
  const riderPayout = Math.max(500, Math.round(customerFare * 0.85));
  return {
    customerFare,
    riderPayout,
    ubamotoCommission: customerFare - riderPayout,
  };
}
