import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeText,
  computeSuggestionScore,
  compareSuggestions,
  rankSuggestionCandidates,
} from '../dist/index.js';

describe('similarity and explainable suggestion ranking', () => {
  describe('tokenizeText', () => {
    it('normalizes, lowercases, and strips punctuation and stop words', () => {
      const tokens = tokenizeText(
        'The Sony WH-1000XM4 Wireless Noise-Canceling Headphones for Coffee Shops!',
      );
      assert.ok(!tokens.includes('the'));
      assert.ok(!tokens.includes('for'));
      assert.ok(tokens.includes('sony'));
      assert.ok(tokens.includes('wh-1000xm4'));
      assert.ok(tokens.includes('wireless'));
      assert.ok(tokens.includes('headphones'));
      assert.ok(tokens.includes('coffee'));
    });

    it('handles empty or null text safely', () => {
      assert.deepEqual(tokenizeText(''), []);
      assert.deepEqual(tokenizeText(null), []);
      assert.deepEqual(tokenizeText(undefined), []);
    });
  });

  describe('computeSuggestionScore - scoring factors and explanations', () => {
    const desire = {
      id: 'd1111111-1111-4111-8111-111111111111',
      name: 'Sony WH-1000XM5 Headphones',
      reason: 'Need quiet focus for coffee shop work',
    };

    it('scores subcategory, category, brand, and name matches with clear factors', () => {
      const item = {
        id: 'i1111111-1111-4111-8111-111111111111',
        name: 'Sony WH-1000XM4 Headphones',
        brand: 'Sony',
        model: 'WH-1000XM4',
        categoryId: 'c1',
        categoryName: 'Electronics',
        subcategoryId: 'sc1',
        subcategoryName: 'Headphones',
        condition: 'working',
        useFrequency: 'rarely',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const result = computeSuggestionScore(item, desire);
      assert.equal(result.eligible, true);
      assert.ok(result.score >= 70, `Expected score >= 70, got ${result.score}`);
      assert.equal(result.workingRarelyUsed, true);
      assert.equal(result.conditionContext, 'Working condition · Recorded usage: rarely');
      assert.ok(result.explanation.includes('shares subcategory “Headphones”'));
      assert.ok(result.explanation.includes('matches brand “Sony”'));
      assert.ok(result.explanation.includes('Working condition with rare recorded usage.'));

      // Check specific factors
      const factorKinds = result.factors.map((f) => f.kind);
      assert.ok(factorKinds.includes('subcategory_match'));
      assert.ok(factorKinds.includes('brand_match'));
      assert.ok(factorKinds.includes('rarely_used_working'));
    });

    it('scores shared purpose from desire reason and item notes', () => {
      const coffeeDesire = {
        id: 'd2',
        name: 'Pour-Over Dripper',
        reason: 'Daily coffee brewing ritual with paper filter',
      };

      const itemWithNotes = {
        id: 'i2',
        name: 'AeroPress Maker',
        notes: 'Handy tool for daily coffee brewing',
        categoryName: 'Kitchen',
        subcategoryName: 'Coffee & Tea',
        ownershipStatus: 'owned',
        condition: 'working',
        useFrequency: 'often',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const result = computeSuggestionScore(itemWithNotes, coffeeDesire);
      assert.equal(result.eligible, true);
      const purposeFactor = result.factors.find((f) => f.kind === 'purpose_match');
      assert.ok(purposeFactor, 'Expected purpose_match factor');
      assert.ok(purposeFactor.score > 0);
      assert.ok(result.explanation.includes('coffee') || result.explanation.includes('brewing'));
    });

    it('leaves missing traits as unknown without inventing values', () => {
      const minimalItem = {
        id: 'i3',
        name: 'Headphones',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const result = computeSuggestionScore(minimalItem, desire);
      assert.equal(result.eligible, true);
      assert.equal(result.conditionContext, null);
      assert.equal(result.workingRarelyUsed, false);
      // No brand, model, or category factor should be fabricated
      const factorKinds = result.factors.map((f) => f.kind);
      assert.ok(!factorKinds.includes('brand_match'));
      assert.ok(!factorKinds.includes('category_match'));
      assert.ok(!factorKinds.includes('subcategory_match'));
    });

    it('applies condition penalty for broken items while keeping them eligible', () => {
      const brokenItem = {
        id: 'i4',
        name: 'Sony WH-1000XM3',
        brand: 'Sony',
        condition: 'broken',
        ownershipStatus: 'owned',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      const result = computeSuggestionScore(brokenItem, desire);
      assert.equal(result.eligible, true);
      assert.equal(result.conditionContext, 'Recorded condition: broken (may need repair)');
      const brokenFactor = result.factors.find((f) => f.kind === 'condition_penalty');
      assert.ok(brokenFactor);
      assert.ok(brokenFactor.score < 0);
    });
  });

  describe('eligibility rules', () => {
    const desire = { id: 'd1', name: 'Winter Coat' };

    it('marks non-owned items as ineligible', () => {
      for (const status of ['sold', 'donated', 'disposed', 'lost', 'returned']) {
        const item = {
          id: 'i1',
          name: 'Winter Coat',
          ownershipStatus: status,
          createdAt: '2026-01-01T00:00:00.000Z',
        };
        const result = computeSuggestionScore(item, desire);
        assert.equal(result.eligible, false);
        assert.equal(result.score, 0);
        assert.ok(result.ineligibilityReason.includes(status));
      }
    });

    it('marks worn-out items as ineligible', () => {
      const item = {
        id: 'i2',
        name: 'Winter Coat',
        ownershipStatus: 'owned',
        condition: 'worn_out',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const result = computeSuggestionScore(item, desire);
      assert.equal(result.eligible, false);
      assert.equal(result.score, 0);
      assert.ok(result.ineligibilityReason.includes('worn out'));
    });

    it('marks already-matched items as ineligible for new suggestions', () => {
      const item = {
        id: 'i3',
        name: 'Winter Coat',
        ownershipStatus: 'owned',
        isAlreadyMatched: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const result = computeSuggestionScore(item, desire);
      assert.equal(result.eligible, false);
      assert.equal(result.score, 0);
      assert.ok(result.ineligibilityReason.includes('already connected'));
    });

    it('marks dismissed items as ineligible', () => {
      const item = {
        id: 'i4',
        name: 'Winter Coat',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const result = computeSuggestionScore(item, desire, {
        feedbackType: 'dismissed',
        scope: 'desire',
      });
      assert.equal(result.eligible, false);
      assert.equal(result.score, 0);
      assert.ok(result.ineligibilityReason.includes('Dismissed'));
    });
  });

  describe('feedback scoping and reversibility', () => {
    const desire1 = { id: 'd1', name: 'Noise-Cancelling Headphones' };
    const desire2 = { id: 'd2', name: 'Studio Monitoring Headphones' };
    const item = {
      id: 'item-100',
      name: 'Sony WH-1000XM4 Headphones',
      brand: 'Sony',
      categoryName: 'Electronics',
      subcategoryName: 'Headphones',
      ownershipStatus: 'owned',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    it('desire-scoped dismissal only suppresses suggestion for that desire', () => {
      const feedbackMapDesire1 = new Map([
        [item.id, { feedbackType: 'dismissed', scope: 'desire' }],
      ]);
      const feedbackMapDesire2 = new Map(); // No feedback for desire2

      const ranked1 = rankSuggestionCandidates([item], desire1, feedbackMapDesire1);
      assert.equal(ranked1.length, 0, 'Should be suppressed for desire1');

      const ranked2 = rankSuggestionCandidates([item], desire2, feedbackMapDesire2);
      assert.equal(ranked2.length, 1, 'Should NOT be suppressed for desire2');
      assert.equal(ranked2[0].item.id, item.id);
    });

    it('global dismissal suppresses suggestion across all desires', () => {
      const globalFeedback = new Map([[item.id, { feedbackType: 'dismissed', scope: 'global' }]]);

      const ranked1 = rankSuggestionCandidates([item], desire1, globalFeedback);
      assert.equal(ranked1.length, 0);

      const ranked2 = rankSuggestionCandidates([item], desire2, globalFeedback);
      assert.equal(ranked2.length, 0);
    });

    it('irrelevant feedback downranks the item below other options', () => {
      const itemA = {
        id: 'a',
        name: 'Sony WH-1000XM4 Headphones',
        brand: 'Sony',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const itemB = {
        id: 'b',
        name: 'Bose QC35 Headphones',
        brand: 'Bose',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      // Without feedback, itemA has brand match and ranks higher or equal
      const initial = rankSuggestionCandidates([itemA, itemB], desire1);
      assert.equal(initial[0].item.id, 'a');

      // Mark itemA as irrelevant for desire1
      const feedback = new Map([['a', { feedbackType: 'irrelevant', scope: 'desire' }]]);
      const afterFeedback = rankSuggestionCandidates([itemA, itemB], desire1, feedback);
      assert.equal(afterFeedback[0].item.id, 'b', 'itemB should now rank above downranked itemA');
    });

    it('resetting feedback restores original ranking', () => {
      const itemA = {
        id: 'a',
        name: 'Sony WH-1000XM4 Headphones',
        brand: 'Sony',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        ownershipStatus: 'owned',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      // With dismissal
      const dismissedFeedback = new Map([['a', { feedbackType: 'dismissed', scope: 'desire' }]]);
      assert.equal(rankSuggestionCandidates([itemA], desire1, dismissedFeedback).length, 0);

      // Feedback cleared (reset)
      const clearedFeedback = new Map();
      const restored = rankSuggestionCandidates([itemA], desire1, clearedFeedback);
      assert.equal(restored.length, 1);
      assert.equal(restored[0].item.id, 'a');
    });
  });

  describe('deterministic tie-breaking', () => {
    it('produces identical stable ordering across multiple runs with tied scores', () => {
      const items = [
        {
          id: 'item-uuid-3',
          name: 'Generic Headphones 3',
          categoryName: 'Electronics',
          ownershipStatus: 'owned',
          condition: 'working',
          createdAt: '2026-01-01T12:00:00.000Z',
        },
        {
          id: 'item-uuid-1',
          name: 'Generic Headphones 1',
          categoryName: 'Electronics',
          ownershipStatus: 'owned',
          condition: 'working',
          createdAt: '2026-01-01T12:00:00.000Z',
        },
        {
          id: 'item-uuid-2',
          name: 'Generic Headphones 2',
          categoryName: 'Electronics',
          ownershipStatus: 'owned',
          condition: 'working',
          createdAt: '2026-01-01T12:00:00.000Z',
        },
      ];

      const desire = { id: 'd', name: 'Electronics Headphones' };

      const run1 = rankSuggestionCandidates(items, desire).map((r) => r.item.id);
      const run2 = rankSuggestionCandidates([...items].reverse(), desire).map((r) => r.item.id);
      const run3 = rankSuggestionCandidates([items[1], items[2], items[0]], desire).map(
        (r) => r.item.id,
      );

      assert.deepEqual(run1, run2);
      assert.deepEqual(run2, run3);
      // Because date and score are equal, lexicographical ID comparison item-uuid-1, item-uuid-2, item-uuid-3
      assert.deepEqual(run1, ['item-uuid-1', 'item-uuid-2', 'item-uuid-3']);
    });

    it('prefers usable alternatives over degraded alternatives when scores tie', () => {
      const usable = {
        id: 'u1',
        score: 40,
        isUsableAlternative: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const degraded = {
        id: 'u2',
        score: 40,
        isUsableAlternative: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      assert.ok(compareSuggestions(usable, degraded) < 0);
      assert.ok(compareSuggestions(degraded, usable) > 0);
    });
  });

  describe('labelled synthetic evaluation dataset', () => {
    // Synthetic dataset of 12 realistic household items
    const inventory = [
      {
        id: 'inv-01',
        name: 'Sony WH-1000XM4 Noise Canceling Headphones',
        brand: 'Sony',
        model: 'WH-1000XM4',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        tags: ['audio', 'bluetooth', 'focus'],
        notes: 'Great for daily focus and travel',
        condition: 'working',
        useFrequency: 'rarely',
        ownershipStatus: 'owned',
        createdAt: '2025-06-01T00:00:00.000Z',
      },
      {
        id: 'inv-02',
        name: 'Bose QuietComfort 35 II',
        brand: 'Bose',
        model: 'QC35',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        tags: ['audio', 'bluetooth'],
        condition: 'working',
        useFrequency: 'often',
        ownershipStatus: 'owned',
        createdAt: '2025-05-01T00:00:00.000Z',
      },
      {
        id: 'inv-03',
        name: 'Keychron K2 Mechanical Keyboard',
        brand: 'Keychron',
        model: 'K2',
        categoryName: 'Electronics',
        subcategoryName: 'Keyboards',
        tags: ['desk', 'typing', 'ergonomic'],
        notes: 'Tactile typing for desk setup',
        condition: 'working',
        useFrequency: 'rarely',
        ownershipStatus: 'owned',
        createdAt: '2025-04-01T00:00:00.000Z',
      },
      {
        id: 'inv-04',
        name: 'AeroPress Coffee Maker',
        brand: 'AeroPress',
        categoryName: 'Kitchen',
        subcategoryName: 'Coffee & Tea',
        tags: ['coffee', 'brewing'],
        notes: 'Filter brewing for daily coffee',
        condition: 'working',
        useFrequency: 'sometimes',
        ownershipStatus: 'owned',
        createdAt: '2025-03-01T00:00:00.000Z',
      },
      {
        id: 'inv-05',
        name: 'Hario V60 Ceramic Dripper',
        brand: 'Hario',
        model: 'V60',
        categoryName: 'Kitchen',
        subcategoryName: 'Coffee & Tea',
        tags: ['coffee', 'pourover'],
        notes: 'Manual pourover coffee dripper',
        condition: 'working',
        useFrequency: 'rarely',
        ownershipStatus: 'owned',
        createdAt: '2025-02-01T00:00:00.000Z',
      },
      {
        id: 'inv-06',
        name: 'Old Broken Earbuds',
        brand: 'Generic',
        categoryName: 'Electronics',
        subcategoryName: 'Headphones',
        condition: 'broken',
        ownershipStatus: 'owned',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'inv-07',
        name: 'Cast Iron Skillet',
        brand: 'Lodge',
        categoryName: 'Kitchen',
        subcategoryName: 'Cookware',
        condition: 'working',
        useFrequency: 'often',
        ownershipStatus: 'owned',
        createdAt: '2024-12-01T00:00:00.000Z',
      },
      {
        id: 'inv-08',
        name: 'Worn Out Running Trainers',
        categoryName: 'Apparel',
        subcategoryName: 'Shoes',
        condition: 'worn_out',
        ownershipStatus: 'owned',
        createdAt: '2024-11-01T00:00:00.000Z',
      },
      {
        id: 'inv-09',
        name: 'Sold iPad Mini',
        categoryName: 'Electronics',
        subcategoryName: 'Tablets',
        ownershipStatus: 'sold',
        createdAt: '2024-10-01T00:00:00.000Z',
      },
    ];

    it('evaluates Scenario A: Audio want -> Sony WH-1000XM4 ranks #1 with high precision', () => {
      const desireAudio = {
        id: 'eval-d1',
        name: 'Sony WH-1000XM5 Wireless Headphones',
        reason: 'Need noise cancellation for travel and quiet focus',
      };

      const ranked = rankSuggestionCandidates(inventory, desireAudio);
      assert.ok(ranked.length >= 2);
      // Expected Top 1: inv-01 (Sony WH-1000XM4)
      assert.equal(ranked[0].item.id, 'inv-01');
      assert.equal(ranked[0].result.workingRarelyUsed, true);
      assert.ok(ranked[0].result.score >= 80);

      // Expected Top 2: inv-02 (Bose QC35)
      assert.equal(ranked[1].item.id, 'inv-02');

      // inv-06 (broken) ranks lower than working alternatives
      const brokenIndex = ranked.findIndex((r) => r.item.id === 'inv-06');
      assert.ok(brokenIndex > 1);

      // Worn-out and sold items are completely excluded
      assert.equal(
        ranked.some((r) => r.item.id === 'inv-08'),
        false,
      );
      assert.equal(
        ranked.some((r) => r.item.id === 'inv-09'),
        false,
      );

      // Non-relevant categories (skillet, keyboard, coffee) have score 0 and are excluded
      assert.equal(
        ranked.some((r) => r.item.id === 'inv-07'),
        false,
      );
      assert.equal(
        ranked.some((r) => r.item.id === 'inv-03'),
        false,
      );
    });

    it('evaluates Scenario B: Coffee want -> Hario V60 ranks #1 with working & rarely used context', () => {
      const desireCoffee = {
        id: 'eval-d2',
        name: 'Origami Pourover Dripper',
        reason: 'Manual pourover coffee dripper with paper filters',
      };

      const ranked = rankSuggestionCandidates(inventory, desireCoffee);
      assert.ok(ranked.length >= 2);
      // inv-05 (Hario V60) matches "pourover", "dripper", "coffee", subcategory, and is working & rarely used
      assert.equal(ranked[0].item.id, 'inv-05');
      assert.equal(ranked[0].result.workingRarelyUsed, true);
      assert.equal(ranked[1].item.id, 'inv-04'); // AeroPress also in coffee subcategory
    });

    it('evaluates Scenario C: Keyboard want -> Keychron K2 ranks #1', () => {
      const desireKeyboard = {
        id: 'eval-d3',
        name: 'Logitech Mechanical Typing Keyboard',
        reason: 'Ergonomic typing for home desk setup',
      };

      const ranked = rankSuggestionCandidates(inventory, desireKeyboard);
      assert.ok(ranked.length >= 1);
      assert.equal(ranked[0].item.id, 'inv-03');
      assert.ok(
        ranked[0].result.explanation.includes('Keyboards') ||
          ranked[0].result.explanation.includes('typing'),
      );
    });

    it('computes quantitative evaluation benchmark metrics meeting release quality criteria', () => {
      const benchmarks = [
        {
          desire: {
            id: 'b1',
            name: 'Sony WH-1000XM5 Wireless Headphones',
            reason: 'Noise cancellation for travel focus',
          },
          expectedRelevant: new Set(['inv-01', 'inv-02']),
          expectedTop1: 'inv-01',
        },
        {
          desire: {
            id: 'b2',
            name: 'Origami Pourover Dripper',
            reason: 'Manual pourover coffee dripper with paper filters',
          },
          expectedRelevant: new Set(['inv-05', 'inv-04']),
          expectedTop1: 'inv-05',
        },
        {
          desire: {
            id: 'b3',
            name: 'Mechanical Ergonomic Typing Keyboard',
            reason: 'Desk typing setup',
          },
          expectedRelevant: new Set(['inv-03']),
          expectedTop1: 'inv-03',
        },
      ];

      let totalP1 = 0;
      let totalP3 = 0;
      let totalR3 = 0;
      let totalRR = 0;

      for (const bench of benchmarks) {
        const ranked = rankSuggestionCandidates(inventory, bench.desire);
        const top1 = ranked[0]?.item.id;
        const top3 = ranked.slice(0, 3).map((r) => r.item.id);

        // P@1
        if (top1 === bench.expectedTop1) totalP1 += 1;

        // P@3: proportion of top 3 that are in expectedRelevant
        const relevantInTop3 = top3.filter((id) => bench.expectedRelevant.has(id)).length;
        totalP3 += relevantInTop3 / Math.min(top3.length || 1, 3);

        // R@3: proportion of expectedRelevant that are in top 3
        totalR3 += relevantInTop3 / bench.expectedRelevant.size;

        // Reciprocal rank of first relevant item
        const firstRelevantRank = ranked.findIndex((r) => bench.expectedRelevant.has(r.item.id));
        if (firstRelevantRank >= 0) {
          totalRR += 1 / (firstRelevantRank + 1);
        }
      }

      const meanP1 = totalP1 / benchmarks.length;
      const meanP3 = totalP3 / benchmarks.length;
      const meanR3 = totalR3 / benchmarks.length;
      const mrr = totalRR / benchmarks.length;

      // Release quality gates:
      // Mean Precision@1 must be 1.0 (100% of queries have correct #1 recommendation)
      // Mean Precision@3 must be >= 0.85
      // Mean Recall@3 must be 1.0 (all relevant items found in top 3)
      // Mean Reciprocal Rank (MRR) must be 1.0
      assert.equal(meanP1, 1.0, `Expected Mean P@1 = 1.0, got ${meanP1}`);
      assert.ok(meanP3 >= 0.85, `Expected Mean P@3 >= 0.85, got ${meanP3}`);
      assert.equal(meanR3, 1.0, `Expected Mean R@3 = 1.0, got ${meanR3}`);
      assert.equal(mrr, 1.0, `Expected MRR = 1.0, got ${mrr}`);
    });
  });
});
