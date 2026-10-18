import { NotFoundException } from '@nestjs/common';
import { ItemsService } from '../items/items.service.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { TaxonomyService } from '../taxonomy/taxonomy.service.js';
import { DesiresService } from '../desires/desires.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { AllocationsService } from '../goals/allocations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuthService } from './auth.service.js';
import { ItemPhotosService } from '../media/item-photos.service.js';
import { ItemDocumentsService } from '../media/item-documents.service.js';

describe('Object-level authorization and indistinguishable 404 responses', () => {
  const ownerB = '22222222-2222-4222-8222-222222222222';
  const foreignId = '33333333-3333-4333-8333-333333333333';
  const nonexistentId = '44444444-4444-4444-8444-444444444444';

  describe('Items domain', () => {
    it('returns identical 404 ITEM_NOT_FOUND for foreign vs non-existent items', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const service = new ItemsService(mockRepo as never, {} as never, {} as never);
      await expect(service.read(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('ITEM_NOT_FOUND'),
      );
      await expect(service.read(ownerB, nonexistentId)).rejects.toThrow(
        new NotFoundException('ITEM_NOT_FOUND'),
      );
    });
  });

  describe('Merchants domain', () => {
    it('returns identical 404 MERCHANT_NOT_FOUND for foreign vs non-existent merchants', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const mockConfig = { get: () => 'synthetic-key' };
      const service = new MerchantsService(mockRepo as never, mockConfig as never);
      await expect(service.read(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('MERCHANT_NOT_FOUND'),
      );
      await expect(service.read(ownerB, nonexistentId)).rejects.toThrow(
        new NotFoundException('MERCHANT_NOT_FOUND'),
      );
    });
  });

  describe('Taxonomy domain', () => {
    it('returns identical 404 TAXONOMY_NOT_FOUND for foreign vs non-existent taxonomy entries', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) => fn({}),
        entries: () => Promise.resolve([]),
      };
      const service = new TaxonomyService(mockRepo as never);
      await expect(
        service.update(ownerB, 'categories', foreignId, { name: 'Renamed' }),
      ).rejects.toThrow(new NotFoundException('TAXONOMY_NOT_FOUND'));
      await expect(
        service.update(ownerB, 'categories', nonexistentId, { name: 'Renamed' }),
      ).rejects.toThrow(new NotFoundException('TAXONOMY_NOT_FOUND'));
    });
  });

  describe('Desires domain', () => {
    it('returns identical 404 DESIRE_NOT_FOUND for foreign vs non-existent desires', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const mockConfig = { get: () => 'synthetic-key' };
      const service = new DesiresService(
        mockRepo as never,
        {} as never,
        {} as never,
        mockConfig as never,
        {} as never,
      );
      await expect(service.get(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('DESIRE_NOT_FOUND'),
      );
      await expect(service.get(ownerB, nonexistentId)).rejects.toThrow(
        new NotFoundException('DESIRE_NOT_FOUND'),
      );
    });
  });

  describe('Goals domain', () => {
    it('returns identical 404 GOAL_NOT_FOUND for foreign vs non-existent goals', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const service = new GoalsService(mockRepo as never, { emit: () => undefined } as never);
      await expect(service.get(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('GOAL_NOT_FOUND'),
      );
      await expect(service.get(ownerB, nonexistentId)).rejects.toThrow(
        new NotFoundException('GOAL_NOT_FOUND'),
      );
    });
  });

  describe('Allocations domain', () => {
    it('returns identical 404 DESIRE_NOT_FOUND for foreign desire allocations', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rowCount: 0, rows: [] }),
          }),
      };
      const service = new AllocationsService(
        mockRepo as never,
        {} as never,
        { emit: () => undefined } as never,
      );
      await expect(service.state(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('DESIRE_NOT_FOUND'),
      );
    });
  });

  describe('Notifications domain', () => {
    it('returns identical 404 NOTIFICATION_NOT_FOUND for foreign vs non-existent notifications', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const service = new NotificationsService(
        mockRepo as never,
        { get: () => undefined } as never,
      );
      await expect(service.markRead(ownerB, foreignId)).rejects.toThrow(
        new NotFoundException('NOTIFICATION_NOT_FOUND'),
      );
      await expect(service.markRead(ownerB, nonexistentId)).rejects.toThrow(
        new NotFoundException('NOTIFICATION_NOT_FOUND'),
      );
    });
  });

  describe('Session revocation domain', () => {
    it('returns identical 404 SESSION_NOT_FOUND for foreign vs non-existent session IDs', async () => {
      const mockRepo = {
        revokeSession: () => Promise.resolve(false), // 0 rows updated
      };
      const service = new AuthService({} as never, mockRepo as never, {} as never, {} as never);
      const ownerContext = {
        id: ownerB,
        email: 'b@example.test',
        displayName: null,
        sessionId: 'curr-sess',
      };
      await expect(service.revokeSession(ownerContext, foreignId)).rejects.toThrow(
        new NotFoundException('SESSION_NOT_FOUND'),
      );
      await expect(service.revokeSession(ownerContext, nonexistentId)).rejects.toThrow(
        new NotFoundException('SESSION_NOT_FOUND'),
      );
    });
  });

  describe('Media attachments domain', () => {
    it('returns identical 404 ITEM_NOT_FOUND for media requests on foreign items', async () => {
      const mockRepo = {
        transaction: (_owner: string, fn: (c: unknown) => unknown) =>
          fn({
            query: () => Promise.resolve({ rows: [] }),
          }),
      };
      const photoService = new ItemPhotosService(
        mockRepo as never,
        { get: () => true } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(photoService.access(ownerB, foreignId, 'photo-1', 'display')).rejects.toThrow(
        new NotFoundException('ITEM_NOT_FOUND'),
      );

      const docService = new ItemDocumentsService(
        mockRepo as never,
        { get: () => true } as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(docService.download(ownerB, foreignId, 'doc-1')).rejects.toThrow(
        new NotFoundException('ITEM_NOT_FOUND'),
      );
    });
  });
});
