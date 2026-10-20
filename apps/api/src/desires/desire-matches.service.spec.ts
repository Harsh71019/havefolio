import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { EventLogger } from '@havefolio/logging';
import { DesiresRepository } from './desires.repository.js';
import { DesireMatchesService } from './desire-matches.service.js';

describe('DesireMatchesService application rules', () => {
  let service: DesireMatchesService;
  const query = jest.fn<(sql: string, values?: unknown[]) => Promise<unknown>>();
  const emitLog = jest.fn<(level: string, event: Record<string, unknown>) => void>();
  const owner = 'f0000000-0000-4000-8000-000000000001';
  const desireId = 'd0000000-0000-4000-8000-000000000001';
  const itemId = 'i0000000-0000-4000-8000-000000000001';
  const matchId = 'm0000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    query.mockReset();
    emitLog.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const module = await Test.createTestingModule({
      providers: [
        DesireMatchesService,
        {
          provide: DesiresRepository,
          useValue: {
            transaction: (_owner: string, operation: (c: PoolClient) => Promise<unknown>) =>
              operation({ query } as unknown as PoolClient),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) => {
              if (key === 'AUTH_RATE_KEY_SECRET') return 'secret-key-32-characters-length!';
              return fallback;
            },
          },
        },
        {
          provide: EventLogger,
          useValue: { emit: emitLog },
        },
      ],
    }).compile();

    service = module.get(DesireMatchesService);
  });

  describe('create match', () => {
    it('throws 404 when desire does not exist or belongs to another owner', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // desire check

      await expect(service.create(owner, desireId, { itemId })).rejects.toThrow(
        new NotFoundException('DESIRE_NOT_FOUND'),
      );
    });

    it('throws 404 when item does not exist or belongs to another owner', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] }) // desire check
        .mockResolvedValueOnce({ rows: [] }); // item check

      await expect(service.create(owner, desireId, { itemId })).rejects.toThrow(
        new NotFoundException('ITEM_NOT_FOUND'),
      );
    });

    it('creates match with default plain-language explanation when omitted', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] }) // desire check
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Sony WH-1000XM4',
              brand: 'Sony',
              model: 'WH-1000XM4',
              ownership_status: 'owned',
              condition: 'working',
              use_frequency: 'often',
              category_id: 'cat-1',
              category_name: 'Electronics',
              subcategory_id: null,
              subcategory_name: null,
            },
          ],
        }) // item check
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // match limit check
        .mockResolvedValueOnce({
          rows: [
            {
              id: matchId,
              created_at: new Date('2026-10-17T10:00:00Z'),
              updated_at: new Date('2026-10-17T10:00:00Z'),
            },
          ],
        }) // insert match
        .mockResolvedValueOnce({ rows: [] }) // covers
        .mockResolvedValueOnce({ rows: [{ item_id: itemId, tag_name: 'audio' }] }); // tags

      const result = await service.create(owner, desireId, { itemId });

      expect(result.id).toBe(matchId);
      expect(result.reason).toBe('Manually selected as a potential alternative');
      expect(result.relevance).toBe('relevant');
      expect(result.source).toBe('manual');
      expect(result.item.name).toBe('Sony WH-1000XM4');
      expect(result.item.isUsableAlternative).toBe(true);
      expect(result.hints.categoryHint).toBe('Category: Electronics');
      expect(result.hints.conditionHint).toBe('Condition: working');
      expect(result.hints.usageHint).toBe('Frequency: often');
      expect(result.hints.traitHints).toEqual(['audio']);

      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.match_created',
        desireId,
        matchId,
        relevance: 'relevant',
        source: 'manual',
        isUsableAlternative: true,
      });
    });

    it('creates match with custom reason and relevance', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Old Earphones',
              brand: null,
              model: null,
              ownership_status: 'disposed',
              condition: 'broken',
              use_frequency: 'never',
              category_id: null,
              category_name: null,
              subcategory_id: null,
              subcategory_name: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: matchId,
              created_at: new Date('2026-10-17T10:00:00Z'),
              updated_at: new Date('2026-10-17T10:00:00Z'),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.create(owner, desireId, {
        itemId,
        reason: 'Already owned a pair before, comparing usage',
        relevance: 'irrelevant',
      });

      expect(result.reason).toBe('Already owned a pair before, comparing usage');
      expect(result.relevance).toBe('irrelevant');
      expect(result.item.isUsableAlternative).toBe(false); // Disposed item is not a usable alternative
    });

    it('allows a manual match to a worn-out item without presenting it as usable', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Faded sneakers',
              brand: null,
              model: null,
              ownership_status: 'owned',
              condition: 'worn_out',
              use_frequency: 'never',
              category_id: null,
              category_name: null,
              subcategory_id: null,
              subcategory_name: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: matchId,
              created_at: new Date('2026-10-17T10:00:00Z'),
              updated_at: new Date('2026-10-17T10:00:00Z'),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.create(owner, desireId, { itemId });

      expect(result.item.ownershipStatus).toBe('owned');
      expect(result.item.condition).toBe('worn_out');
      expect(result.item.isUsableAlternative).toBe(false);
      expect(result.hints.conditionHint).toBe('Condition: worn out');
    });

    it('rejects duplicate matches with 409 Conflict', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [{ id: itemId, name: 'Item', ownership_status: 'owned' }],
        })
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockRejectedValueOnce({ code: '23505' }); // unique constraint violation

      await expect(service.create(owner, desireId, { itemId })).rejects.toThrow(
        new ConflictException('MATCH_ALREADY_EXISTS'),
      );
    });

    it('rejects when match limit of 50 is reached', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [{ id: itemId, name: 'Item', ownership_status: 'owned' }],
        })
        .mockResolvedValueOnce({ rows: [{ count: '50' }] });

      await expect(service.create(owner, desireId, { itemId })).rejects.toThrow(
        new ConflictException('MATCH_LIMIT_EXCEEDED'),
      );
    });

    it('rejects invalid reason length (>1000 characters)', async () => {
      await expect(
        service.create(owner, desireId, { itemId, reason: 'x'.repeat(1001) }),
      ).rejects.toThrow(new BadRequestException('INVALID_MATCH_REASON'));
    });
  });

  describe('update match', () => {
    it('throws 404 when match is not found', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] }) // desire check
        .mockResolvedValueOnce({ rows: [] }); // match check

      await expect(
        service.update(owner, desireId, matchId, { relevance: 'irrelevant' }),
      ).rejects.toThrow(new NotFoundException('MATCH_NOT_FOUND'));
    });

    it('updates relevance feedback and reason', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [{ id: matchId, item_id: itemId, reason: 'Old', relevance: 'relevant' }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: matchId,
              desire_id: desireId,
              item_id: itemId,
              reason: 'Updated reason',
              relevance: 'irrelevant',
              source: 'manual',
              created_at: new Date('2026-10-17T10:00:00Z'),
              updated_at: new Date('2026-10-17T11:00:00Z'),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: itemId, name: 'Headphones', ownership_status: 'owned' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const updated = await service.update(owner, desireId, matchId, {
        reason: 'Updated reason',
        relevance: 'irrelevant',
      });

      expect(updated.relevance).toBe('irrelevant');
      expect(updated.reason).toBe('Updated reason');
      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.match_feedback_updated',
        desireId,
        matchId,
        relevance: 'irrelevant',
      });
    });
  });

  describe('remove match', () => {
    it('deletes the match record when found', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await expect(service.remove(owner, desireId, matchId)).resolves.toBeUndefined();

      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.match_removed',
        desireId,
        matchId,
      });
    });

    it('throws 404 when match to delete does not exist', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.remove(owner, desireId, matchId)).rejects.toThrow(
        new NotFoundException('MATCH_NOT_FOUND'),
      );
    });
  });

  describe('candidates search', () => {
    it('by default filters out unavailable items and marks already matched', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Bose 700',
              brand: 'Bose',
              model: '700',
              ownership_status: 'owned',
              condition: 'working',
              use_frequency: 'often',
              category_id: 'cat-1',
              category_name: 'Audio',
              subcategory_id: null,
              subcategory_name: null,
              created_at: new Date('2026-10-17T10:00:00Z'),
              is_already_matched: true,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.candidates(owner, desireId, { limit: 20 });

      expect(result.items).toHaveLength(1);
      const candidate = result.items[0]!;
      expect(candidate.name).toBe('Bose 700');
      expect(candidate.isAlreadyMatched).toBe(true);
      expect(candidate.isUsableAlternative).toBe(true);
      expect(candidate.suggestedReason).toBe(
        'Selected from Audio as a potential alternative possession.',
      );
    });
  });

  describe('suggestions ranking and explanations', () => {
    it('returns ranked suggestions with explanation factors and working rarely used context', async () => {
      query
        // 1. Check desire
        .mockResolvedValueOnce({
          rows: [
            {
              id: desireId,
              name: 'Sony WH-1000XM5 Headphones',
              reason: 'Noise cancellation for daily focus',
              classification: 'want',
            },
          ],
        })
        // 2. Fetch feedback
        .mockResolvedValueOnce({ rows: [] })
        // 3. Fetch candidate items
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Sony WH-1000XM4 Headphones',
              brand: 'Sony',
              model: 'WH-1000XM4',
              description: 'Noise canceling headphones',
              notes: 'Daily focus tool',
              specifications: { bluetooth: '5.0' },
              ownership_status: 'owned',
              condition: 'working',
              use_frequency: 'rarely',
              category_id: 'cat-1',
              category_name: 'Electronics',
              subcategory_id: 'subcat-1',
              subcategory_name: 'Headphones',
              created_at: new Date('2026-10-17T10:00:00Z'),
              is_already_matched: false,
            },
          ],
        })
        // 4. Fetch covers
        .mockResolvedValueOnce({ rows: [] })
        // 5. Fetch tags
        .mockResolvedValueOnce({ rows: [{ item_id: itemId, tag_name: 'audio' }] });

      const res = await service.suggestions(owner, desireId, { limit: 10 });

      expect(res.items).toHaveLength(1);
      const sug = res.items[0]!;
      expect(sug.id).toBe(itemId);
      expect(sug.score).toBeGreaterThanOrEqual(70);
      expect(sug.workingRarelyUsed).toBe(true);
      expect(sug.conditionContext).toBe('Working condition · Recorded usage: rarely');
      expect(sug.explanation).toContain('shares subcategory “Headphones”');
      expect(sug.explanation).toContain('matches brand “Sony”');
      expect(sug.explanation).toContain('Working condition with rare recorded usage.');

      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.suggestions_queried',
        desireId,
        resultCount: 1,
      });
    });

    it('throws 404 when desire does not exist', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      await expect(service.suggestions(owner, desireId, {})).rejects.toThrow(
        new NotFoundException('DESIRE_NOT_FOUND'),
      );
    });

    it('excludes dismissed items by default but includes when includeDismissed is true', async () => {
      // 1. Without includeDismissed
      query
        .mockResolvedValueOnce({
          rows: [{ id: desireId, name: 'Headphones', reason: null, classification: null }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-1',
              desire_id: desireId,
              item_id: itemId,
              feedback_type: 'dismissed',
              scope: 'desire',
              reason: 'Not needed',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Old Headphones',
              brand: null,
              model: null,
              ownership_status: 'owned',
              condition: 'working',
              use_frequency: 'often',
              category_id: null,
              category_name: null,
              subcategory_id: null,
              subcategory_name: null,
              created_at: new Date('2026-10-17T10:00:00Z'),
              is_already_matched: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res1 = await service.suggestions(owner, desireId, { includeDismissed: false });
      expect(res1.items).toHaveLength(0);

      // 2. With includeDismissed
      query
        .mockResolvedValueOnce({
          rows: [{ id: desireId, name: 'Headphones', reason: null, classification: null }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-1',
              desire_id: desireId,
              item_id: itemId,
              feedback_type: 'dismissed',
              scope: 'desire',
              reason: 'Not needed',
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name: 'Old Headphones',
              brand: null,
              model: null,
              ownership_status: 'owned',
              condition: 'working',
              use_frequency: 'often',
              category_id: null,
              category_name: null,
              subcategory_id: null,
              subcategory_name: null,
              created_at: new Date('2026-10-17T10:00:00Z'),
              is_already_matched: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res2 = await service.suggestions(owner, desireId, { includeDismissed: true });
      expect(res2.items).toHaveLength(1);
      expect(res2.items[0]?.feedback?.feedbackType).toBe('dismissed');
    });
  });

  describe('feedback recording and deletion', () => {
    it('records relevance feedback on a suggestion', async () => {
      const now = new Date();
      query
        .mockResolvedValueOnce({ rows: [{ id: desireId }] }) // desire exists
        .mockResolvedValueOnce({ rows: [{ id: itemId }] }) // item exists
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-1',
              desire_id: desireId,
              item_id: itemId,
              feedback_type: 'dismissed',
              scope: 'desire',
              reason: 'Different category',
              created_at: now,
              updated_at: now,
            },
          ],
        });

      const res = await service.recordFeedback(owner, desireId, {
        itemId,
        feedbackType: 'dismissed',
        scope: 'desire',
        reason: 'Different category',
      });

      expect(res.feedbackType).toBe('dismissed');
      expect(res.scope).toBe('desire');
      expect(res.reason).toBe('Different category');
      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.suggestion_feedback_recorded',
        desireId,
        feedbackType: 'dismissed',
        scope: 'desire',
      });
    });

    it('throws 404 when recording feedback for non-existent desire or item', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // desire not found
      await expect(
        service.recordFeedback(owner, desireId, { itemId, feedbackType: 'dismissed' }),
      ).rejects.toThrow(new NotFoundException('DESIRE_NOT_FOUND'));

      query.mockResolvedValueOnce({ rows: [{ id: desireId }] }).mockResolvedValueOnce({ rows: [] }); // item not found
      await expect(
        service.recordFeedback(owner, desireId, { itemId, feedbackType: 'dismissed' }),
      ).rejects.toThrow(new NotFoundException('ITEM_NOT_FOUND'));
    });

    it('deletes feedback and emits audit log', async () => {
      query.mockResolvedValueOnce({ rowCount: 1 });
      await expect(service.deleteFeedback(owner, desireId, 'fb-1')).resolves.toBeUndefined();
      expect(emitLog).toHaveBeenCalledWith('info', {
        event: 'desire.suggestion_feedback_removed',
        desireId,
      });
    });

    it('throws 404 when deleting non-existent feedback', async () => {
      query.mockResolvedValueOnce({ rowCount: 0 });
      await expect(service.deleteFeedback(owner, desireId, 'fb-1')).rejects.toThrow(
        new NotFoundException('FEEDBACK_NOT_FOUND'),
      );
    });

    it('lists feedback for a desire', async () => {
      const now = new Date();
      query.mockResolvedValueOnce({ rows: [{ id: desireId }] }).mockResolvedValueOnce({
        rows: [
          {
            id: 'fb-1',
            desire_id: desireId,
            item_id: itemId,
            feedback_type: 'irrelevant',
            scope: 'desire',
            reason: null,
            created_at: now,
            updated_at: now,
          },
        ],
      });

      const list = await service.listFeedback(owner, desireId);
      expect(list).toHaveLength(1);
      expect(list[0]?.feedbackType).toBe('irrelevant');
    });
  });
});
