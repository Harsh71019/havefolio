import { describe, expect, it } from 'vitest';
import type { ItemEvent } from '@havefolio/contracts';
import {
  describeEvent,
  lifecycleChoices,
  pricePaid,
  purchaseDateText,
} from '../components/item-detail-presentation';
import { draftFrom, sectionChanges } from '../components/item-edit-dialog';
import {
  itemDetailHref,
  itemPhotosHref,
  safeReturnPath,
  storeReturnPath,
} from '../components/navigation-context';

const id = '00000000-0000-4000-a000-000000000001';
const cursor = `v1.${'a'.repeat(48)}`;

describe('safe return paths', () => {
  it.each([
    [undefined],
    [''],
    ['https://evil.example/store'],
    ['//evil.example/store'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['javascript:alert(1)'],
    ['/store\n/evil'],
    ['/settings/taxonomy'],
    ['/items/' + id],
    ['/store/../login'],
    ['store'],
    ['/%2F%2Fevil.example'],
  ])('falls back to My Store for %s', (raw) => {
    expect(safeReturnPath(raw)).toBe('/store');
  });

  it('keeps only the bounded inventory query and drops unknown or unsafe keys', () => {
    expect(
      safeReturnPath(
        `/store?q=Steel%20Kettle&sort=price&currency=INR&priceMin=100&after=${cursor}&next=https://evil.example&ownerId=x#frag`,
      ),
    ).toBe(`/store?q=steel+kettle&sort=price&currency=INR&priceMin=100&after=${cursor}`);
  });

  it('restores My Store search, filters, sort and page from the current location', () => {
    const back = storeReturnPath('?q=kettle&tagId=' + id + '&sort=updated&direction=desc');
    // Canonical PER-17 key order, so equivalent locations produce the same link.
    expect(back).toBe(`/store?q=kettle&sort=updated&direction=desc&tagId=${id}`);
    expect(storeReturnPath('')).toBe('/store');
  });

  it('carries the context into item and photo links only when it adds information', () => {
    expect(itemDetailHref(id)).toBe(`/items/${id}`);
    expect(itemDetailHref(id, '/store?q=kettle')).toBe(
      `/items/${id}?returnTo=${encodeURIComponent('/store?q=kettle')}`,
    );
    expect(itemDetailHref(id, 'https://evil.example')).toBe(`/items/${id}`);
    expect(itemPhotosHref(id, '/store?q=kettle')).toBe(
      `/items/${id}/photos?returnTo=${encodeURIComponent('/store?q=kettle')}`,
    );
  });
});

describe('purchase presentation', () => {
  it('keeps explicit zero distinct from unknown and gifts distinct from spending', () => {
    expect(
      pricePaid({ pricePaidMinor: '0', currency: 'INR', acquisitionType: 'bought' }).value,
    ).toBe('₹0 (nothing paid)');
    expect(
      pricePaid({ pricePaidMinor: null, currency: 'INR', acquisitionType: 'bought' }),
    ).toMatchObject({
      value: 'Not recorded',
      muted: true,
    });
    expect(
      pricePaid({ pricePaidMinor: null, currency: 'INR', acquisitionType: 'gift' }).value,
    ).toBe('Gift — nothing paid recorded');
    const paidGift = pricePaid({
      pricePaidMinor: '99950',
      currency: 'USD',
      acquisitionType: 'gift',
    });
    expect(paidGift.value).toBe('$999.50');
    expect(paidGift.note).toContain('towards a gift');
    expect(
      pricePaid({ pricePaidMinor: '125000', currency: 'INR', acquisitionType: 'bought' }).note,
    ).toContain('Not a current value');
  });

  it('never invents precision or uses today for an unknown date', () => {
    expect(purchaseDateText({ precision: 'exact', year: 2024, month: 2, day: 29 }).value).toBe(
      '29 February 2024',
    );
    expect(purchaseDateText({ precision: 'month', year: 2023, month: 7 })).toEqual({
      value: 'July 2023',
      note: 'Month only',
    });
    expect(purchaseDateText({ precision: 'year', year: 2018 })).toEqual({
      value: '2018',
      note: 'Year only',
    });
    const unknown = purchaseDateText({ precision: 'unknown' });
    expect(unknown.value).toBe('Not recorded');
    expect(unknown.value).not.toContain(String(new Date().getFullYear()));
  });
});

describe('edit payloads', () => {
  const base = {
    id,
    name: 'Kettle',
    ownershipStatus: 'owned' as const,
    currency: 'INR',
    pricePaidMinor: '1000',
    purchaseDate: { precision: 'year' as const, year: 2020, month: null, day: null },
    acquisitionType: 'bought' as const,
    condition: 'working' as const,
    useFrequency: 'often' as const,
    categoryId: null,
    subcategoryId: null,
    tagIds: [],
    brand: null,
    model: null,
    description: null,
    notes: null,
    specifications: { Size: { width: 10 } },
    revision: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    originalEntry: {},
    originalSource: 'manual',
  };

  it('sends only changed fields and never an ownership change', () => {
    const draft = { ...draftFrom(base), condition: 'broken' as const };
    expect(sectionChanges('state', draft, base)).toEqual({
      errors: {},
      changes: { condition: 'broken' },
    });
    expect(sectionChanges('basics', draftFrom(base), base).changes).toEqual({});
  });

  it('keeps unchanged structured specification values instead of stringifying them', () => {
    const draft = draftFrom(base);
    draft.notes = 'New note';
    expect(sectionChanges('notes', draft, base).changes).toEqual({ notes: 'New note' });
  });

  it('validates dates against their precision', () => {
    const draft = { ...draftFrom(base), precision: 'exact' as const, exactDate: '2023-02-29' };
    expect(sectionChanges('purchase', draft, base).errors.exactDate).toBeDefined();
    const month = { ...draftFrom(base), precision: 'month' as const, month: '', year: '2021' };
    expect(sectionChanges('purchase', month, base).errors.month).toBe('Choose the month.');
  });

  it('rejects duplicate specification names', () => {
    const draft = draftFrom(base);
    draft.specs = [
      { key: 'Colour', value: 'Red' },
      { key: 'colour', value: 'Blue' },
    ];
    expect(sectionChanges('notes', draft, base).errors['spec-1']).toContain('listed twice');
  });
});

describe('lifecycle rules', () => {
  it('offers use, repair and ownership changes for owned items', () => {
    expect(lifecycleChoices('owned').map((c) => c.key)).toEqual([
      'used',
      'repaired',
      'sold',
      'donated',
      'disposed',
      'lost',
      'returned',
    ]);
    for (const choice of lifecycleChoices('owned').filter((c) => c.confirm))
      expect(choice.effect).toContain('spending history stay exactly as recorded');
  });

  it.each(['sold', 'donated', 'disposed', 'lost', 'returned'] as const)(
    'offers only recovery for %s items',
    (status) => {
      const choices = lifecycleChoices(status);
      expect(choices).toHaveLength(1);
      expect(choices[0]).toMatchObject({ action: 'ownership_changed', ownershipStatus: 'owned' });
    },
  );

  it('never uses judgemental wording', () => {
    const text = lifecycleChoices('owned')
      .map((c) => `${c.label} ${c.title} ${c.effect}`)
      .join(' ');
    expect(text).not.toMatch(/regret|waste|unnecessary|mistake|bad purchase/i);
  });

  it('labels events from known metadata only', () => {
    const event = (
      eventType: ItemEvent['eventType'],
      metadata: Record<string, unknown>,
    ): ItemEvent => ({
      id,
      eventType,
      occurredAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata,
    });
    expect(describeEvent(event('ownership_changed', { from: 'lost', to: 'owned' }))).toMatchObject({
      title: 'Marked as owned again',
      detail: 'Previously lost',
    });
    expect(describeEvent(event('details_updated', { fields: ['secretKey', 'notes'] })).detail).toBe(
      'Updated notes',
    );
    expect(
      describeEvent(event('usage_changed', { from: '<b>', to: 'often' })).detail,
    ).toBeUndefined();
    expect(describeEvent(event('correction', {})).detail).toContain('kept as they were');
  });
});
