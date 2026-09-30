import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import {
  TaxonomyRepository,
  TAXONOMY_LIMIT,
  type StoredEntry,
  type TaxonomyKind,
} from './taxonomy.repository.js';
import type { UpdateTaxonomyDto } from './taxonomy.dto.js';

export const DEFAULT_CATEGORIES = [
  'Clothing & accessories',
  'Electronics',
  'Kitchen & dining',
  'Home & furniture',
  'Books & stationery',
  'Sports & hobbies',
];
export function displayName(value: string, max: number): string {
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > max || /\p{Cc}|\p{Cf}/u.test(name))
    throw new BadRequestException('INVALID_NAME');
  return name;
}
export const normalizedName = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const find = (rows: StoredEntry[], id: string): StoredEntry => {
  const entry = rows.find((row) => row.id === id);
  if (!entry) throw new NotFoundException('TAXONOMY_NOT_FOUND');
  return entry;
};
function uniqueName(rows: StoredEntry[], name: string, except?: string): void {
  if (rows.some((row) => row.id !== except && normalizedName(row.name) === normalizedName(name)))
    throw new ConflictException('NAME_ALREADY_EXISTS');
}

@Injectable()
export class TaxonomyService {
  constructor(private readonly repository: TaxonomyRepository) {}
  list(owner: string): Promise<TaxonomySnapshot> {
    return this.repository.transaction(owner, (client) => this.repository.snapshot(client, owner));
  }
  create(
    owner: string,
    kind: TaxonomyKind,
    value: string,
    parent?: string,
  ): Promise<TaxonomySnapshot> {
    const name = displayName(value, kind === 'tags' ? 80 : 120);
    return this.repository.transaction(owner, async (client) => {
      const rows = await this.repository.entries(client, owner, kind);
      if (rows.length >= TAXONOMY_LIMIT) throw new ConflictException('TAXONOMY_LIMIT_EXCEEDED');
      if (kind === 'subcategories') {
        if (!parent) throw new BadRequestException('CATEGORY_REQUIRED');
        const category = find(await this.repository.entries(client, owner, 'categories'), parent);
        if (category.retired_at) throw new ConflictException('PARENT_RETIRED');
      } else if (parent) throw new BadRequestException('INVALID_PARENT');
      const siblings = rows.filter((row) => kind !== 'subcategories' || row.category_id === parent);
      uniqueName(siblings, name);
      const position = Math.max(-1, ...siblings.map((row) => row.position ?? -1)) + 1;
      await this.repository.create(client, owner, kind, name, position, parent);
      return this.repository.snapshot(client, owner);
    });
  }
  update(
    owner: string,
    kind: TaxonomyKind,
    id: string,
    input: UpdateTaxonomyDto,
  ): Promise<TaxonomySnapshot> {
    if (input.name == null && input.retired == null) throw new BadRequestException('NO_CHANGES');
    if (kind === 'tags' && input.retired != null)
      throw new BadRequestException('INVALID_OPERATION');
    const name =
      input.name == null ? undefined : displayName(input.name, kind === 'tags' ? 80 : 120);
    return this.repository.transaction(owner, async (client) => {
      const rows = await this.repository.entries(client, owner, kind);
      const entry = find(rows, id);
      if (name) {
        uniqueName(
          rows.filter((row) => kind !== 'subcategories' || row.category_id === entry.category_id),
          name,
          id,
        );
        await this.repository.rename(client, owner, kind, id, name);
      }
      if (input.retired != null && kind !== 'tags') {
        if (!input.retired && kind === 'subcategories') {
          if (
            find(await this.repository.entries(client, owner, 'categories'), entry.category_id!)
              .retired_at
          )
            throw new ConflictException('PARENT_RETIRED');
        }
        await this.repository.retire(client, owner, kind, id, input.retired);
      }
      return this.repository.snapshot(client, owner);
    });
  }
  reorder(
    owner: string,
    kind: 'categories' | 'subcategories',
    ids: string[],
    parent?: string,
  ): Promise<TaxonomySnapshot> {
    return this.repository.transaction(owner, async (client) => {
      if (kind === 'categories' && parent) throw new BadRequestException('INVALID_PARENT');
      if (kind === 'subcategories') {
        if (!parent) throw new BadRequestException('CATEGORY_REQUIRED');
        find(await this.repository.entries(client, owner, 'categories'), parent);
      }
      const rows = (await this.repository.entries(client, owner, kind)).filter(
        (row) => kind === 'categories' || row.category_id === parent,
      );
      if (
        new Set(ids).size !== ids.length ||
        rows.length !== ids.length ||
        ids.some((id) => !rows.some((row) => row.id === id))
      )
        throw new ConflictException('ORDER_CHANGED_RELOAD');
      await this.repository.reorder(client, owner, kind, ids);
      return this.repository.snapshot(client, owner);
    });
  }
  remove(
    owner: string,
    kind: TaxonomyKind,
    id: string,
    replacement?: string,
    removeRelationships = false,
    removeSubcategories = false,
  ): Promise<TaxonomySnapshot> {
    return this.repository.transaction(owner, async (client) => {
      const rows = await this.repository.entries(client, owner, kind);
      const entry = find(rows, id);
      if (
        kind === 'categories' &&
        !removeSubcategories &&
        (await this.repository.entries(client, owner, 'subcategories')).some(
          (row) => row.category_id === id,
        )
      )
        throw new ConflictException('CONFIRM_SUBCATEGORY_REMOVAL');
      const count = await this.repository.countItems(client, owner, kind, id);
      if (kind === 'tags') {
        if (count && !removeRelationships)
          throw new ConflictException('CONFIRM_TAG_RELATIONSHIP_REMOVAL');
      } else {
        if (count && !replacement) throw new ConflictException('REPLACEMENT_REQUIRED');
        if (replacement) {
          if (replacement === id) throw new BadRequestException('INVALID_REPLACEMENT');
          const target = find(rows, replacement);
          if (
            target.retired_at ||
            (kind === 'subcategories' && target.category_id !== entry.category_id)
          )
            throw new ConflictException('INVALID_REPLACEMENT');
          if (
            kind === 'subcategories' &&
            find(await this.repository.entries(client, owner, 'categories'), entry.category_id!)
              .retired_at
          )
            throw new ConflictException('PARENT_RETIRED');
          await this.repository.reassign(client, owner, kind, id, replacement);
        }
      }
      await this.repository.remove(client, owner, kind, id);
      return this.repository.snapshot(client, owner);
    });
  }
  seedDefaults(owner: string): Promise<TaxonomySnapshot> {
    return this.repository.transaction(owner, async (client) => {
      if (await this.repository.claimDefaults(client, owner)) {
        const rows = await this.repository.entries(client, owner, 'categories');
        const missing = DEFAULT_CATEGORIES.filter(
          (name) => !rows.some((row) => normalizedName(row.name) === normalizedName(name)),
        );
        if (rows.length + missing.length > TAXONOMY_LIMIT)
          throw new ConflictException('TAXONOMY_LIMIT_EXCEEDED');
        let position = Math.max(-1, ...rows.map((row) => row.position ?? -1)) + 1;
        for (const name of missing)
          await this.repository.create(
            client,
            owner,
            'categories',
            name,
            position++,
            undefined,
            true,
          );
      }
      return this.repository.snapshot(client, owner);
    });
  }
}
