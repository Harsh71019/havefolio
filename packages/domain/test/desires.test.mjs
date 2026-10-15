import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveDesireEffectiveState,
  isDesireClassification,
  validateLikelyPrice,
  validateProductUrl,
  transitionDesireWaiting,
  DesireDomainError,
} from '../dist/index.js';

test('classification validation allows only need, want, greed', () => {
  assert.equal(isDesireClassification('need'), true);
  assert.equal(isDesireClassification('want'), true);
  assert.equal(isDesireClassification('greed'), true);
  assert.equal(isDesireClassification('other'), false);
  assert.equal(isDesireClassification(null), false);
  assert.equal(isDesireClassification(undefined), false);
  assert.equal(isDesireClassification(''), false);
});

test('likely price validation preserves unknown vs explicit zero', () => {
  // Unknown price
  assert.deepEqual(validateLikelyPrice(null, null), { minor: null, currency: null });
  assert.deepEqual(validateLikelyPrice(undefined, undefined), { minor: null, currency: null });

  // Explicit zero
  assert.deepEqual(validateLikelyPrice('0', 'INR'), { minor: 0n, currency: 'INR' });

  // Normal positive minor units
  assert.deepEqual(validateLikelyPrice('149900', 'INR'), { minor: 149900n, currency: 'INR' });
  assert.deepEqual(validateLikelyPrice('9999', 'USD'), { minor: 9999n, currency: 'USD' });

  // Maximum minor units
  const max = '9223372036854775807';
  assert.deepEqual(validateLikelyPrice(max, 'EUR'), { minor: 9223372036854775807n, currency: 'EUR' });
});

test('likely price validation rejects pair mismatches and invalid values', () => {
  // Amount without currency
  assert.throws(() => validateLikelyPrice('1000', null), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
  assert.throws(() => validateLikelyPrice('1000', undefined), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');

  // Currency without amount
  assert.throws(() => validateLikelyPrice(null, 'INR'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
  assert.throws(() => validateLikelyPrice(undefined, 'USD'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');

  // Unsupported or invalid currency
  assert.throws(() => validateLikelyPrice('1000', 'XYZ'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
  assert.throws(() => validateLikelyPrice('1000', 'inr'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');

  // Negative amount or invalid decimal
  assert.throws(() => validateLikelyPrice('-100', 'INR'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
  assert.throws(() => validateLikelyPrice('12.50', 'INR'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
  assert.throws(() => validateLikelyPrice('abc', 'INR'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_PRICE');
});

test('product URL validation accepts valid HTTP/HTTPS and rejects unsafe schemes', () => {
  assert.equal(validateProductUrl(null), null);
  assert.equal(validateProductUrl(undefined), null);
  assert.equal(validateProductUrl('   '), null);
  assert.equal(validateProductUrl('https://example.com/item/123'), 'https://example.com/item/123');
  assert.equal(validateProductUrl('http://shop.test/p?q=keyboard'), 'http://shop.test/p?q=keyboard');

  // Unsafe schemes
  assert.throws(() => validateProductUrl('javascript:alert(1)'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_URL');
  assert.throws(() => validateProductUrl('data:text/html,<script>'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_URL');
  assert.throws(() => validateProductUrl('file:///etc/passwd'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_URL');
  assert.throws(() => validateProductUrl('ftp://ftp.example.com'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_URL');
  assert.throws(() => validateProductUrl('not-a-url'), (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_URL');
});

test('derived effective state computes considering, waiting, and ready_for_review deterministically', () => {
  const t0 = new Date('2026-10-16T10:00:00.000Z');
  const tReview = new Date('2026-10-16T12:00:00.000Z');

  // Considering state is always considering
  assert.equal(deriveDesireEffectiveState('considering', null, t0), 'considering');
  assert.equal(deriveDesireEffectiveState('considering', tReview, t0), 'considering');

  // Waiting before review time is waiting
  const beforeReview = new Date('2026-10-16T11:00:00.000Z');
  assert.equal(deriveDesireEffectiveState('waiting', tReview, beforeReview), 'waiting');

  // Waiting at exactly review time is ready_for_review
  assert.equal(deriveDesireEffectiveState('waiting', tReview, tReview), 'ready_for_review');

  // Waiting after review time is ready_for_review
  const afterReview = new Date('2026-10-16T13:00:00.000Z');
  assert.equal(deriveDesireEffectiveState('waiting', tReview, afterReview), 'ready_for_review');
});

test('waiting-period transitions cover start, revise, cancel and invalid configurations', () => {
  const t0 = new Date('2026-10-16T10:00:00.000Z');
  const initial = {
    status: 'considering',
    waitingStartedAt: null,
    reviewAt: null,
  };

  // Undefined input leaves waiting state unchanged
  const unchanged = transitionDesireWaiting(initial, undefined, t0);
  assert.deepEqual(unchanged, { status: 'considering', waitingStartedAt: null, reviewAt: null });

  // Starting wait from considering
  const future1 = '2026-10-23T10:00:00.000Z';
  const started = transitionDesireWaiting(initial, { reviewAt: future1 }, t0);
  assert.equal(started.status, 'waiting');
  assert.equal(started.waitingStartedAt.toISOString(), t0.toISOString());
  assert.equal(started.reviewAt.toISOString(), future1);

  // Revising waiting date preserves original startedAt
  const tLater = new Date('2026-10-18T10:00:00.000Z');
  const future2 = '2026-10-30T10:00:00.000Z';
  const revised = transitionDesireWaiting(started, { reviewAt: future2 }, tLater);
  assert.equal(revised.status, 'waiting');
  assert.equal(revised.waitingStartedAt.toISOString(), t0.toISOString());
  assert.equal(revised.reviewAt.toISOString(), future2);

  // Cancelling wait resets to considering
  const cancelled = transitionDesireWaiting(revised, null, tLater);
  assert.deepEqual(cancelled, { status: 'considering', waitingStartedAt: null, reviewAt: null });

  // Past reviewAt rejected
  assert.throws(
    () => transitionDesireWaiting(initial, { reviewAt: '2026-10-15T10:00:00.000Z' }, t0),
    (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_WAIT',
  );

  // reviewAt <= startedAt rejected
  assert.throws(
    () => transitionDesireWaiting(initial, { reviewAt: '2026-10-20T10:00:00.000Z', startedAt: '2026-10-21T10:00:00.000Z' }, t0),
    (err) => err instanceof DesireDomainError && err.code === 'INVALID_DESIRE_WAIT',
  );
});
