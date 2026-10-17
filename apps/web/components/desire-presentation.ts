import type { DesireClassification, DesireEffectiveState } from '@havefolio/contracts';
import { formatMoney, parseMinorUnits } from '@havefolio/domain';
import { classificationInfo, effectiveStateInfo } from './desires-client';

export function formatLikelyPrice(
  likelyPriceMinor: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (likelyPriceMinor == null || !currency) {
    return 'Price not added';
  }
  try {
    const money = parseMinorUnits(likelyPriceMinor, currency);
    return formatMoney(money);
  } catch {
    return 'Price not added';
  }
}

export function formatReviewDateTime(
  dateString: string | null | undefined,
  locale = 'en-IN',
): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatReviewDateOnly(
  dateString: string | null | undefined,
  locale = 'en-IN',
): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
  }).format(date);
}

export function validateProductUrlString(
  url: string,
): { ok: true; clean: string } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: true, clean: '' };
  if (trimmed.length > 2048) {
    return { ok: false, error: 'Web link must be at most 2048 characters.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Web link must begin with http:// or https://' };
    }
    return { ok: true, clean: trimmed };
  } catch {
    return { ok: false, error: 'Enter a valid web link starting with http:// or https://' };
  }
}

export function getClassificationLabel(
  classification: DesireClassification | null | undefined,
): string {
  if (!classification) return 'Not classified';
  return classificationInfo[classification]?.label ?? classification;
}

export function getClassificationExplanation(
  classification: DesireClassification | null | undefined,
): string {
  if (!classification) return 'Skip this for now.';
  return classificationInfo[classification]?.explanation ?? '';
}

export function getEffectiveStateLabel(state: DesireEffectiveState): string {
  return effectiveStateInfo[state]?.label ?? state;
}

export function getEffectiveStateDescription(state: DesireEffectiveState): string {
  return effectiveStateInfo[state]?.description ?? '';
}
