// src/fare.js
// Single source of truth for UBAmoto fares on the client.
// The same rules live in supabase/functions/_shared/common.ts, which is the
// authoritative copy: the server computes the fare and signs it in a quote.
// If you change a number here, change it there too.

export const FARE_POLICY_VERSION = 'ubamoto-fare-2026-11-01';
export const SHORT_TRIP_MAX_KM = 2;
export const SHORT_TRIP_FARE_RWF = 589;
export const MIN_FARE_RWF = 500;
export const BASE_FARE_RWF = 250;
export const FIRST_TIER_MAX_KM = 8;
export const SECOND_TIER_MAX_KM = 20;
export const MAX_TRIP_KM = 40;

export const FARE_TIERS = [
  { fromKm: 0, toKm: 8, ratePerKm: 200, label: '0–8 km', note: 'Standard distance rate after 2 km' },
  { fromKm: 8, toKm: 20, ratePerKm: 140, label: '8–20 km', note: 'Distance between 8 and 20 km' },
];

export const OVER_20_KM_RATE_RWF = 100;

export function roundKm(km) {
  return Math.round((Number(km) || 0) * 100) / 100;
}

export function getFareBreakdown(distanceKm) {
  const raw = Number(distanceKm);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('Distance must be positive.');
  if (raw > MAX_TRIP_KM) throw new Error(`Trips are limited to ${MAX_TRIP_KM} km.`);

  const km = roundKm(raw);
  let distanceCharge = 0;
  let subtotal;
  let shortTripApplied = false;

  if (km <= SHORT_TRIP_MAX_KM) {
    shortTripApplied = true;
    subtotal = SHORT_TRIP_FARE_RWF;
  } else if (km <= FIRST_TIER_MAX_KM) {
    distanceCharge = km * 200;
    subtotal = BASE_FARE_RWF + distanceCharge;
  } else if (km <= SECOND_TIER_MAX_KM) {
    distanceCharge = FIRST_TIER_MAX_KM * 200 + (km - FIRST_TIER_MAX_KM) * 140;
    subtotal = BASE_FARE_RWF + distanceCharge;
  } else {
    distanceCharge =
      FIRST_TIER_MAX_KM * 200 +
      (SECOND_TIER_MAX_KM - FIRST_TIER_MAX_KM) * 140 +
      (km - SECOND_TIER_MAX_KM) * 100;
    subtotal = BASE_FARE_RWF + distanceCharge;
  }

  const total = shortTripApplied
    ? SHORT_TRIP_FARE_RWF
    : Math.max(MIN_FARE_RWF, Math.ceil(subtotal));

  return {
    distanceKm: km,
    base: BASE_FARE_RWF,
    distanceCharge: Math.round(distanceCharge),
    subtotal,
    total,
    minimumApplied: subtotal < MIN_FARE_RWF,
    shortTripApplied,
  };
}

export function calculateFare(distanceKm) {
  return getFareBreakdown(distanceKm).total;
}

export function allocateFare(customerFare) {
  const fare = Number(customerFare);
  if (!Number.isInteger(fare) || fare <= 0) throw new Error('Invalid customer fare.');
  const riderPayout = Math.max(500, Math.round(fare * 0.85));
  return {
    customerFare: fare,
    riderPayout,
    ubamotoCommission: fare - riderPayout,
  };
}

export function formatRwf(amount) {
  return `RWF ${Number(amount || 0).toLocaleString('en-RW')}`;
}
