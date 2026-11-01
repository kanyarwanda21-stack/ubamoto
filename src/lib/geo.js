export const KIGALI = [-1.9441, 30.0619];

// Rough bounding box of Rwanda. The server applies the same check.
const RWANDA_BOUNDS = { south: -2.9, north: -1.0, west: 28.8, east: 30.95 };

export function isInRwanda(point) {
  if (!Array.isArray(point) || point.length < 2) return false;
  const [lat, lng] = point;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= RWANDA_BOUNDS.south &&
    lat <= RWANDA_BOUNDS.north &&
    lng >= RWANDA_BOUNDS.west &&
    lng <= RWANDA_BOUNDS.east
  );
}

// Accepts 078 123 4567, 78 123 4567, 250781234567, +250 781 234 567, etc.
// Always returns +2507XXXXXXXX, or null when the number is not valid.
export function normalizeRwandaPhone(input) {
  const cleaned = String(input || '').replace(/[\s().-]/g, '');
  const match = /^(?:\+?250|0)?(7[2389]\d{7})$/.exec(cleaned);
  return match ? `+250${match[1]}` : null;
}
