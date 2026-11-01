import { corsHeaders, fail, isInRwanda, json } from '../_shared/common.ts';

// Mapbox Search Box API: finds businesses, streets, addresses and neighbourhoods.
// "suggest" runs while typing, "retrieve" returns the exact coordinates of the one
// suggestion the user picks. Both share a session token.
const BASE = 'https://api.mapbox.com/search/searchbox/v1';

// ---------- Kigali road codes: KG 11 Ave, KK 191 St, KN 5 Rd ----------
// KG = Gasabo, KK = Kicukiro, KN = Nyarugenge. Also accepts "kg11", "KG-11", "kn 5 road".
const ROAD_RE = /^\s*(k[gkn])\s*[-.]?\s*(\d{1,3})\s*(avenue|ave|av|street|st|road|rd)?\s*$/i;
const SUFFIX: Record<string, string> = {
  avenue: 'Ave',
  ave: 'Ave',
  av: 'Ave',
  street: 'St',
  st: 'St',
  road: 'Rd',
  rd: 'Rd',
};

type Road = { prefix: string; num: string; suffix: string | null };

function parseRoadCode(query: string): Road | null {
  const m = ROAD_RE.exec(query);
  if (!m) return null;
  return {
    prefix: m[1].toUpperCase(),
    num: String(Number(m[2])),
    suffix: m[3] ? SUFFIX[m[3].toLowerCase()] : null,
  };
}

// Returns how well a result matches the road: 0 exact, 1 same code (no suffix given),
// or null when it is a different road (other number, or other Ave/St/Rd).
function roadMatch(text: string, road: Road): number | null {
  const re = new RegExp(
    `\\b${road.prefix}\\s*[-.]?\\s*0*${road.num}(?!\\d)\\s*(avenue|ave|av|street|st|road|rd)?`,
    'i'
  );
  const m = re.exec(text);
  if (!m) return null;

  const found = m[1] ? SUFFIX[m[1].toLowerCase()] : null;
  if (road.suffix) {
    if (found && found !== road.suffix) return null; // e.g. asked "KG 14 Ave", got "KG 14 St"
    return found === road.suffix ? 0 : 1;
  }
  return found ? 1 : 0;
}

// ---------- Ranking for normal searches ----------
const PRIORITY: Record<string, number> = {
  poi: 0,
  street: 1,
  address: 1,
  neighborhood: 2,
  locality: 2,
};
const GENERIC = new Set(['place', 'region', 'district', 'country', 'postcode']);

async function suggest(
  q: string,
  types: string,
  token: string,
  session: string,
  near: string
): Promise<any[]> {
  const response = await fetch(
    `${BASE}/suggest?q=${encodeURIComponent(q)}` +
      `&session_token=${session}&country=rw&language=en&limit=8` +
      `&types=${types}${near}&access_token=${token}`
  );
  if (!response.ok) throw new Error('upstream');
  return (await response.json()).suggestions ?? [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, q, lat, lon, id, session } = await req.json();

    const token = Deno.env.get('MAPBOX_TOKEN');
    if (!token) return fail('Place search is not configured.', 500);

    const sessionToken = String(session ?? '');
    if (!/^[\w-]{10,64}$/.test(sessionToken)) return fail('Invalid request.');

    if (action === 'retrieve') {
      const placeId = String(id ?? '');
      if (!placeId || placeId.length > 500) return fail('Invalid request.');

      let response: Response;
      try {
        response = await fetch(
          `${BASE}/retrieve/${encodeURIComponent(placeId)}` +
            `?session_token=${sessionToken}&access_token=${token}`
        );
      } catch {
        return fail('Could not load that place. Try again.', 502);
      }
      if (!response.ok) return fail('Could not load that place. Try again.', 502);

      const feature = (await response.json()).features?.[0];
      const [lng, latitude] = feature?.geometry?.coordinates ?? [];
      if (!isInRwanda(latitude, lng)) {
        return fail('That place is outside Rwanda. Choose a place in Rwanda.', 422);
      }

      return json({
        success: true,
        place: {
          name: feature.properties?.name ?? 'Unnamed place',
          lat: latitude,
          lng,
        },
      });
    }

    // ---------- suggest ----------
    const query = String(q ?? '').trim();
    if (query.length < 3 || query.length > 100) {
      return json({ success: true, results: [] });
    }

    const near =
      Number.isFinite(lat) && Number.isFinite(lon) ? `&proximity=${lon},${lat}` : '';
    const road = parseRoadCode(query);

    let raw: any[];
    try {
      if (road) {
        // Roads only (never cities), searching the written form people use on signs.
        const base = `${road.prefix} ${road.num}`;
        const queries = road.suffix
          ? [`${base} ${road.suffix}`]
          : [`${base} Ave`, `${base} St`, `${base} Rd`, base];
        const batches = await Promise.all(
          queries.map((text) => suggest(text, 'street,address,poi', token, sessionToken, near))
        );
        raw = batches.flat();
      } else {
        raw = await suggest(
          query,
          'poi,street,address,neighborhood,locality,place',
          token,
          sessionToken,
          near
        );
      }
    } catch {
      return fail('Place search is temporarily unavailable. Try again.', 502);
    }

    const lowered = query.toLowerCase();
    const seen = new Set<string>();
    const ranked: { item: any; score: number; distance: number }[] = [];

    for (const s of raw) {
      const key = s.mapbox_id ?? `${s.name}|${s.full_address ?? s.place_formatted}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const text = `${s.name ?? ''} ${s.full_address ?? ''}`;
      let score: number;

      if (road) {
        const match = roadMatch(text, road); // keeps only the road that was asked for
        if (match === null) continue;
        score = match;
      } else {
        const type = String(s.feature_type ?? '');
        const name = String(s.name ?? '').toLowerCase();
        // Hide "Kigali" and other big areas unless the customer typed them.
        if (GENERIC.has(type) && !(lowered.includes(name) || name.startsWith(lowered))) {
          continue;
        }
        score = PRIORITY[type] ?? 3;
      }

      ranked.push({ item: s, score, distance: Number(s.distance ?? Infinity) });
    }

    ranked.sort((a, b) => a.score - b.score || a.distance - b.distance);

    const results = ranked.slice(0, 6).map(({ item }) => ({
      id: item.mapbox_id,
      name: item.name ?? 'Unnamed place',
      details: item.full_address ?? item.place_formatted ?? item.address ?? '',
    }));

    const notice =
      results.length === 0
        ? road
          ? `We couldn't find ${road.prefix} ${road.num}${road.suffix ? ` ${road.suffix}` : ''} in our map data. Tap "Choose on the map" and tap the exact spot.`
          : 'No match found. Try another spelling, or tap "Choose on the map" and tap the exact spot.'
        : undefined;

    return json({ success: true, results, notice });
  } catch {
    return fail('Invalid request.');
  }
});
