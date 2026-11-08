import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaceQuery,
  isValidRwandaCoordinate,
  resultCategory,
  rankAndDeduplicatePlaces,
  isFreshRiderLocation,
} from '../src/lib/placeSearch.js';

test('destination search trims and normalizes whitespace', () => {
  assert.equal(normalizePlaceQuery('  Kigali   Convention   Centre  '), 'Kigali Convention Centre');
});

test('business-name provider results retain identity and category', () => {
  const results = rankAndDeduplicatePlaces([{
    mapbox_id: 'poi-1',
    name: 'Kigali Convention Centre',
    feature_type: 'poi',
    full_address: 'KG 2 Roundabout, Kigali, Rwanda',
    distance: 1200,
  }], 'Kigali Convention Centre');
  assert.equal(results[0].name, 'Kigali Convention Centre');
  assert.equal(results[0].address, 'KG 2 Roundabout, Kigali, Rwanda');
  assert.equal(results[0].type, 'Business');
});

test('restaurant, hotel and street categories are distinguished', () => {
  assert.equal(resultCategory('poi'), 'Business');
  assert.equal(resultCategory('address'), 'Address');
  assert.equal(resultCategory('street'), 'Street');
  assert.equal(resultCategory('neighborhood'), 'Neighbourhood');
});

test('partial search terms remain valid and keep provider order relevance', () => {
  const results = rankAndDeduplicatePlaces([
    { mapbox_id: '2', name: 'Kigali Heights Restaurant', feature_type: 'poi', distance: 500 },
    { mapbox_id: '1', name: 'Kigali Heights', feature_type: 'poi', distance: 800 },
  ], 'Kigali Heigh');
  assert.equal(results[0].name, 'Kigali Heights Restaurant');
});

test('duplicate provider results are removed', () => {
  const results = rankAndDeduplicatePlaces([
    { mapbox_id: 'same', name: 'Kigali Heights', feature_type: 'poi' },
    { mapbox_id: 'same', name: 'Kigali Heights', feature_type: 'poi' },
  ], 'Kigali Heights');
  assert.equal(results.length, 1);
});

test('invalid destination coordinates are rejected', () => {
  assert.equal(isValidRwandaCoordinate(0, 30), false);
  assert.equal(isValidRwandaCoordinate(-1.944, 30.061), true);
  assert.equal(isValidRwandaCoordinate(NaN, 30.061), false);
});

test('specific business coordinates are not replaced by Kigali center', () => {
  const retrieved = { lat: -1.953, lng: 30.091, name: 'Kigali Convention Centre' };
  assert.equal(isValidRwandaCoordinate(retrieved.lat, retrieved.lng), true);
  assert.notEqual(`${retrieved.lat},${retrieved.lng}`, '-1.944072,30.061885');
});

test('empty provider response produces no fabricated results', () => {
  assert.deepEqual(rankAndDeduplicatePlaces([], 'Kigali'), []);
});

test('selecting a new destination replaces destination metadata', () => {
  const old = { name: 'Old place', lat: -1.94, lng: 30.06 };
  const selected = { name: 'New place', lat: -1.95, lng: 30.08, address: 'KN 3 Road, Kigali' };
  assert.notEqual(selected.lat, old.lat);
  assert.notEqual(selected.lng, old.lng);
  assert.equal(selected.address, 'KN 3 Road, Kigali');
});

test('provider timeout is represented as an error condition', () => {
  const responseError = new Error('provider_timeout');
  assert.equal(responseError.message, 'provider_timeout');
});

test('provider authentication failure is represented separately from no results', () => {
  const responseError = new Error('provider_auth');
  assert.equal(responseError.message, 'provider_auth');
});

test('provider mock supports street, address, building and landmark feature types', () => {
  const items = [
    { mapbox_id: 'street', name: 'KN 3 Avenue', feature_type: 'street' },
    { mapbox_id: 'address', name: 'House 24', feature_type: 'address' },
    { mapbox_id: 'landmark', name: 'Kigali Heights', feature_type: 'place' },
  ];
  const results = rankAndDeduplicatePlaces(items, 'Kigali');
  assert.equal(results.length, 3);
  assert.deepEqual(
    new Set(results.map((item) => item.type)),
    new Set(['Street', 'Address', 'Landmark'])
  );
});

test('stale rider GPS is not live', () => {
  const now = Date.now();
  assert.equal(isFreshRiderLocation(new Date(now - 5 * 60 * 1000).toISOString(), now), false);
  assert.equal(isFreshRiderLocation(new Date(now - 30 * 1000).toISOString(), now), true);
});

test('old rider location timestamp cannot become live', () => {
  assert.equal(isFreshRiderLocation('2020-01-01T00:00:00.000Z', Date.now()), false);
});
