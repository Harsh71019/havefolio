import { Test } from '@nestjs/testing';
import { describe, beforeEach, expect, it, jest } from '@jest/globals';
import type { PoolClient } from 'pg';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { TaxonomyRepository, type StoredEntry } from './taxonomy.repository.js';
import {
  DEFAULT_CATEGORIES,
  TaxonomyService,
  displayName,
  normalizedName,
} from './taxonomy.service.js';

const empty: TaxonomySnapshot = {
  categories: [],
  subcategories: [],
  tags: [],
  defaultsSeeded: false,
};
describe('taxonomy domain decisions', () => {
  let service: TaxonomyService;
  let rows: Record<string, StoredEntry[]>;
  const repository = {
    transaction:
      jest.fn<
        (owner: string, action: (client: PoolClient) => Promise<unknown>) => Promise<unknown>
      >(),
    entries: jest.fn<TaxonomyRepository['entries']>(),
    snapshot: jest.fn<TaxonomyRepository['snapshot']>(),
    create: jest.fn<TaxonomyRepository['create']>(),
    rename: jest.fn<TaxonomyRepository['rename']>(),
    retire: jest.fn<TaxonomyRepository['retire']>(),
    reorder: jest.fn<TaxonomyRepository['reorder']>(),
    countItems: jest.fn<TaxonomyRepository['countItems']>(),
    reassign: jest.fn<TaxonomyRepository['reassign']>(),
    remove: jest.fn<TaxonomyRepository['remove']>(),
    claimDefaults: jest.fn<TaxonomyRepository['claimDefaults']>(),
  };
  const client = {} as PoolClient;
  beforeEach(async () => {
    jest.resetAllMocks();
    rows = {
      categories: [{ id: 'root', name: 'Root', position: 4, retired_at: null }],
      subcategories: [],
      tags: [],
    };
    repository.transaction.mockImplementation((_owner, action) => action(client));
    repository.entries.mockImplementation((_client, _owner, kind) => Promise.resolve(rows[kind]!));
    repository.snapshot.mockResolvedValue(empty);
    repository.countItems.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [TaxonomyService, { provide: TaxonomyRepository, useValue: repository }],
    }).compile();
    service = module.get(TaxonomyService);
  });
  it('normalizes compatible Unicode and whitespace, preserves display case and rejects invisible names', () => {
    expect(displayName('  Ｂｏｏｋｓ\t &  Games  ', 120)).toBe('Books & Games');
    expect(normalizedName('Books  & Games')).toBe('books & games');
    for (const name of ['\u200b', '\u0000', ' ', 'a'.repeat(121)])
      expect(() => displayName(name, 120)).toThrow('INVALID_NAME');
  });
  it('scopes the whole snapshot to the authenticated owner', async () => {
    expect(await service.list('owner')).toBe(empty);
    expect(repository.transaction).toHaveBeenCalledWith('owner', expect.any(Function));
    expect(repository.snapshot).toHaveBeenCalledWith(client, 'owner');
  });
  it('rejects normalized collisions including retired entries and creates ordered custom entries', async () => {
    rows.categories![0]!.retired_at = new Date();
    await expect(service.create('owner', 'categories', ' rOoT ')).rejects.toThrow(
      'NAME_ALREADY_EXISTS',
    );
    await service.create('owner', 'categories', ' New ');
    expect(repository.create).toHaveBeenCalledWith(
      client,
      'owner',
      'categories',
      'New',
      5,
      undefined,
    );
  });
  it('accepts only an active same-owner root parent and enforces capacity', async () => {
    await expect(service.create('owner', 'subcategories', 'Child', 'foreign')).rejects.toThrow(
      'TAXONOMY_NOT_FOUND',
    );
    await service.create('owner', 'subcategories', 'Child', 'root');
    rows.categories![0]!.retired_at = new Date();
    await expect(service.create('owner', 'subcategories', 'Child', 'root')).rejects.toThrow(
      'PARENT_RETIRED',
    );
    rows.tags = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      name: String(index),
    }));
    await expect(service.create('owner', 'tags', 'Beyond')).rejects.toThrow(
      'TAXONOMY_LIMIT_EXCEEDED',
    );
  });
  it('rejects empty changes, renames without touching relationships and prevents restore under a retired parent', async () => {
    expect(() => service.update('owner', 'categories', 'root', {})).toThrow('NO_CHANGES');
    await service.update('owner', 'categories', 'root', { name: 'RENAMED', retired: true });
    expect(repository.rename).toHaveBeenCalledWith(
      client,
      'owner',
      'categories',
      'root',
      'RENAMED',
    );
    expect(repository.retire).toHaveBeenCalledWith(client, 'owner', 'categories', 'root', true);
    rows.subcategories = [
      { id: 'child', name: 'Child', category_id: 'root', retired_at: new Date() },
    ];
    rows.categories![0]!.retired_at = new Date();
    await expect(
      service.update('owner', 'subcategories', 'child', { retired: false }),
    ).rejects.toThrow('PARENT_RETIRED');
    expect(() => service.update('owner', 'tags', 'tag', { retired: true })).toThrow(
      'INVALID_OPERATION',
    );
  });
  it('checks complete sibling membership before reordering', async () => {
    await expect(service.reorder('owner', 'categories', [])).rejects.toThrow(
      'ORDER_CHANGED_RELOAD',
    );
    await expect(service.reorder('owner', 'categories', ['foreign'])).rejects.toThrow(
      'ORDER_CHANGED_RELOAD',
    );
    await service.reorder('owner', 'categories', ['root']);
    expect(repository.reorder).toHaveBeenCalledWith(client, 'owner', 'categories', ['root']);
  });
  it('requires active replacement and explicit tag/child removal consent before any destructive operation', async () => {
    repository.countItems.mockResolvedValue(1);
    await expect(service.remove('owner', 'categories', 'root')).rejects.toThrow(
      'REPLACEMENT_REQUIRED',
    );
    rows.categories!.push({ id: 'replacement', name: 'Replacement', retired_at: null });
    await service.remove('owner', 'categories', 'root', 'replacement');
    expect(repository.reassign).toHaveBeenCalledWith(
      client,
      'owner',
      'categories',
      'root',
      'replacement',
    );
    rows.tags = [{ id: 'tag', name: 'Tag' }];
    await expect(service.remove('owner', 'tags', 'tag')).rejects.toThrow(
      'CONFIRM_TAG_RELATIONSHIP_REMOVAL',
    );
    await service.remove('owner', 'tags', 'tag', undefined, true);
    expect(repository.remove).toHaveBeenCalledWith(client, 'owner', 'tags', 'tag');
    rows.subcategories = [{ id: 'child', name: 'Child', category_id: 'root' }];
    await expect(service.remove('owner', 'categories', 'root', 'replacement')).rejects.toThrow(
      'CONFIRM_SUBCATEGORY_REMOVAL',
    );
  });
  it('creates missing demo roots only after a once-per-owner seed claim; retries do not recreate them', async () => {
    repository.claimDefaults.mockResolvedValueOnce(true).mockResolvedValue(false);
    rows.categories!.push({ id: 'custom', name: DEFAULT_CATEGORIES[0]! });
    await service.seedDefaults('owner');
    expect(repository.create).toHaveBeenCalledTimes(DEFAULT_CATEGORIES.length - 1);
    expect(repository.create).toHaveBeenCalledWith(
      client,
      'owner',
      'categories',
      DEFAULT_CATEGORIES[1]!,
      5,
      undefined,
      true,
    );
    repository.create.mockClear();
    await service.seedDefaults('owner');
    expect(repository.create).not.toHaveBeenCalled();
  });
});
