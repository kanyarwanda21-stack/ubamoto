import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FARE_POLICY_VERSION,
  MAX_TRIP_KM,
  allocateFare,
  fareForKm,
  normalizePhone,
} from '../supabase/functions/_shared/common.ts';

const cases = [
  [0.5, 589], [1, 589], [1.99, 589], [2, 589], [2.1, 670],
  [3, 850], [5, 1250], [8, 1850], [8.1, 1864], [10, 2130],
  [15, 2830], [20, 3530], [25, 4030], [30, 4530], [40, 5530],
];

test('backend fare boundary values are exact', () => {
  assert.equal(fareForKm(1.999), 589);
  assert.equal(fareForKm(2.001), 651);
  assert.equal(fareForKm(7.999), 1850);
  assert.equal(fareForKm(8.001), 1851);
  assert.equal(fareForKm(19.999), 3530);
  assert.equal(fareForKm(20.001), 3531);
  assert.equal(fareForKm(39.999), 5530);
});

test('backend fare policy has the expected version and limit', () => {
  assert.equal(FARE_POLICY_VERSION, 'ubamoto-fare-2026-11-01');
  assert.equal(MAX_TRIP_KM, 40);
});

for (const [distance, expected] of cases) {
  test(`backend fare at ${distance} km`, () => {
    assert.equal(fareForKm(distance), expected);
  });
}

test('backend fare rejects invalid and over-limit distances', () => {
  for (const distance of [0, -1, Number.NaN, Infinity, 40.01]) {
    assert.throws(() => fareForKm(distance));
  }
});

test('backend allocations reconcile and preserve the rider minimum', () => {
  for (const [, fare] of cases) {
    const allocation = allocateFare(fare);
    assert.equal(
      allocation.riderPayout + allocation.ubamotoCommission,
      allocation.customerFare
    );
    assert.ok(allocation.riderPayout >= 500);
  }
  assert.deepEqual(allocateFare(589), {
    customerFare: 589,
    riderPayout: 501,
    ubamotoCommission: 88,
  });
});

test('backend fare and allocation reject invalid inputs', () => {
  assert.throws(() => allocateFare(0));
  assert.throws(() => allocateFare(589.5));
  assert.throws(() => allocateFare(Number.NaN));
});

test('backend phone normalization accepts supported Rwandan formats', () => {
  assert.equal(normalizePhone('0788123456'), '+250788123456');
  assert.equal(normalizePhone('+250 788 123 456'), '+250788123456');
  assert.equal(normalizePhone('0738123456'), '+250738123456');
  assert.equal(normalizePhone('0728123456'), '+250728123456');
  assert.equal(normalizePhone('0798123456'), '+250798123456');
  assert.equal(normalizePhone('invalid'), null);
});
