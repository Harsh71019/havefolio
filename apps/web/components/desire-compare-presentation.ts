import type {
  DesireMatch,
  DesireMatchHints,
  ItemCondition,
  ItemCoverSummary,
  ItemFrequency,
  ItemResponse,
  ReviewOutcome,
} from '@havefolio/contracts';
import { acquiredFact, priceFact } from './item-presentation';
import { conditionLabels } from './item-detail-presentation';

export const NEUTRAL_COMPARISON_GUIDANCE =
  'Owning something in the same category does not mean this purchase is unnecessary. Consider how they differ in function, comfort, or frequency of use.';

export const DIFFERENTIATION_PROMPT = 'What would this product do differently?';

export const DIFFERENTIATION_HINT =
  'Reflect on how this desired item differs from what you already own. Your reflection will be saved as a private note with your decision.';

export type DecisionActionType = 'use_owned' | 'repair' | 'replace' | 'wait' | 'buy' | 'pass';

export interface DecisionActionOption {
  type: DecisionActionType;
  label: string;
  description: string;
  outcome: ReviewOutcome;
}

export const decisionActions: DecisionActionOption[] = [
  {
    type: 'use_owned',
    label: 'Use something already owned',
    description: 'Use a possession you already have to serve this purpose instead of buying new.',
    outcome: 'used_owned',
  },
  {
    type: 'repair',
    label: 'Repair an owned item',
    description: 'Fix an existing possession and keep using it instead of purchasing new.',
    outcome: 'used_owned',
  },
  {
    type: 'replace',
    label: 'Replace an owned item',
    description: 'Buy this product intentionally to replace an existing possession.',
    outcome: 'bought',
  },
  {
    type: 'wait',
    label: 'Wait and choose another review date',
    description: 'Extend your reflection period and receive a reminder on a future date.',
    outcome: 'delayed',
  },
  {
    type: 'buy',
    label: 'Buy intentionally',
    description: 'Proceed with this purchase after thoughtful comparison.',
    outcome: 'bought',
  },
  {
    type: 'pass',
    label: 'Pass on this purchase',
    description:
      'Decline this purchase. The estimated amount not spent is recorded in decision history.',
    outcome: 'declined',
  },
];

export interface FormattedMatchedItem {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  priceText: string;
  isPriceUnknown: boolean;
  acquiredText: string;
  isDateUnknown: boolean;
  conditionLabel: string;
  isConditionNeedsRepair: boolean;
  isConditionBroken: boolean;
  isConditionWornOut: boolean;
  usageLabel: string;
  isUsableAlternative: boolean;
  isUnavailable: boolean;
  cover: ItemCoverSummary | null;
  relevance: 'relevant' | 'irrelevant';
  reason: string;
  categoryHint: string | null;
  usageHint: string | null;
  conditionHint: string | null;
  traitHints: string[];
}

export function formatMatchedItem(
  match: DesireMatch,
  fullItem: ItemResponse | null,
): FormattedMatchedItem {
  const item = match.item;
  const isUnavailable =
    fullItem != null ? fullItem.ownershipStatus !== 'owned' : item.ownershipStatus !== 'owned';

  // Price fact
  let priceText = 'Price not recorded';
  let isPriceUnknown = true;
  if (fullItem) {
    const fact = priceFact(fullItem);
    priceText = fact.value;
    isPriceUnknown = fact.muted ?? false;
  }

  // Acquired date fact - never invents exact purchase age from month-only, year-only, or unknown dates
  let acquiredText = 'Date not recorded';
  let isDateUnknown = true;
  if (fullItem?.purchaseDate) {
    const fact = acquiredFact(fullItem.purchaseDate);
    acquiredText = fact.value;
    isDateUnknown = fact.muted ?? false;
  }

  // Condition
  const cond: ItemCondition = fullItem?.condition ?? item.condition;
  const conditionLabel = conditionLabels[cond] ?? 'Condition not recorded';
  const isConditionNeedsRepair = cond === 'needs_repair';
  const isConditionBroken = cond === 'broken';
  const isConditionWornOut = cond === 'worn_out';

  // Usage
  const frequencyDisplayLabels: Record<ItemFrequency, string> = {
    often: 'Often',
    sometimes: 'Sometimes',
    rarely: 'Rarely',
    never: 'Not used',
    unknown: 'Not recorded',
  };
  const freq: ItemFrequency = fullItem?.useFrequency ?? item.useFrequency;
  const usageLabel = frequencyDisplayLabels[freq] ?? 'Not recorded';

  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    model: item.model,
    priceText,
    isPriceUnknown,
    acquiredText,
    isDateUnknown,
    conditionLabel,
    isConditionNeedsRepair,
    isConditionBroken,
    isConditionWornOut,
    usageLabel,
    isUsableAlternative: item.isUsableAlternative && !isUnavailable && !isConditionWornOut,
    isUnavailable,
    cover: item.cover,
    relevance: match.relevance,
    reason: match.reason,
    categoryHint: match.hints.categoryHint,
    usageHint: match.hints.usageHint,
    conditionHint: match.hints.conditionHint,
    traitHints: match.hints.traitHints,
  };
}

export function summarizeHints(hints: DesireMatchHints): string[] {
  const list: string[] = [];
  if (hints.categoryHint) list.push(hints.categoryHint);
  if (hints.usageHint) list.push(hints.usageHint);
  if (hints.conditionHint) list.push(hints.conditionHint);
  if (hints.traitHints.length > 0) list.push(hints.traitHints.join(', '));
  return list;
}
