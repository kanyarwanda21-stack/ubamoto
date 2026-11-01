// supabase/functions/_shared/fare.ts
// MUST stay identical in behaviour to src/fare.js in the React app.
// If you change a number there, change it here and redeploy the function.

export const MIN_FARE_RWF = 500; // any trip under this rounds up
export const BASE_FARE_RWF = 250; // added once per trip

const TIERS = [
  { fromKm: 0, toKm: 8, ratePerKm: 160 },
  { fromKm: 8, toKm: 20, ratePerKm: 140 },
  { fromKm: 20, toKm: Infinity, ratePerKm: 140 }, // assumption: same rate past 20 km
];

export function calculateFare(distanceKm: number): number {
  const km = Math.max(0, Number(distanceKm) || 0);

  let distanceCharge = 0;
  for (const tier of TIERS) {
    const kmInTier = Math.max(0, Math.min(km, tier.toKm) - tier.fromKm);
    distanceCharge += kmInTier * tier.ratePerKm;
  }

  const subtotal = Math.round(BASE_FARE_RWF + distanceCharge);
  return Math.max(MIN_FARE_RWF, subtotal);
}
