'use client';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { formatMoney, parseMinorUnits } from '@havefolio/domain';
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

function priceLabel(query: InventoryQuery): string {
  const currency = query.currency ?? 'INR';
  const format = (minor: string): string => formatMoney(parseMinorUnits(minor, currency));
  if (query.priceMin !== undefined && query.priceMax !== undefined)
    return `${format(query.priceMin)} – ${format(query.priceMax)}`;
  if (query.priceMin !== undefined) return `${format(query.priceMin)} and above`;
  return `Up to ${format(query.priceMax!)}`;
}

export function StoreActiveChips({
  query,
  taxonomy,
  onQueryChange,
  onReset,
}: StoreActiveChipsProps): React.JSX.Element | null {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (query.q)
    chips.push({
      key: 'q',
      label: `“${query.q}”`,
      onRemove: () => onQueryChange({ q: undefined }),
    });

  const category = taxonomy?.categories.find((c) => c.id === query.categoryId);
  if (query.categoryId)
    chips.push({
      key: 'category',
      label: category?.name ?? 'Chosen category',
      onRemove: () => onQueryChange({ categoryId: undefined, subcategoryId: undefined }),
    });

  const subcategory = taxonomy?.subcategories.find((s) => s.id === query.subcategoryId);
  if (query.subcategoryId)
    chips.push({
      key: 'subcategory',
      label: subcategory?.name ?? 'Chosen subcategory',
      onRemove: () => onQueryChange({ subcategoryId: undefined }),
    });

  if (query.brand)
    chips.push({
      key: 'brand',
      label: query.brand,
      onRemove: () => onQueryChange({ brand: undefined }),
    });

  if (query.ownershipStatus)
    chips.push({
      key: 'status',
      label: statusLabel(query.ownershipStatus),
      onRemove: () => onQueryChange({ ownershipStatus: undefined }),
    });

  if (query.useFrequency)
    chips.push({
      key: 'frequency',
      label: `Used ${frequencyLabel(query.useFrequency).toLowerCase()}`,
      onRemove: () => onQueryChange({ useFrequency: undefined }),
    });

  if (query.priceMin !== undefined || query.priceMax !== undefined)
    chips.push({
      key: 'price',
      label: priceLabel(query),
      onRemove: () =>
        onQueryChange({
          priceMin: undefined,
          priceMax: undefined,
          priceKnown: undefined,
          currency: query.sort === 'price' ? query.currency : undefined,
        }),
    });

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-2"
      data-testid="store-active-chips"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          aria-label={`Remove filter: ${chip.label}`}
          title={chip.label}
          className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border bg-secondary/60 px-3 text-xs font-medium outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 xl:min-h-8"
        >
          <span className="max-w-60 min-w-0 truncate">{chip.label}</span>
          <XIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </button>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={onReset}
        className="h-11 px-2 text-xs text-muted-foreground hover:text-foreground xl:h-8"
      >
        Clear all
      </Button>
    </div>
  );
}
