'use client';
import { Button } from '@havefolio/ui/components/button';
import { Badge } from '@havefolio/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { SlidersHorizontalIcon } from 'lucide-react';
import type { InventoryQuery } from './inventory-source';
import type { InventoryPatch } from './inventory-query-state';
import { countActiveFilters } from './store-filters';

export const sortOptions = [
  { value: 'id:asc', label: 'Category' },
  { value: 'newest:desc', label: 'Newest added' },
  { value: 'oldest:asc', label: 'Oldest added' },
  { value: 'price:asc', label: 'Price: low to high' },
  { value: 'price:desc', label: 'Price: high to low' },
  { value: 'name:asc', label: 'Name: A–Z' },
  { value: 'name:desc', label: 'Name: Z–A' },
  { value: 'updated:desc', label: 'Recently updated' },
] as const;

export function sortKey(query: InventoryQuery): string {
  if (!query.sort || query.sort === 'id') return 'id:asc';
  return `${query.sort}:${query.direction ?? (['newest', 'updated'].includes(query.sort) ? 'desc' : 'asc')}`;
}

export interface StoreToolbarProps {
  query: InventoryQuery;
  onQueryChange: (patch: InventoryPatch) => void;
  onOpenMobileFilters: () => void;
  /** The Filters button, where focus returns when the filters dialog closes. */
  filtersButtonRef?: React.Ref<HTMLButtonElement>;
  /** Result summary shown at the start of the row. */
  summary: string;
  /** Extra controls after sorting, such as view density. */
  children?: React.ReactNode;
}

export function StoreToolbar({
  query,
  onQueryChange,
  onOpenMobileFilters,
  filtersButtonRef,
  summary,
  children,
}: StoreToolbarProps): React.JSX.Element {
  const activeFilters = countActiveFilters(query);

  const handleSortChange = (value: string): void => {
    const [sort, direction] = value.split(':') as [
      NonNullable<InventoryQuery['sort']>,
      'asc' | 'desc',
    ];
    if (sort === 'id') onQueryChange({ sort: undefined, direction: undefined });
    // Price order compares one currency; keep the filtered one, otherwise rupees.
    else if (sort === 'price')
      onQueryChange({ sort, direction, currency: query.currency ?? 'INR' });
    else onQueryChange({ sort, direction });
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b pb-4"
      data-testid="store-toolbar"
    >
      <p className="text-sm text-muted-foreground">{summary}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={filtersButtonRef}
          type="button"
          variant="outline"
          onClick={onOpenMobileFilters}
          className="h-11 gap-2 px-3.5 xl:hidden"
        >
          <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
          Filters
          {activeFilters > 0 ? (
            <Badge
              variant="secondary"
              aria-label={`, ${activeFilters} active`}
              className="px-1.5 text-xs font-semibold"
            >
              {activeFilters}
            </Badge>
          ) : null}
        </Button>
        <Select value={sortKey(query)} onValueChange={handleSortChange}>
          <SelectTrigger aria-label="Sort by" className="min-w-52 text-sm data-[size=default]:h-11">
            <span aria-hidden="true" className="text-muted-foreground">
              Sort by:
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" position="popper">
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {children}
      </div>
    </div>
  );
}
