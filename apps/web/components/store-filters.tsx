'use client';
import { useState } from 'react';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { itemStatuses, itemFrequencies } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Badge } from '@havefolio/ui/components/badge';
import { Separator } from '@havefolio/ui/components/separator';
import { statusLabel, frequencyLabel } from './item-presentation';
import type { InventoryQuery } from './inventory-source';
import type { InventoryPatch } from './inventory-query-state';
import { RotateCcwIcon, CheckIcon } from 'lucide-react';

export interface StoreFiltersProps {
  query: InventoryQuery;
  taxonomy: TaxonomySnapshot | undefined;
  onQueryChange: (patch: InventoryPatch) => void;
  onReset: () => void;
  className?: string;
  isMobileModal?: boolean;
  onCloseMobile?: () => void;
}

export function countActiveFilters(query: InventoryQuery): number {
  let count = 0;
  if (query.q) count++;
  if (query.categoryId) count++;
  if (query.subcategoryId) count++;
  if (query.ownershipStatus) count++;
  if (query.useFrequency) count++;
  if (query.priceMin !== undefined || query.priceMax !== undefined) count++;
  if (query.priceKnown && query.priceKnown !== 'include') count++;
  if (query.dateKnown && query.dateKnown !== 'include') count++;
  if (query.sort && query.sort !== 'id') count++;
  return count;
}

export function StoreFilters({
  query,
  taxonomy,
  onQueryChange,
  onReset,
  className = '',
  isMobileModal = false,
  onCloseMobile,
}: StoreFiltersProps): React.JSX.Element {
  const activeCount = countActiveFilters(query);

  // Local price input state for form submission or enter
  const [minRupees, setMinRupees] = useState(() =>
    query.priceMin ? String(Math.floor(Number(query.priceMin) / 100)) : '',
  );
  const [maxRupees, setMaxRupees] = useState(() =>
    query.priceMax ? String(Math.floor(Number(query.priceMax) / 100)) : '',
  );
  const [priceError, setPriceError] = useState('');

  const handleApplyPrice = (e?: React.FormEvent): void => {
    if (e) e.preventDefault();
    const minVal = minRupees.trim() ? Number(minRupees.trim()) : undefined;
    const maxVal = maxRupees.trim() ? Number(maxRupees.trim()) : undefined;

    if (minVal !== undefined && (isNaN(minVal) || minVal < 0)) {
      setPriceError('Minimum price must be a valid non-negative number.');
      return;
    }
    if (maxVal !== undefined && (isNaN(maxVal) || maxVal < 0)) {
      setPriceError('Maximum price must be a valid non-negative number.');
      return;
    }
    if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
      setPriceError('Minimum price cannot exceed maximum price.');
      return;
    }

    setPriceError('');
    onQueryChange({
      priceMin: minVal !== undefined ? String(Math.round(minVal * 100)) : undefined,
      priceMax: maxVal !== undefined ? String(Math.round(maxVal * 100)) : undefined,
      currency: minVal !== undefined || maxVal !== undefined ? query.currency || 'INR' : undefined,
    });
  };

  const handlePricePreset = (min?: number, max?: number): void => {
    setMinRupees(min !== undefined ? String(min) : '');
    setMaxRupees(max !== undefined ? String(max) : '');
    setPriceError('');
    onQueryChange({
      priceMin: min !== undefined ? String(Math.round(min * 100)) : undefined,
      priceMax: max !== undefined ? String(Math.round(max * 100)) : undefined,
      currency: 'INR',
    });
  };

  const categories = taxonomy?.categories ?? [];
  const subcategories = taxonomy?.subcategories ?? [];
  const selectedCategorySubcategories = query.categoryId
    ? subcategories.filter((s) => s.categoryId === query.categoryId && !s.retiredAt)
    : [];

  return (
    <div className={`space-y-6 ${className}`} data-testid="store-filters">
      {/* Filters Header */}
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-wider uppercase text-foreground">
            Filters
          </span>
          {activeCount > 0 ? (
            <Badge variant="secondary" className="px-1.5 py-0.5 text-xs font-semibold">
              {activeCount}
            </Badge>
          ) : null}
        </div>
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 px-2 text-xs font-semibold text-primary hover:text-primary/80"
          >
            <RotateCcwIcon aria-hidden="true" className="mr-1 size-3" />
            Clear all
          </Button>
        ) : null}
      </div>

      {/* Categories Filter */}
      {categories.length > 0 ? (
        <fieldset className="space-y-3">
          <legend className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
            Categories
          </legend>
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => onQueryChange({ categoryId: undefined, subcategoryId: undefined })}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                !query.categoryId
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span>All categories</span>
              {!query.categoryId ? (
                <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
            </button>
            {categories
              .filter((c) => !c.retiredAt)
              .map((cat) => {
                const isSelected = query.categoryId === cat.id;
                return (
                  <div key={cat.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() =>
                        onQueryChange({
                          categoryId: isSelected ? undefined : cat.id,
                          subcategoryId: undefined,
                        })
                      }
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-secondary font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      <span className="truncate">{cat.name}</span>
                      <div className="flex items-center gap-1.5">
                        {cat.itemCount !== null ? (
                          <span className="text-xs text-muted-foreground">({cat.itemCount})</span>
                        ) : null}
                        {isSelected ? (
                          <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        ) : null}
                      </div>
                    </button>

                    {/* Subcategories if category selected */}
                    {isSelected && selectedCategorySubcategories.length > 0 ? (
                      <div className="ml-3 pl-2 border-l space-y-1 py-1">
                        <button
                          type="button"
                          onClick={() => onQueryChange({ subcategoryId: undefined })}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${
                            !query.subcategoryId
                              ? 'bg-secondary/70 font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <span>All {cat.name}</span>
                          {!query.subcategoryId ? (
                            <CheckIcon aria-hidden="true" className="size-3 shrink-0" />
                          ) : null}
                        </button>
                        {selectedCategorySubcategories.map((sub) => {
                          const isSubSelected = query.subcategoryId === sub.id;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() =>
                                onQueryChange({
                                  subcategoryId: isSubSelected ? undefined : sub.id,
                                })
                              }
                              className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                isSubSelected
                                  ? 'bg-secondary/70 font-medium text-foreground'
                                  : 'text-muted-foreground hover:bg-muted'
                              }`}
                            >
                              <span className="truncate">{sub.name}</span>
                              <div className="flex items-center gap-1">
                                {sub.itemCount !== null ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    ({sub.itemCount})
                                  </span>
                                ) : null}
                                {isSubSelected ? (
                                  <CheckIcon
                                    aria-hidden="true"
                                    className="size-3 shrink-0 text-primary"
                                  />
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </fieldset>
      ) : null}

      <Separator />

      {/* Ownership Status */}
      <fieldset className="space-y-3">
        <legend className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
          Ownership Status
        </legend>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onQueryChange({ ownershipStatus: undefined })}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              !query.ownershipStatus
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <span>All statuses</span>
            {!query.ownershipStatus ? (
              <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : null}
          </button>
          {itemStatuses.map((status) => {
            const isSelected = query.ownershipStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => onQueryChange({ ownershipStatus: isSelected ? undefined : status })}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>{statusLabel(status)}</span>
                {isSelected ? (
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Separator />

      {/* Use Frequency */}
      <fieldset className="space-y-3">
        <legend className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
          Use Frequency
        </legend>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onQueryChange({ useFrequency: undefined })}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              !query.useFrequency
                ? 'bg-secondary font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <span>All frequencies</span>
            {!query.useFrequency ? (
              <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
            ) : null}
          </button>
          {itemFrequencies.map((freq) => {
            const isSelected = query.useFrequency === freq;
            return (
              <button
                key={freq}
                type="button"
                onClick={() => onQueryChange({ useFrequency: isSelected ? undefined : freq })}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span>{frequencyLabel(freq)}</span>
                {isSelected ? (
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Separator />

      {/* Price Range */}
      <fieldset className="space-y-3">
        <legend className="text-xs font-bold tracking-wider uppercase text-muted-foreground">
          Price Range (₹)
        </legend>
        <form onSubmit={handleApplyPrice} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="price-min" className="text-xs text-muted-foreground">
                Min
              </Label>
              <div className="relative mt-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="price-min"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={minRupees}
                  onChange={(e) => setMinRupees(e.target.value)}
                  className="pl-6 h-9 text-xs"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="price-max" className="text-xs text-muted-foreground">
                Max
              </Label>
              <div className="relative mt-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="price-max"
                  type="number"
                  min="0"
                  placeholder="Any"
                  value={maxRupees}
                  onChange={(e) => setMaxRupees(e.target.value)}
                  className="pl-6 h-9 text-xs"
                />
              </div>
            </div>
          </div>
          {priceError ? <p className="text-xs text-destructive">{priceError}</p> : null}
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" variant="outline" className="h-8 flex-1 text-xs">
              Apply
            </Button>
            {query.priceMin !== undefined || query.priceMax !== undefined ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMinRupees('');
                  setMaxRupees('');
                  setPriceError('');
                  onQueryChange({
                    priceMin: undefined,
                    priceMax: undefined,
                    currency: query.sort === 'price' ? query.currency : undefined,
                  });
                }}
                className="h-8 px-2 text-xs text-muted-foreground"
              >
                Reset
              </Button>
            ) : null}
          </div>
        </form>

        {/* Quick price presets */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handlePricePreset(undefined, 500)}
            className="h-6 px-2 text-[11px] rounded-full border border-border"
          >
            Under ₹500
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handlePricePreset(500, 2000)}
            className="h-6 px-2 text-[11px] rounded-full border border-border"
          >
            ₹500–₹2k
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handlePricePreset(2000, 10000)}
            className="h-6 px-2 text-[11px] rounded-full border border-border"
          >
            ₹2k–₹10k
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handlePricePreset(10000, undefined)}
            className="h-6 px-2 text-[11px] rounded-full border border-border"
          >
            ₹10k+
          </Button>
        </div>
      </fieldset>

      {/* Done button on mobile drawer */}
      {isMobileModal && onCloseMobile ? (
        <div className="pt-4 border-t">
          <Button className="w-full h-11" onClick={onCloseMobile}>
            View items
          </Button>
        </div>
      ) : null}
    </div>
  );
}
