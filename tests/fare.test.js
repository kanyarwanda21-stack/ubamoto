import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateFare,
  calculateFare,
  getFareBreakdown,
} from '../src/fare.js';

const cases = [
  [0.5, 589], [1, 589], [1.99, 589], [2, 589], [2.1, 670],
  [3, 850], [5, 1250], [8, 1850], [8.1, 1864], [10, 2130],
  [15, 2830], [20, 3530], [25, 4030], [30, 4530], [40, 5530],
];

for (const [distance, expected] of cases) {
  test(`official fare at ${distance} km`, () => {
    assert.equal(calculateFare(distance), expected);
  });
}

test('rejects zero, negative, invalid and over-limit distances', () => {
  for (const distance of [0, -1, Number.NaN, Infinity, 40.01]) {
    assert.throws(() => calculateFare(distance));
  }
});

test('short trip allocation guarantees a rider minimum', () => {
  assert.deepEqual(allocateFare(589), {
    customerFare: 589,
    riderPayout: 501,
    ubamotoCommission: 88,
  });
});

test('allocations always reconcile to the customer fare', () => {
  for (const [, fare] of cases) {
    const allocation = allocateFare(fare);
    assert.equal(
      allocation.riderPayout + allocation.ubamotoCommission,
      allocation.customerFare
    );
    assert.ok(allocation.riderPayout >= 500);
  }
});

test('fare breakdown reports the short-trip rule', () => {
  assert.equal(getFareBreakdown(1.5).shortTripApplied, true);
  assert.equal(getFareBreakdown(1.5).total, 589);
});
