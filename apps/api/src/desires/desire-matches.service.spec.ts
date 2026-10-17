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
});
