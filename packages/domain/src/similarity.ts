export const suggestionFeedbackTypes = ['dismissed', 'irrelevant', 'relevant'] as const;
export type SuggestionFeedbackType = (typeof suggestionFeedbackTypes)[number];

export const suggestionFeedbackScopes = ['desire', 'global'] as const;
export type SuggestionFeedbackScope = (typeof suggestionFeedbackScopes)[number];

export const suggestionFactorKinds = [
  'subcategory_match',
  'category_match',
  'purpose_match',
  'name_match',
  'brand_match',
  'model_match',
  'tag_match',
  'trait_match',
  'rarely_used_working',
  'condition_penalty',
  'relevance_feedback',
] as const;
export type SuggestionFactorKind = (typeof suggestionFactorKinds)[number];

export interface SuggestionFactor {
  kind: SuggestionFactorKind;
  score: number;
  label: string;
  detail: string;
}

export interface SuggestionCandidateItem {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  notes?: string | null;
  specifications?: Record<string, unknown> | null;
  condition?: string | null;
  useFrequency?: string | null;
  ownershipStatus: string;
  categoryId?: string | null;
  categoryName?: string | null;
  subcategoryId?: string | null;
  subcategoryName?: string | null;
  tags?: string[] | null;
  createdAt: string | Date;
  isAlreadyMatched?: boolean;
}

export interface SuggestionDesire {
  id: string;
  name: string;
  reason?: string | null;
  classification?: string | null;
}

export interface SuggestionFeedbackRecord {
  id?: string;
  feedbackType: SuggestionFeedbackType;
  scope: SuggestionFeedbackScope;
  reason?: string | null;
}

export interface SuggestionScoringResult {
  score: number;
  eligible: boolean;
  ineligibilityReason?: string;
  explanation: string;
  factors: SuggestionFactor[];
  workingRarelyUsed: boolean;
  conditionContext: string | null;
  isUsableAlternative: boolean;
}

const STOP_WORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

/**
 * Tokenize a string into lower-cased alphanumeric words, filtering out common stop words.
 */
export function tokenizeText(text: string | null | undefined): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().normalize('NFKC');
  const rawWords = normalized.split(/[^a-z0-9_-]+/);
  const result: string[] = [];
  for (const raw of rawWords) {
    const word = raw.replace(/^[-_]+|[-_]+$/g, '');
    if (word.length >= 2 && !STOP_WORDS.has(word)) {
      result.push(word);
    }
  }
  return result;
}

/**
 * Check if candidate string occurs within target tokens or substring.
 */
function textMatchesTokens(candidate: string | null | undefined, tokens: Set<string>, targetText: string): boolean {
  if (!candidate) return false;
  const candidateLower = candidate.toLowerCase().trim();
  if (candidateLower.length === 0) return false;

  // Direct token match
  const candidateTokens = tokenizeText(candidateLower);
  if (candidateTokens.some((t) => tokens.has(t))) return true;

  // Substring match in target text if candidate has >= 3 chars
  if (candidateLower.length >= 3 && targetText.includes(candidateLower)) return true;

  return false;
}

/**
 * Compute similarity score and explainable factor breakdown for a candidate item relative to a desire.
 * Missing traits, condition or usage remain unknown (never invented).
 */
export function computeSuggestionScore(
  item: SuggestionCandidateItem,
  desire: SuggestionDesire,
  feedback?: SuggestionFeedbackRecord | null,
  options?: { ignoreDismissal?: boolean },
): SuggestionScoringResult {
  const isUsable = item.ownershipStatus === 'owned' && item.condition !== 'worn_out';

  // 1. Check eligibility
  if (item.ownershipStatus !== 'owned') {
    return {
      score: 0,
      eligible: false,
      ineligibilityReason: `Item is not currently owned (status: ${item.ownershipStatus})`,
      explanation: 'Not an eligible alternative because ownership status is not owned.',
      factors: [],
      workingRarelyUsed: false,
      conditionContext: null,
      isUsableAlternative: false,
    };
  }

  if (item.condition === 'worn_out') {
    return {
      score: 0,
      eligible: false,
      ineligibilityReason: 'Item is worn out and not a usable alternative',
      explanation: 'Not an eligible alternative because condition is recorded as worn out.',
      factors: [],
      workingRarelyUsed: false,
      conditionContext: 'Condition: worn out',
      isUsableAlternative: false,
    };
  }

  if (item.isAlreadyMatched) {
    return {
      score: 0,
      eligible: false,
      ineligibilityReason: 'Item is already connected to this want',
      explanation: 'Already connected as an alternative possession.',
      factors: [],
      workingRarelyUsed: false,
      conditionContext: null,
      isUsableAlternative: isUsable,
    };
  }

  if (!options?.ignoreDismissal && feedback?.feedbackType === 'dismissed') {
    return {
      score: 0,
      eligible: false,
      ineligibilityReason:
        feedback.scope === 'global'
          ? 'Dismissed globally by owner'
          : 'Dismissed for this want by owner',
      explanation: 'Dismissed from suggestions based on owner feedback.',
      factors: [],
      workingRarelyUsed: false,
      conditionContext: null,
      isUsableAlternative: isUsable,
    };
  }

  // 2. Prepare tokens
  const desireNameTokens = tokenizeText(desire.name);
  const desireReasonTokens = tokenizeText(desire.reason);
  const desireAllTokens = new Set([...desireNameTokens, ...desireReasonTokens]);
  const desireCombinedText = `${desire.name} ${desire.reason ?? ''}`.toLowerCase();

  const factors: SuggestionFactor[] = [];
  let rawScore = 0;

  // Factor: Subcategory Match (+35)
  if (item.subcategoryName && textMatchesTokens(item.subcategoryName, desireAllTokens, desireCombinedText)) {
    const pts = 35;
    rawScore += pts;
    factors.push({
      kind: 'subcategory_match',
      score: pts,
      label: `Subcategory: ${item.subcategoryName}`,
      detail: `Matches subcategory “${item.subcategoryName}” mentioned in your want`,
    });
  }

  // Factor: Category Match (+20)
  if (item.categoryName && textMatchesTokens(item.categoryName, desireAllTokens, desireCombinedText)) {
    const pts = 20;
    rawScore += pts;
    factors.push({
      kind: 'category_match',
      score: pts,
      label: `Category: ${item.categoryName}`,
      detail: `Shares category “${item.categoryName}”`,
    });
  }

  // Factor: Brand Match (+15)
  if (item.brand && textMatchesTokens(item.brand, desireAllTokens, desireCombinedText)) {
    const pts = 15;
    rawScore += pts;
    factors.push({
      kind: 'brand_match',
      score: pts,
      label: `Brand: ${item.brand}`,
      detail: `Matches brand “${item.brand}”`,
    });
  }

  // Factor: Model Match (+15)
  if (item.model && textMatchesTokens(item.model, desireAllTokens, desireCombinedText)) {
    const pts = 15;
    rawScore += pts;
    factors.push({
      kind: 'model_match',
      score: pts,
      label: `Model: ${item.model}`,
      detail: `Matches model “${item.model}”`,
    });
  }

  // Factor: Name Keyword Overlap (+10 per token, up to +30)
  const itemNameTokens = tokenizeText(item.name);
  const matchingNameTokens = itemNameTokens.filter((t) => desireNameTokens.includes(t));
  if (matchingNameTokens.length > 0) {
    const uniqueMatches = [...new Set(matchingNameTokens)];
    const pts = Math.min(uniqueMatches.length * 10, 30);
    rawScore += pts;
    factors.push({
      kind: 'name_match',
      score: pts,
      label: `Matching words: ${uniqueMatches.slice(0, 3).join(', ')}`,
      detail: `Shares keywords “${uniqueMatches.join(', ')}” in item and want title`,
    });
  }

  // Factor: Purpose / Reason Overlap (up to +25)
  // Compares desire.reason (user's intended purpose) with item description and notes
  if (desireReasonTokens.length > 0) {
    const itemContextTokens = [
      ...tokenizeText(item.description),
      ...tokenizeText(item.notes),
      ...itemNameTokens,
    ];
    const sharedPurposeTokens = [...new Set(desireReasonTokens.filter((t) => itemContextTokens.includes(t)))];
    if (sharedPurposeTokens.length > 0) {
      const pts = Math.min(sharedPurposeTokens.length * 6, 25);
      rawScore += pts;
      factors.push({
        kind: 'purpose_match',
        score: pts,
        label: `Shared purpose: ${sharedPurposeTokens.slice(0, 3).join(', ')}`,
        detail: `Shares intended purpose keywords: “${sharedPurposeTokens.join(', ')}”`,
      });
    }
  }

  // Factor: Tag Matches (+5 per matching tag, up to +15)
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    const matchingTags = item.tags.filter((tag) => textMatchesTokens(tag, desireAllTokens, desireCombinedText));
    if (matchingTags.length > 0) {
      const uniqueTags = [...new Set(matchingTags)];
      const pts = Math.min(uniqueTags.length * 5, 15);
      rawScore += pts;
      factors.push({
        kind: 'tag_match',
        score: pts,
        label: `Tags: #${uniqueTags.slice(0, 3).join(', #')}`,
        detail: `Matching tags: #${uniqueTags.join(', #')}`,
      });
    }
  }

  // Factor: Trait / Specifications Match (up to +10)
  if (item.specifications && typeof item.specifications === 'object') {
    const matchingTraits: string[] = [];
    for (const [key, val] of Object.entries(item.specifications)) {
      if (typeof val === 'string' && textMatchesTokens(val, desireAllTokens, desireCombinedText)) {
        matchingTraits.push(`${key}: ${val}`);
      } else if (textMatchesTokens(key, desireAllTokens, desireCombinedText)) {
        matchingTraits.push(key);
      }
    }
    if (matchingTraits.length > 0) {
      const pts = Math.min(matchingTraits.length * 5, 10);
      rawScore += pts;
      factors.push({
        kind: 'trait_match',
        score: pts,
        label: `Traits: ${matchingTraits.slice(0, 2).join(', ')}`,
        detail: `Matching specifications: ${matchingTraits.join(', ')}`,
      });
    }
  }

  // Working and Rarely Used Context calculation
  const isWorking = item.condition === 'working';
  const isRarelyUsed = item.useFrequency === 'rarely';
  const workingRarelyUsed = isWorking && isRarelyUsed;
  let conditionContext: string | null = null;
  if (workingRarelyUsed) {
    conditionContext = 'Working condition · Recorded usage: rarely';
  } else if (item.condition === 'broken') {
    conditionContext = 'Recorded condition: broken (may need repair)';
  } else if (item.condition === 'needs_repair') {
    conditionContext = 'Recorded condition: needs repair';
  } else if (item.condition && item.condition !== 'unknown') {
    conditionContext = `Condition: ${item.condition.replace(/_/g, ' ')}`;
  }

  // At least one genuine domain factor (category, subcategory, name, brand, model, tags, purpose, or traits)
  // must match for the item to be considered a relevant suggestion.
  const hasDomainMatch = factors.some(
    (f) =>
      f.kind !== 'rarely_used_working' &&
      f.kind !== 'condition_penalty' &&
      f.kind !== 'relevance_feedback',
  );

  if (!hasDomainMatch) {
    return {
      score: 0,
      eligible: false,
      ineligibilityReason: 'No matching category, subcategory, purpose, or traits',
      explanation: 'No relevant matching factors with this want.',
      factors: [],
      workingRarelyUsed,
      conditionContext,
      isUsableAlternative: isUsable,
    };
  }

  // Working & Rarely Used factor points (+5)
  if (workingRarelyUsed) {
    const pts = 5;
    rawScore += pts;
    factors.push({
      kind: 'rarely_used_working',
      score: pts,
      label: 'Working & rarely used',
      detail: 'Recorded as working and rarely used possession',
    });
  } else if (item.condition === 'broken') {
    const penalty = -15;
    rawScore += penalty;
    factors.push({
      kind: 'condition_penalty',
      score: penalty,
      label: 'Condition: broken',
      detail: 'Recorded in broken condition; may need repair before serving as alternative',
    });
  } else if (item.condition === 'needs_repair') {
    const penalty = -10;
    rawScore += penalty;
    factors.push({
      kind: 'condition_penalty',
      score: penalty,
      label: 'Condition: needs repair',
      detail: 'Recorded as needing repair before use',
    });
  }

  // Relevance Feedback adjustment
  if (feedback?.feedbackType === 'irrelevant') {
    const penalty = -50;
    rawScore += penalty;
    factors.push({
      kind: 'relevance_feedback',
      score: penalty,
      label: 'Owner feedback: not relevant',
      detail: 'Marked as not an alternative for this want',
    });
  } else if (feedback?.feedbackType === 'relevant') {
    const boost = 20;
    rawScore += boost;
    factors.push({
      kind: 'relevance_feedback',
      score: boost,
      label: 'Owner feedback: confirmed relevant',
      detail: 'Confirmed by owner as a helpful alternative',
    });
  }

  const finalScore = Math.max(0, Math.min(100, rawScore));

  // Build human-readable explanation from primary contributing factors
  const explanation = buildExplanation(factors, item, workingRarelyUsed);

  return {
    score: finalScore,
    eligible: finalScore > 0,
    explanation,
    factors,
    workingRarelyUsed,
    conditionContext,
    isUsableAlternative: isUsable,
  };
}

function buildExplanation(
  factors: SuggestionFactor[],
  item: SuggestionCandidateItem,
  workingRarelyUsed: boolean,
): string {
  const positive = factors.filter((f) => f.score > 0);
  if (positive.length === 0) {
    if (item.categoryName) {
      return `Belongs to category “${item.categoryName}”.`;
    }
    return 'Potential alternative from your inventory.';
  }

  const parts: string[] = [];
  const subcat = positive.find((f) => f.kind === 'subcategory_match');
  const cat = positive.find((f) => f.kind === 'category_match');
  const brand = positive.find((f) => f.kind === 'brand_match');
  const name = positive.find((f) => f.kind === 'name_match');
  const purpose = positive.find((f) => f.kind === 'purpose_match');
  const tags = positive.find((f) => f.kind === 'tag_match');

  if (subcat) {
    parts.push(`shares subcategory “${item.subcategoryName}”`);
  } else if (cat) {
    parts.push(`shares category “${item.categoryName}”`);
  }

  if (brand) {
    parts.push(`matches brand “${item.brand}”`);
  }

  if (name && !parts.some((p) => p.includes('brand') || p.includes('subcategory'))) {
    parts.push(name.detail.toLowerCase());
  }

  if (purpose) {
    parts.push(purpose.detail.toLowerCase());
  } else if (tags && parts.length < 2) {
    parts.push(tags.detail.toLowerCase());
  }

  let text = `Suggested because it ${parts.join(' and ')}.`;
  if (workingRarelyUsed) {
    text += ' Working condition with rare recorded usage.';
  }
  return text;
}

/**
 * Deterministic comparison and stable tie-breaking for suggestions.
 * 1. Score descending
 * 2. Usable alternative descending (usable before broken/needs_repair)
 * 3. Created date descending
 * 4. Item ID ascending (lexicographical stable tie-breaker)
 */
export function compareSuggestions(
  a: { score: number; isUsableAlternative: boolean; createdAt: string | Date; id: string },
  b: { score: number; isUsableAlternative: boolean; createdAt: string | Date; id: string },
): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.isUsableAlternative !== b.isUsableAlternative) {
    return a.isUsableAlternative ? -1 : 1;
  }
  const dateA = new Date(a.createdAt).getTime();
  const dateB = new Date(b.createdAt).getTime();
  if (dateB !== dateA) {
    return dateB - dateA;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Rank candidate items against a desire with owner feedback map.
 * Returns only eligible candidates with score > 0, deterministically ordered.
 */
export function rankSuggestionCandidates(
  items: SuggestionCandidateItem[],
  desire: SuggestionDesire,
  feedbackMap?: Map<string, SuggestionFeedbackRecord>,
): Array<{ item: SuggestionCandidateItem; result: SuggestionScoringResult }> {
  const scored = items.map((item) => {
    const feedback = feedbackMap?.get(item.id);
    const result = computeSuggestionScore(item, desire, feedback);
    return { item, result };
  });

  return scored
    .filter((entry) => entry.result.eligible && entry.result.score > 0)
    .sort((a, b) =>
      compareSuggestions(
        {
          score: a.result.score,
          isUsableAlternative: a.result.isUsableAlternative,
          createdAt: a.item.createdAt,
          id: a.item.id,
        },
        {
          score: b.result.score,
          isUsableAlternative: b.result.isUsableAlternative,
          createdAt: b.item.createdAt,
          id: b.item.id,
        },
      ),
    );
}
