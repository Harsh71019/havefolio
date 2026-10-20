'use client';
import { useState } from 'react';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { currencyCodes } from '@havefolio/domain';
import { Button } from '@havefolio/ui/components/button';
import { DateInput } from '@havefolio/ui/components/havefolio/date-input';
import { Label } from '@havefolio/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import type { InsightsPatch, InsightsQuery } from './spending-query';

export function SpendingFilters({
  query,
  taxonomy,
  change,
  reset,
}: {
  query: InsightsQuery;
  taxonomy?: TaxonomySnapshot | undefined;
  change: (patch: InsightsPatch) => void;
  reset: () => void;
}): React.JSX.Element {
  const [dateError, setDateError] = useState('');
  const select = (
    id: string,
    label: string,
    value: string | undefined,
    choices: { value: string; label: string }[],
    onChange: (v: string) => void,
    disabled = false,
  ): React.JSX.Element => (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || 'all'} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="min-h-11 w-full min-w-0 [&>span]:truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="motion-reduce:animate-none motion-reduce:transition-none">
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const named = (rows: TaxonomySnapshot['categories']): { value: string; label: string }[] =>
    rows.map((row) => ({ value: row.id, label: row.name + (row.retiredAt ? ' (retired)' : '') }));
  return (
    <form
      className="space-y-5 rounded-lg border p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const from = values.get('purchasedFrom');
        const to = values.get('purchasedTo');
        if (typeof from !== 'string' || typeof to !== 'string') return;
        if ([from, to].some((value) => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
          setDateError('Enter real dates as DD/MM/YYYY.');
          return;
        }
        if (from && to && from > to) {
          setDateError('The From date must be on or before the To date.');
          return;
        }
        setDateError('');
        change({ purchasedFrom: from || undefined, purchasedTo: to || undefined });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {select(
          'spending-scope',
          'Ownership scope',
          query.scope,
          [
            { value: 'current-owned', label: 'Currently owned' },
            { value: 'all-history', label: 'All recorded history' },
          ],
          (v) => change({ scope: v as InsightsQuery['scope'] }),
        )}
        {select(
          'spending-currency',
          'Currency',
          query.currency,
          [
            { value: 'all', label: 'All currencies, shown separately' },
            ...currencyCodes.map((c) => ({ value: c, label: c })),
          ],
          (v) => change({ currency: v === 'all' ? undefined : v }),
        )}
        {select(
          'spending-grouping',
          'Breakdown',
          query.grouping,
          [
            { value: 'overall', label: 'Summary only' },
            { value: 'category', label: 'Category totals' },
            { value: 'subcategory', label: 'Subcategory totals' },
            { value: 'merchant', label: 'Merchant totals' },
            { value: 'year', label: 'Yearly trend' },
          ],
          (v) => change({ grouping: v as InsightsQuery['grouping'] }),
        )}
        {select(
          'spending-category',
          'Category',
          query.categoryId,
          [{ value: 'all', label: 'All categories' }, ...named(taxonomy?.categories ?? [])],
          (v) => change({ categoryId: v === 'all' ? undefined : v }),
          !taxonomy,
        )}
        {select(
          'spending-subcategory',
          'Subcategory',
          query.subcategoryId,
          [
            { value: 'all', label: 'All subcategories' },
            ...named(
              taxonomy?.subcategories.filter((s) => s.categoryId === query.categoryId) ?? [],
            ),
          ],
          (v) => change({ subcategoryId: v === 'all' ? undefined : v }),
          !taxonomy || !query.categoryId,
        )}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {query.scope === 'current-owned'
          ? 'Currently owned includes only items you still own.'
          : 'All recorded history includes owned, sold, donated, disposed, lost and returned items.'}{' '}
        Refunds stay with the original purchase period.
      </p>
      {dateError ? (
        <p role="alert" className="text-sm text-destructive">
          {dateError}
        </p>
      ) : null}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Purchase-date range (optional, inclusive)</legend>
        <div className="grid items-end gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="spending-from">From</Label>
            <DateInput
              key={`from-${query.purchasedFrom ?? ''}`}
              id="spending-from"
              name="purchasedFrom"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={query.purchasedFrom ?? ''}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spending-to">To</Label>
            <DateInput
              key={`to-${query.purchasedTo ?? ''}`}
              id="spending-to"
              name="purchasedTo"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={query.purchasedTo ?? ''}
              className="min-h-11"
            />
          </div>
          <Button type="submit" variant="outline" className="min-h-11">
            Apply date range
          </Button>
        </div>
      </fieldset>
      <Button type="button" variant="ghost" onClick={reset} className="min-h-11">
        Reset filters
      </Button>
    </form>
  );
}
