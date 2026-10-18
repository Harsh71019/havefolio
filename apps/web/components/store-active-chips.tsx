'use client';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { XIcon } from 'lucide-react';
import type { InventoryQuery } from './inventory-source';
import type { InventoryPatch } from './inventory-query-state';
import { statusLabel, frequencyLabel } from './item-presentation';

export interface StoreActiveChipsProps {
  query: InventoryQuery;
  taxonomy: TaxonomySnapshot | undefined;
  onQueryChange: (patch: InventoryPatch) => void;
  onReset: () => void;
}

const sortNames: Record<string, string> = {
  'id:asc': 'Default',
  'newest:desc': 'Newest',
  'oldest:asc': 'Oldest',
  'price:asc': 'Price: Low to High',
  'price:desc': 'Price: High to Low',
  'name:asc': 'Name: A–Z',
  'name:desc': 'Name: Z–A',
  'updated:desc': 'Recently updated',
};

export function StoreActiveChips({
  query,
  taxonomy,
  onQueryChange,
  onReset,
}: StoreActiveChipsProps): React.JSX.Element | null {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (query.q) {
    chips.push({
      key: 'q',
      label: `“${query.q}”`,
      onRemove: () => onQueryChange({ q: undefined }),
    });
  }

  if (query.categoryId && taxonomy) {
    const cat = taxonomy.categories.find((c) => c.id === query.categoryId);
    if (cat) {
      chips.push({
        key: 'category',
        label: `Category: ${cat.name}`,
        onRemove: () => onQueryChange({ categoryId: undefined, subcategoryId: undefined }),
      });
    }
  }

  if (query.subcategoryId && taxonomy) {
    const sub = taxonomy.subcategories.find((s) => s.id === query.subcategoryId);
    if (sub) {
      chips.push({
        key: 'subcategory',
        label: `Subcategory: ${sub.name}`,
        onRemove: () => onQueryChange({ subcategoryId: undefined }),
      });
    }
  }

  if (query.ownershipStatus) {
    chips.push({
      key: 'status',
      label: `Status: ${statusLabel(query.ownershipStatus)}`,
      onRemove: () => onQueryChange({ ownershipStatus: undefined }),
    });
  }

  if (query.useFrequency) {
    chips.push({
      key: 'frequency',
      label: `Frequency: ${frequencyLabel(query.useFrequency)}`,
      onRemove: () => onQueryChange({ useFrequency: undefined }),
    });
  }

  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    const min = query.priceMin ? `₹${Math.floor(Number(query.priceMin) / 100)}` : '₹0';
    const max = query.priceMax ? `₹${Math.floor(Number(query.priceMax) / 100)}` : 'Any';
    chips.push({
      key: 'price',
      label: `Price: ${min} – ${max}`,
      onRemove: () =>
        onQueryChange({
          priceMin: undefined,
          priceMax: undefined,
          currency: query.sort === 'price' ? query.currency : undefined,
        }),
    });
  }

  if (query.sort && query.sort !== 'id') {
    const sortKey = `${query.sort}:${query.direction ?? (['newest', 'updated'].includes(query.sort) ? 'desc' : 'asc')}`;
    chips.push({
      key: 'sort',
      label: `Sort: ${sortNames[sortKey] || query.sort}`,
      onRemove: () => onQueryChange({ sort: undefined, direction: undefined }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2 pt-1"
      data-testid="store-active-chips"
    >
      <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 hover:bg-secondary px-3 py-1 text-xs font-medium text-foreground transition-colors"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="rounded-full p-0.5 hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground"
          >
            <XIcon aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </Button>
    </div>
  );
}
