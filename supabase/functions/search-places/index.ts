import { corsHeaders, isInRwanda, rejectDisallowedOrigin, preflightHeaders } from "../_shared/common.ts";
import { checkRateLimit } from "../_shared/db.ts";

const PHOTON_URL = "https://photon.komoot.io/api/";
const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";
const MAPBOX_URL = "https://api.mapbox.com/search/searchbox/v1";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 6;
// Rwanda search boundary: west, south, east, north.
const RWANDA_BBOX = "28.8,-2.9,30.95,-1.0";

type PhotonFeature = {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown>;
};

type PlaceResult = {
  id: string;
  name: string;
  details: string;
  address: string;
  type: string;
  category: string;
};

type Coordinate = {
  lat: number;
  lng: number;
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    isInRwanda(lat, lng)
  );
}


async function fetchJson(
  url: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}`);
    }

    const data: unknown = await response.json();

    if (!data || typeof data !== "object") {
      throw new Error("Provider returned an invalid response");
    }

    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPhotonCoordinates(
  feature: PhotonFeature,
): Coordinate | null {
  const coordinates = feature.geometry?.coordinates;

  if (
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number"
  ) {
    return null;
  }

  const lng = coordinates[0];
  const lat = coordinates[1];

  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  return { lat, lng };
}

function photonCategory(properties: Record<string, unknown>): string {
  const osmValue = cleanText(properties.osm_value).toLowerCase();
  const type = cleanText(properties.type).toLowerCase();

  const combined = `${osmValue} ${type}`;

  if (
    /hospital|clinic|doctors|pharmacy|healthcare/.test(combined)
  ) return "health";

  if (
    /supermarket|convenience|mall|department_store|marketplace/.test(combined)
  ) return "business";

  if (
    /restaurant|cafe|fast_food|hotel|guest_house/.test(combined)
  ) return "business";

  if (/street|road|highway|residential/.test(combined)) {
    return "street";
  }

  if (/house|building|address/.test(combined)) {
    return "address";
  }

  if (/neighbourhood|neighborhood|suburb|quarter/.test(combined)) {
    return "neighborhood";
  }

  if (/city|town|village|locality/.test(combined)) {
    return "place";
  }

  return "place";
}

function photonName(properties: Record<string, unknown>): string {
  return (
    cleanText(properties.name) ||
    cleanText(properties.street) ||
    cleanText(properties.locality) ||
    cleanText(properties.city) ||
    cleanText(properties.district) ||
    ""
  );
}

function photonAddress(properties: Record<string, unknown>): string {
  const parts = [
    cleanText(properties.housenumber),
    cleanText(properties.street),
    cleanText(properties.suburb),
    cleanText(properties.district),
    cleanText(properties.city),
  ].filter(Boolean);

  return [...new Set(parts)].join(", ");
}

function photonFeatureId(
  query: string,
  properties: Record<string, unknown>,
): string | null {
  const osmType = cleanText(properties.osm_type);
  const osmId = properties.osm_id;

  if (
    !osmType ||
    (typeof osmId !== "string" && typeof osmId !== "number")
  ) {
    return null;
  }

  // The browser cannot use this ID to submit arbitrary coordinates.
  // Retrieval repeats the search and verifies the OSM identity.
  return `photon:${encodeURIComponent(JSON.stringify({
    q: query,
    osm_type: osmType,
    osm_id: String(osmId),
  }))}`;
}

function distanceScore(
  lat: number,
  lng: number,
  near: Coordinate | null,
): number {
  if (!near) return 0;

  const latDifference = lat - near.lat;
  const lngDifference = (lng - near.lng) *
    Math.cos((near.lat * Math.PI) / 180);

  return Math.sqrt(
    latDifference * latDifference +
    lngDifference * lngDifference,
  );
}

function rankPhotonResults(
  features: PhotonFeature[],
  query: string,
  near: Coordinate | null,
): PlaceResult[] {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, " ");
  const seen = new Set<string>();

  const ranked = features
    .map((feature) => {
      const properties = feature.properties ?? {};
      const coordinates = getPhotonCoordinates(feature);
      const name = photonName(properties);

      if (!coordinates || !name) return null;

      const id = photonFeatureId(query, properties);
      if (!id) return null;

      const address = photonAddress(properties);
      const searchable = `${name} ${address}`.toLowerCase();

      let score = 0;

      if (name.toLowerCase() === normalizedQuery) score += 100;
      else if (name.toLowerCase().startsWith(normalizedQuery)) score += 60;
      else if (searchable.includes(normalizedQuery)) score += 30;

      // Prefer more specific results over broad administrative areas.
      const category = photonCategory(properties);
      if (["business", "health", "address", "street"].includes(category)) {
        score += 10;
      }

      score -= distanceScore(
        coordinates.lat,
        coordinates.lng,
        near,
      ) * 2;

      const type = cleanText(properties.osm_value) ||
        cleanText(properties.type) ||
        category;

      return {
        id,
        name,
        details: address || type,
        address,
        type,
        category,
        score,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score);

  const results: PlaceResult[] = [];

  for (const item of ranked) {
    const key = `${item.name.toLowerCase()}|${item.address.toLowerCase()}`;

    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      id: item.id,
      name: item.name,
      details: item.details,
      address: item.address,
      type: item.type,
      category: item.category,
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

async function searchPhoton(
  query: string,
  near: Coordinate | null,
): Promise<PlaceResult[]> {
  const url = new URL(PHOTON_URL);

  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", RWANDA_BBOX);

  if (near) {
    url.searchParams.set("lat", String(near.lat));
    url.searchParams.set("lon", String(near.lng));
    url.searchParams.set("zoom", "13");
  }

  const data = await fetchJson(url.toString());
  const features = Array.isArray(data.features)
    ? data.features as PhotonFeature[]
    : [];

  return rankPhotonResults(features, query, near);
}

async function searchMapbox(
  query: string,
  near: Coordinate | null,
  session: string,
  token: string,
): Promise<PlaceResult[]> {
  const url = new URL(`${MAPBOX_URL}/suggest`);

  url.searchParams.set("q", query);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", session);
  url.searchParams.set("country", "RW");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", String(MAX_RESULTS));

  if (near) {
    url.searchParams.set(
      "proximity",
      `${near.lng},${near.lat}`,
    );
  }

  const data = await fetchJson(url.toString());
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions as Record<string, unknown>[]
    : [];

  return suggestions
    .map((item): PlaceResult | null => {
      const mapboxId = cleanText(item.mapbox_id);
      const name = cleanText(item.name);

      if (!mapboxId || !name) return null;

      const featureType = cleanText(item.feature_type) || "place";
      const address = cleanText(item.full_address) ||
        cleanText(item.place_formatted);

      return {
        id: `mapbox:${encodeURIComponent(mapboxId)}`,
        name,
        details: address || featureType,
        address,
        type: featureType,
        category: featureType,
      };
    })
    .filter((item): item is PlaceResult => item !== null)
    .slice(0, MAX_RESULTS);
}

async function retrievePhoton(
  id: string,
): Promise<Record<string, unknown> | null> {
  const encoded = id.slice("photon:".length);

  let payload: unknown;

  try {
    payload = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const query = cleanText(data.q);
  const osmType = cleanText(data.osm_type);
  const osmId = cleanText(data.osm_id);

  if (
    !query ||
    query.length > MAX_QUERY_LENGTH ||
    !osmType ||
    !osmId
  ) {
    return null;
  }

  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", RWANDA_BBOX);

  const response = await fetchJson(url.toString());

  const features = Array.isArray(response.features)
    ? response.features as PhotonFeature[]
    : [];

  const feature = features.find((item) => {
    const properties = item.properties ?? {};

    return (
      cleanText(properties.osm_type) === osmType &&
      String(properties.osm_id ?? "") === osmId
    );
  });

  if (!feature) return null;

  const coordinates = getPhotonCoordinates(feature);
  const properties = feature.properties ?? {};

  if (!coordinates) return null;

  const name = photonName(properties);
  if (!name) return null;

  return {
    success: true,
    provider: "photon",
    name,
    address: photonAddress(properties),
    type: cleanText(properties.osm_value) ||
      cleanText(properties.type),
    category: photonCategory(properties),
    lat: coordinates.lat,
    lng: coordinates.lng,
  };
}

async function retrieveMapbox(
  id: string,
  session: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  let mapboxId: string;

  try {
    mapboxId = decodeURIComponent(id.slice("mapbox:".length));
  } catch {
    return null;
  }

  if (!mapboxId || mapboxId.length > 500) return null;

  const url = new URL(
    `${MAPBOX_URL}/retrieve/${encodeURIComponent(mapboxId)}`,
  );

  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", session);

  const data = await fetchJson(url.toString());
  const features = Array.isArray(data.features)
    ? data.features as Record<string, unknown>[]
    : [];

  const feature = features[0];
  if (!feature) return null;

  const geometry = feature.geometry as
    | { coordinates?: unknown }
    | undefined;

  const coordinates = geometry?.coordinates;

  if (
    !Array.isArray(coordinates) ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number"
  ) {
    return null;
  }

  const lng = coordinates[0];
  const lat = coordinates[1];

  if (!isValidCoordinate(lat, lng)) return null;

  const properties = feature.properties as
    | Record<string, unknown>
    | undefined;

  const name = cleanText(properties?.name);

  if (!name) return null;

  return {
    success: true,
    provider: "mapbox",
    name,
    address: cleanText(properties?.full_address) ||
      cleanText(properties?.place_formatted),
    type: cleanText(properties?.feature_type),
    category: cleanText(properties?.feature_type),
    lat,
    lng,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: preflightHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed" },
      405,
    );
  }

  if (!await checkRateLimit(req, "search-places", 30, 60)) {
    return jsonResponse(
      {
        success: false,
        error: "Too many search requests. Please wait and try again.",
      },
      429,
    );
  }

  let body: Record<string, unknown>;

  try {
    const parsed: unknown = await req.json();

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid request body");
    }

    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(
      { success: false, error: "Invalid request body" },
      400,
    );
  }

  const action = cleanText(body.action);
  const session = cleanText(body.session);

  if (!/^[\w-]{10,64}$/.test(session)) {
    return jsonResponse(
      { success: false, error: "Invalid search session" },
      400,
    );
  }

  const mapboxToken = Deno.env.get("MAPBOX_TOKEN") ?? "";

  if (action === "reverse") {
    if (
      typeof body.lat !== "number" ||
      typeof body.lon !== "number" ||
      !isValidCoordinate(body.lat, body.lon)
    ) {
      return jsonResponse(
        { success: false, error: "Invalid reverse-geocoding coordinate" },
        400,
      );
    }

    try {
      const url = new URL(PHOTON_REVERSE_URL);
      url.searchParams.set("lat", String(body.lat));
      url.searchParams.set("lon", String(body.lon));
      url.searchParams.set("limit", "1");
      url.searchParams.set("lang", "en");

      const data = await fetchJson(url.toString());
      const features = Array.isArray(data.features)
        ? data.features as PhotonFeature[]
        : [];
      const feature = features[0];

      if (!feature) {
        return jsonResponse({
          success: true,
          place: {
            name: "Pinned location",
            address: "",
            type: "Pinned location",
            category: "manual_pin",
            lat: body.lat,
            lng: body.lon,
          },
          provider: "photon",
        });
      }

      const properties = feature.properties ?? {};
      const coordinates = getPhotonCoordinates(feature);
      if (!coordinates) throw new Error("Invalid reverse-geocoding response");

      return jsonResponse({
        success: true,
        place: {
          name: photonName(properties) || "Pinned location",
          address: photonAddress(properties),
          type: cleanText(properties.osm_value) ||
            cleanText(properties.type) ||
            "Pinned location",
          category: photonCategory(properties),
          lat: body.lat,
          lng: body.lon,
        },
        provider: "photon",
        attribution: "Place data © OpenStreetMap contributors",
      });
    } catch {
      return jsonResponse({
        success: true,
        place: {
          name: "Pinned location",
          address: "",
          type: "Pinned location",
          category: "manual_pin",
          lat: body.lat,
          lng: body.lon,
        },
        provider: "photon",
        notice: "Address lookup was unavailable. The selected coordinates were kept.",
      });
    }
  }

  if (action === "retrieve") {
    const id = cleanText(body.id);

    if (!id || id.length > 2000) {
      return jsonResponse(
        { success: false, error: "Invalid place selection" },
        400,
      );
    }

    try {
      let place: Record<string, unknown> | null = null;

      if (id.startsWith("photon:")) {
        place = await retrievePhoton(id);
      } else if (id.startsWith("mapbox:") && mapboxToken) {
        place = await retrieveMapbox(id, session, mapboxToken);
      }

      if (!place) {
        return jsonResponse(
          {
            success: false,
            error: "That place could not be retrieved. Please search again.",
          },
          404,
        );
      }

      const { success: _success, provider, ...placeDetails } = place;
      return jsonResponse({
        success: true,
        place: placeDetails,
        provider,
        attribution: "Place data © OpenStreetMap contributors",
      });
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "The place provider is temporarily unavailable.",
        },
        502,
      );
    }
  }

  if (action !== "suggest") {
    return jsonResponse(
      { success: false, error: "Unsupported search action" },
      400,
    );
  }

  const query = cleanText(body.q).replace(/\s+/g, " ");

  if (query.length < 2) {
    return jsonResponse(
      { success: true, results: [], provider: "photon" },
    );
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return jsonResponse(
      { success: false, error: "Search text is too long" },
      400,
    );
  }

  let near: Coordinate | null = null;

  if (body.lat !== undefined || body.lon !== undefined) {
    if (
      typeof body.lat === "number" &&
      typeof body.lon === "number" &&
      isValidCoordinate(body.lat, body.lon)
    ) {
      near = { lat: body.lat, lng: body.lon };
    }
  }

  let photonError = false;

  try {
    const photonResults = await searchPhoton(query, near);

    if (photonResults.length > 0) {
      return jsonResponse({
        success: true,
        results: photonResults,
        provider: "photon",
        attribution: "Place data © OpenStreetMap contributors",
      });
    }
  } catch {
    photonError = true;
  }

  // Mapbox is a fallback, not the primary provider.
  if (mapboxToken) {
    try {
      const mapboxResults = await searchMapbox(
        query,
        near,
        session,
        mapboxToken,
      );

      return jsonResponse({
        success: true,
        results: mapboxResults,
        provider: "mapbox",
        notice: photonError
          ? "Using the backup place-search provider."
          : undefined,
      });
    } catch {
      if (photonError) {
        return jsonResponse(
          {
            success: false,
            error: "Place search providers are temporarily unavailable. Please try again.",
          },
          502,
        );
      }
    }
  }

  if (photonError) {
    return jsonResponse(
      {
        success: false,
        error: "Place search is temporarily unavailable. Please try again.",
      },
      502,
    );
  }

  return jsonResponse({
    success: true,
    results: [],
    provider: "photon",
    notice: "No matching place was found. Try another spelling or choose the location on the map.",
    attribution: "Place data © OpenStreetMap contributors",
  });
});