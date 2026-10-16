import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryBudget } from '../dist/budget.js';

test('continuous budgets constrain bursts, refill without minute-boundary doubling and cap idle credit', () => {
  let now = 0;
  const budget = new TelemetryBudget(20, 20, () => now);
  for (let i = 0; i < 20; i++) assert.equal(budget.take(), true);
  assert.equal(budget.take(), false);
  now = 2999;
  assert.equal(budget.take(), false);
  now = 3000;
  assert.equal(budget.take(), true);
  now = 60000;
  for (let i = 0; i < 19; i++) assert.equal(budget.take(), true);
  assert.equal(budget.take(), false);
  now = 60001;
  assert.equal(budget.take(), false);
  now = 3600000;
  assert.equal(budget.take(20), true);
  assert.equal(budget.take(), false);
});

test('invalid charges and a clock moving backwards cannot create credit', () => {
  let now = 5000;
  const budget = new TelemetryBudget(4096, 4096, () => now);
  for (const n of [NaN, Infinity, -1, 0]) assert.equal(budget.take(n), false);
  assert.equal(budget.take(4096), true);
  now = 1000;
  assert.equal(budget.take(), false);
  now = 5000;
  assert.equal(budget.take(), false);
});
