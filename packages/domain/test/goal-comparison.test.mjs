import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimatedGoalPercentage, money, MAX_MINOR_UNITS } from '../dist/index.js';
test('hypothetical goal comparison keeps exact money and never invents unknown percentages', () => {
  assert.equal(estimatedGoalPercentage(money(800000n, 'INR'), money(4000000n, 'INR')), '20');
  assert.equal(estimatedGoalPercentage(null, money(4000000n, 'INR')), null);
  assert.equal(estimatedGoalPercentage(money(0n, 'INR'), money(0n, 'INR')), null);
  assert.equal(estimatedGoalPercentage(money(800000n, 'USD'), money(4000000n, 'INR')), null);
  assert.equal(estimatedGoalPercentage(money(0n, 'INR'), money(1n, 'INR')), '0');
  assert.equal(estimatedGoalPercentage(money(1n, 'INR'), money(3n, 'INR')), '33.33');
  assert.equal(
    estimatedGoalPercentage(money(MAX_MINOR_UNITS, 'INR'), money(1n, 'INR')),
    '922337203685477580700',
  );
});
