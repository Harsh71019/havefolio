'use client';
import { useState } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Badge } from '@havefolio/ui/components/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { normalizeInventorySearch } from '@havefolio/contracts';
import type { InventoryQuery } from './inventory-source';
import type { InventoryPatch } from './inventory-query-state';
import { countActiveFilters } from './store-filters';

export interface StoreToolbarProps {
  query: InventoryQuery;
  onQueryChange: (patch: InventoryPatch) => void;
  onOpenMobileFilters?: () => void;
  className?: string;
}

export function StoreToolbar({
  query,
  onQueryChange,
  onOpenMobileFilters,
  className = '',
}: StoreToolbarProps): React.JSX.Element {
  const [prevQ, setPrevQ] = useState(query.q ?? '');
  const [searchValue, setSearchValue] = useState(query.q ?? '');
  if ((query.q ?? '') !== prevQ) {
    setPrevQ(query.q ?? '');
    setSearchValue(query.q ?? '');
  }

  const handleSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = searchValue.trim();
    const normalized = normalizeInventorySearch(trimmed);
    onQueryChange({ q: normalized || undefined });
  };

  const handleClearSearch = (): void => {
    setSearchValue('');
    onQueryChange({ q: undefined });
  };

  // Resolve current sort key for select
  const currentSortKey = query.sort
    ? `${query.sort}:${query.direction ?? (['newest', 'updated'].includes(query.sort) ? 'desc' : 'asc')}`
    : 'id:asc';

  const handleSortChange = (value: string): void => {
    const [sort, direction] = value.split(':') as [
      InventoryQuery['sort'],
      'asc' | 'desc' | undefined,
    ];
    if (sort === 'id') {
      onQueryChange({ sort: undefined, direction: undefined });
    } else if (sort === 'price') {
      onQueryChange({ sort, direction, currency: query.currency || 'INR' });
    } else {
      onQueryChange({ sort, direction });
    }
  };

  const activeFiltersCount = countActiveFilters(query);

  return (
    <div className={`space-y-3 ${className}`} data-testid="store-toolbar">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search Input Form */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
          <SearchIcon
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
          />
          <Input
            type="search"
            aria-label="Search your items"
            placeholder="Search items by name, brand, model, tags…"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-10 pr-9 h-11 w-full text-sm"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </form>

        {/* Right side controls: Mobile Filter button + Sort Dropdown + Density */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Mobile Filters Trigger */}
          {onOpenMobileFilters ? (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenMobileFilters}
              className="lg:hidden h-11 px-3.5 flex items-center gap-2"
              aria-label="Open filters"
            >
              <SlidersHorizontalIcon aria-hidden="true" className="size-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 ? (
                <Badge variant="secondary" className="px-1.5 py-0.2 text-xs font-semibold">
                  {activeFiltersCount}
                </Badge>
              ) : null}
            </Button>
          ) : null}

          {/* Sort By Select */}
          <div className="flex items-center gap-2">
            <span
              id="store-sort-label"
              className="hidden sm:inline text-xs font-medium text-muted-foreground whitespace-nowrap"
            >
              Sort by:
            </span>
            <Select value={currentSortKey} onValueChange={handleSortChange}>
              <SelectTrigger
                aria-labelledby="store-sort-label"
                className="h-11 w-44 sm:w-48 text-xs font-medium"
              >
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="id:asc">Default</SelectItem>
                <SelectItem value="newest:desc">Newest added</SelectItem>
                <SelectItem value="oldest:asc">Oldest added</SelectItem>
                <SelectItem value="price:asc">Price: Low to High</SelectItem>
                <SelectItem value="price:desc">Price: High to Low</SelectItem>
                <SelectItem value="name:asc">Name: A–Z</SelectItem>
                <SelectItem value="name:desc">Name: Z–A</SelectItem>
                <SelectItem value="updated:desc">Recently updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
