// Shared by search-places, estimate-route and create-ride-booking.
// The fare rules here are authoritative. Keep them in sync with src/fare.js.

export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export const fail = (error: string, status = 400) =>
  json({ success: false, error }, status);

// ---------- Geography and phone ----------
export function isInRwanda(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -2.9 &&
    lat <= -1.0 &&
    lng >= 28.8 &&
    lng <= 30.95
  );
}

export function isValidPoint(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    isInRwanda(p[0], p[1])
  );
}

export function normalizePhone(input: string) {
  const cleaned = input.replace(/[\s().-]/g, '');
  const match = /^(?:\+?250|0)?(7[2389]\d{7})$/.exec(cleaned);
  return match ? `+250${match[1]}` : null;
}

// ---------- Fare ----------
export const MIN_FARE_RWF = 500;
export const BASE_FARE_RWF = 250;
export const MAX_TRIP_KM = 40;
export const FARE_POLICY_VERSION = 'ubamoto-fare-2026-11-01';

export function fareForKm(distanceKm: number) {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) throw new Error('Distance must be positive.');
  if (km > MAX_TRIP_KM) throw new Error('Trips are limited to 40 km.');
  if (km <= 2) return 589;
  if (km <= 8) return Math.max(MIN_FARE_RWF, Math.ceil(BASE_FARE_RWF + km * 200));
  if (km <= 20) {
    return Math.max(MIN_FARE_RWF, Math.ceil(BASE_FARE_RWF + 8 * 200 + (km - 8) * 140));
  }
  return Math.max(
    MIN_FARE_RWF,
    Math.ceil(BASE_FARE_RWF + 8 * 200 + 12 * 140 + (km - 20) * 100)
  );
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

// ---------- Signed quotes (HMAC-SHA256) ----------
// estimate-route signs the route + fare. create-ride-booking only accepts a
// quote with a valid signature, so the browser cannot invent a fare.
const encoder = new TextEncoder();

const toB64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromB64Url = (text: string) =>
  Uint8Array.from(
    atob(text.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );

function hmacKey() {
  const secret = Deno.env.get('QUOTE_SECRET');
  if (!secret) throw new Error('QUOTE_SECRET is not set');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export type Quote = {
  pickup: [number, number];
  destination: [number, number];
  km: number;
  minutes: number;
  fare: number;
  farePolicyVersion: string;
  riderPayout: number;
  ubamotoCommission: number;
  exp: number; // epoch ms
};

export async function signQuote(quote: Quote) {
  const body = toB64Url(encoder.encode(JSON.stringify(quote)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(body));
  return `${body}.${toB64Url(new Uint8Array(sig))}`;
}

export async function verifyQuote(token: string): Promise<Quote | null> {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(),
      fromB64Url(sig),
      encoder.encode(body)
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromB64Url(body))) as Quote;
  } catch {
    return null;
  }
}

// ---------- Booking references and private access tokens ----------
// Customers have no accounts. Each booking gets:
//  - a short reference they can read out to support (UB-ABCD-EFGH), and
//  - a long secret token kept on their device. Only its hash is stored.
// A ride can be viewed or cancelled with reference + token (this device) or
// reference + the phone number used for the booking (another device).
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

export function newReference(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

export function normalizeReference(input: string) {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ref = cleaned.length === 10 && cleaned.startsWith('UB') ? cleaned.slice(2) : cleaned;
  return /^[A-HJKMNP-Z2-9]{8}$/.test(ref) ? ref : null;
}

export function newToken() {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}