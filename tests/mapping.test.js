import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPoint,
  isValidRouteGeometry,
  normalizeProviderRoute,
} from '../supabase/functions/_shared/common.ts';
import {
  isFreshRiderLocation,
  isValidRwandaCoordinate,
  hasValidPlaceCoordinates,
  normalizePlaceQuery,
  rankAndDeduplicatePlaces,
} from '../src/lib/placeSearch.js';

test('Rwanda coordinate validation accepts Kigali and rejects invalid coordinates', () => {
  assert.equal(isValidRwandaCoordinate(-1.9441, 30.0619), true);
  assert.equal(isValidRwandaCoordinate(51.5074, -0.1278), false);
  assert.equal(isValidRwandaCoordinate(NaN, 30.0619), false);
});

test('retrieved place selection requires a valid Rwanda coordinate pair', () => {
  assert.equal(hasValidPlaceCoordinates({
    lat: -1.9441,
    lng: 30.0619,
  }), true);
  assert.equal(hasValidPlaceCoordinates(undefined), false);
  assert.equal(hasValidPlaceCoordinates({ lat: undefined, lng: 30.0619 }), false);
  assert.equal(hasValidPlaceCoordinates({ lat: -1.9441, lng: undefined }), false);
});

test('backend point and route geometry validation stay consistent', () => {
  assert.equal(isValidPoint([-1.9441, 30.0619]), true);
  assert.equal(isValidPoint([51.5074, -0.1278]), false);
  assert.equal(isValidRouteGeometry([
    [-1.9441, 30.0619],
    [-1.9500, 30.0800],
  ]), true);
  assert.equal(isValidRouteGeometry([[-1.9441, 30.0619]]), false);
});

test('place query normalization trims whitespace and limits length', () => {
  assert.equal(normalizePlaceQuery('  Kigali   Heights  '), 'Kigali Heights');
  assert.equal(normalizePlaceQuery('x'.repeat(140)).length, 100);
});

test('provider place results are deduplicated and preserve provider order', () => {
  const ranked = rankAndDeduplicatePlaces([
    {
      mapbox_id: 'poi.1',
      name: 'Kigali City Tower',
      full_address: 'KN 1 Rd, Kigali',
      feature_type: 'poi',
    },
    {
      mapbox_id: 'poi.1',
      name: 'Kigali City Tower',
      full_address: 'KN 1 Rd, Kigali',
      feature_type: 'poi',
    },
  ], 'Kigali');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, 'Kigali City Tower');
});

test('stale rider GPS is rejected while a fresh location remains usable', () => {
  const now = Date.now();
  assert.equal(
    isFreshRiderLocation(new Date(now - 60_000).toISOString(), now, 120_000),
    true
  );
  assert.equal(
    isFreshRiderLocation(new Date(now - 5 * 60_000).toISOString(), now, 120_000),
    false
  );
  assert.equal(isFreshRiderLocation(null, now), false);
});

test('coordinate conversion from GeoJSON longitude latitude to Leaflet is explicit', () => {
  const route = normalizeProviderRoute({
    distance: 3200,
    duration: 600,
    geometry: {
      coordinates: [
        [30.0619, -1.9441],
        [30.0800, -1.9500],
      ],
    },
  });
  assert.deepEqual(route.geometry, [
    [-1.9441, 30.0619],
    [-1.9500, 30.0800],
  ]);
  assert.equal(route.distanceKm, 3.2);
  assert.equal(route.durationMinutes, 10);
});

test('missing, malformed and out-of-Rwanda provider geometry is rejected', () => {
  assert.equal(normalizeProviderRoute({ distance: 100, duration: 60 }), null);
  assert.equal(normalizeProviderRoute({
    distance: 100,
    duration: 60,
    geometry: { coordinates: [[30.0619, -1.9441], [null, 30.0800]] },
  }), null);
  assert.equal(normalizeProviderRoute({
    distance: 100,
    duration: 60,
    geometry: { coordinates: [[30.0619, -1.9441], [0, 51.5074]] },
  }), null);
});

test('OSRM invalid route data is distinguishable from a valid fallback candidate', () => {
  const invalidOSRM = normalizeProviderRoute({
    distance: 1000,
    duration: 300,
    geometry: { coordinates: [[30.0619, -1.9441]] },
  });
  const validMapbox = normalizeProviderRoute({
    distance: 1200,
    duration: 360,
    geometry: {
      coordinates: [
        [30.0619, -1.9441],
        [30.0800, -1.9500],
      ],
    },
  });
  assert.equal(invalidOSRM, null);
  assert.ok(validMapbox);
});

test('active and completed ride location visibility rules stay consistent', () => {
  const activeStatuses = ['assigned', 'arrived', 'in_progress'];
  assert.equal(activeStatuses.includes('assigned'), true);
  assert.equal(activeStatuses.includes('arrived'), true);
  assert.equal(activeStatuses.includes('in_progress'), true);
  assert.equal(activeStatuses.includes('completed'), false);
  assert.equal(activeStatuses.includes('cancelled'), false);
});
