// src/fare.js
// Single source of truth for UBAmoto fares on the client.
// The same rules live in supabase/functions/_shared/common.ts, which is the
// authoritative copy: the server computes the fare and signs it in a quote.
// If you change a number here, change it there too.

export const MIN_FARE_RWF = 500; // any trip under this rounds up
export const BASE_FARE_RWF = 250; // added once per trip
export const MAX_TRIP_KM = 40; // longest trip we accept

// Each km is charged at the rate of the tier it falls in.
export const FARE_TIERS = [
  { fromKm: 0, toKm: 8, ratePerKm: 160, label: '0–8 km', note: 'Standard urban rate' },
  { fromKm: 8, toKm: 20, ratePerKm: 140, label: '8–20 km', note: 'Cheaper for longer hops' },
];

// Distance beyond 20 km is charged at this rate.
export const OVER_20_KM_RATE_RWF = 140;

const ALL_TIERS = [
  ...FARE_TIERS,
  { fromKm: 20, toKm: Infinity, ratePerKm: OVER_20_KM_RATE_RWF },
];

// Distances are rounded to 2 decimals everywhere (client and server) so both
// sides always compute exactly the same fare.
export function roundKm(km) {
  return Math.round((Number(km) || 0) * 100) / 100;
}

export function getFareBreakdown(distanceKm) {
  const km = Math.max(0, roundKm(distanceKm));

  let distanceCharge = 0;
  for (const tier of ALL_TIERS) {
    const kmInTier = Math.max(0, Math.min(km, tier.toKm) - tier.fromKm);
    distanceCharge += kmInTier * tier.ratePerKm;
  }

  const subtotal = Math.round(BASE_FARE_RWF + distanceCharge);
  const total = Math.max(MIN_FARE_RWF, subtotal);

  return {
    distanceKm: km,
    base: BASE_FARE_RWF,
    distanceCharge: Math.round(distanceCharge),
    subtotal,
    total,
    minimumApplied: subtotal < MIN_FARE_RWF,
  };
}

export function calculateFare(distanceKm) {
  return getFareBreakdown(distanceKm).total;
}

export function formatRwf(amount) {
  return `RWF ${Number(amount || 0).toLocaleString('en-RW')}`;
}
