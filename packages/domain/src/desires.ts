import { isCurrencyCode } from './currencies.js';
import { MAX_MINOR_UNITS, parseMinorUnitAmount } from './money.js';

export const desireClassifications = ['need', 'want', 'greed'] as const;
export type DesireClassification = (typeof desireClassifications)[number];

export const desireStatuses = [
  'considering',
  'waiting',
  'bought',
  'declined',
  'used_owned',
] as const;
export type DesireStatus = (typeof desireStatuses)[number];

export const desireEffectiveStates = [
  'considering',
  'waiting',
  'ready_for_review',
  'bought',
  'declined',
  'used_owned',
] as const;
export type DesireEffectiveState = (typeof desireEffectiveStates)[number];

export const desireMatchErrorCodes = [
  'MATCH_ALREADY_EXISTS',
  'MATCH_NOT_FOUND',
  'INVALID_MATCH_REASON',
  'INVALID_MATCH_RELEVANCE',
  'MATCH_LIMIT_EXCEEDED',
  'MATCHES_UNAVAILABLE',
] as const;
export type DesireMatchErrorCode = (typeof desireMatchErrorCodes)[number];

export const desireErrorCodes = [
  'INVALID_DESIRE',
  'INVALID_DESIRE_PRICE',
  'INVALID_DESIRE_URL',
  'INVALID_DESIRE_WAIT',
  'INVALID_DESIRE_TRANSITION',
  'DESIRE_NOT_FOUND',
  'STALE_DESIRE_REVISION',
  'INVALID_DESIRE_CURSOR',
  'DESIRE_PHOTO_NOT_FOUND',
  'DESIRE_PHOTO_LIMIT',
  'DESIRE_MEDIA_PENDING',
  'DESIRES_UNAVAILABLE',
  ...desireMatchErrorCodes,
] as const;
export type DesireErrorCode = (typeof desireErrorCodes)[number];

export const matchRelevanceValues = ['relevant', 'irrelevant'] as const;
export type MatchRelevance = (typeof matchRelevanceValues)[number];

export const matchSources = ['manual', 'suggested'] as const;
export type MatchSource = (typeof matchSources)[number];

export class DesireDomainError extends Error {
  constructor(public readonly code: DesireErrorCode) {
    super(code);
    this.name = 'DesireDomainError';
  }
}

export function isDesireDomainError(value: unknown): value is DesireDomainError {
  return value instanceof DesireDomainError;
}

export const failDesire = (code: DesireErrorCode): never => {
  throw new DesireDomainError(code);
};

export function isDesireClassification(value: unknown): value is DesireClassification {
  return typeof value === 'string' && (desireClassifications as readonly string[]).includes(value);
}

export function deriveDesireEffectiveState(
  status: DesireStatus,
  reviewAt: Date | string | null,
  now: Date = new Date(),
): DesireEffectiveState {
  if (status === 'waiting') {
    if (!reviewAt) return 'considering';
    const review = typeof reviewAt === 'string' ? new Date(reviewAt) : reviewAt;
    if (!Number.isFinite(review.getTime())) return 'considering';
    return review.getTime() <= now.getTime() ? 'ready_for_review' : 'waiting';
  }
  return status;
}

export function validateProductUrl(url: string | null | undefined): string | null {
  if (url === undefined || url === null) return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;
  if (trimmed.length > 2048) throw new DesireDomainError('INVALID_DESIRE_URL');
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DesireDomainError('INVALID_DESIRE_URL');
    }
    return trimmed;
  } catch {
    throw new DesireDomainError('INVALID_DESIRE_URL');
  }
}

export function validateLikelyPrice(
  amountMinor: string | null | undefined,
  currency: string | null | undefined,
): { minor: bigint | null; currency: string | null } {
  const hasAmount = amountMinor !== undefined && amountMinor !== null;
  const hasCurrency = currency !== undefined && currency !== null && currency !== '';
  if (!hasAmount && !hasCurrency) {
    return { minor: null, currency: null };
  }
  if (!hasAmount || !hasCurrency || !currency || !isCurrencyCode(currency)) {
    throw new DesireDomainError('INVALID_DESIRE_PRICE');
  }
  try {
    const minor = parseMinorUnitAmount(amountMinor);
    if (minor < 0n || minor > MAX_MINOR_UNITS) {
      throw new DesireDomainError('INVALID_DESIRE_PRICE');
    }
    return { minor, currency };
  } catch {
    throw new DesireDomainError('INVALID_DESIRE_PRICE');
  }
}

export interface WaitingTransitionInput {
  reviewAt: string;
  startedAt?: string;
}

export function transitionDesireWaiting(
  current: {
    status: DesireStatus;
    waitingStartedAt: Date | string | null;
    reviewAt: Date | string | null;
  },
  input: WaitingTransitionInput | null | undefined,
  now: Date = new Date(),
): {
  status: DesireStatus;
  waitingStartedAt: Date | null;
  reviewAt: Date | null;
} {
  if (input === undefined) {
    return {
      status: current.status,
      waitingStartedAt: current.waitingStartedAt ? new Date(current.waitingStartedAt) : null,
      reviewAt: current.reviewAt ? new Date(current.reviewAt) : null,
    };
  }
  if (input === null) {
    return {
      status: 'considering',
      waitingStartedAt: null,
      reviewAt: null,
    };
  }
  if (!input.reviewAt || typeof input.reviewAt !== 'string') {
    failDesire('INVALID_DESIRE_WAIT');
  }
  const review = new Date(input.reviewAt);
  if (!Number.isFinite(review.getTime())) {
    failDesire('INVALID_DESIRE_WAIT');
  }
  if (review.getTime() <= now.getTime()) {
    failDesire('INVALID_DESIRE_WAIT');
  }

  let started: Date;
  if (input.startedAt) {
    if (typeof input.startedAt !== 'string') failDesire('INVALID_DESIRE_WAIT');
    started = new Date(input.startedAt);
    if (!Number.isFinite(started.getTime())) failDesire('INVALID_DESIRE_WAIT');
  } else if (current.status === 'waiting' && current.waitingStartedAt) {
    started = new Date(current.waitingStartedAt);
    if (!Number.isFinite(started.getTime())) started = now;
  } else {
    started = now;
  }

  if (review.getTime() <= started.getTime()) {
    failDesire('INVALID_DESIRE_WAIT');
  }

  return {
    status: 'waiting',
    waitingStartedAt: started,
    reviewAt: review,
  };
}

export function validateMatchReason(reason?: string | null): string {
  if (reason === undefined || reason === null) {
    return 'Manually selected as a potential alternative';
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return 'Manually selected as a potential alternative';
  }
  if (trimmed.length > 1000) {
    throw new DesireDomainError('INVALID_MATCH_REASON');
  }
  return trimmed;
}

export function validateMatchRelevance(relevance?: string | null): MatchRelevance {
  if (relevance === undefined || relevance === null || relevance === '') {
    return 'relevant';
  }
  if (relevance !== 'relevant' && relevance !== 'irrelevant') {
    throw new DesireDomainError('INVALID_MATCH_RELEVANCE');
  }
  return relevance;
}

export function isUsableAlternative(ownershipStatus: string | null | undefined): boolean {
  return ownershipStatus === 'owned';
}

export function deriveMatchHints(item: {
  categoryName?: string | null;
  subcategoryName?: string | null;
  condition?: string | null;
  useFrequency?: string | null;
  tags?: string[] | null;
}): {
  categoryHint: string | null;
  usageHint: string | null;
  conditionHint: string | null;
  traitHints: string[];
} {
  const categoryHint = item.categoryName
    ? item.subcategoryName
      ? `Category: ${item.categoryName} > ${item.subcategoryName}`
      : `Category: ${item.categoryName}`
    : null;

  const conditionHint =
    item.condition && item.condition !== 'unknown'
      ? `Condition: ${item.condition.replace(/_/g, ' ')}`
      : null;

  const usageHint =
    item.useFrequency && item.useFrequency !== 'unknown' ? `Frequency: ${item.useFrequency}` : null;

  const traitHints = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];

  return {
    categoryHint,
    usageHint,
    conditionHint,
    traitHints,
  };
}

export function deriveSuggestedReason(item: {
  name: string;
  categoryName?: string | null;
}): string {
  if (item.categoryName) {
    return `Selected from ${item.categoryName} as a potential alternative possession.`;
  }
  return `Selected as a potential alternative possession.`;
}
