'use client';
import { useId, useState } from 'react';
import type { InventoryFacets, TaxonomySnapshot } from '@havefolio/contracts';
import { itemStatuses, itemFrequencies } from '@havefolio/contracts';
import { currencyMinorDigits, formatMoney, parseMinorUnits } from '@havefolio/domain';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Slider } from '@havefolio/ui/components/slider';
import { SearchIcon, XIcon } from 'lucide-react';
import { statusLabel, frequencyLabel } from './item-presentation';
import type { InventoryQuery } from './inventory-source';
import type { InventoryPatch } from './inventory-query-state';

export interface StoreFiltersProps {
  query: InventoryQuery;
  taxonomy: TaxonomySnapshot | undefined;
  /** Counts per option; without them every option is offered without a count. */
  facets: InventoryFacets | undefined;
  onQueryChange: (patch: InventoryPatch) => void;
  onReset: () => void;
  className?: string;
  isMobileModal?: boolean;
  onCloseMobile?: () => void;
}

/** Filters narrowing the results; sorting only reorders them and is not counted. */
export function countActiveFilters(query: InventoryQuery): number {
  let count = 0;
  if (query.q) count++;
  if (query.categoryId) count++;
  if (query.subcategoryId) count++;
  if (query.brand) count++;
  if (query.ownershipStatus) count++;
  if (query.useFrequency) count++;
  if (query.priceMin !== undefined || query.priceMax !== undefined) count++;
  else if (query.priceKnown && query.priceKnown !== 'include') count++;
  if (query.dateKnown && query.dateKnown !== 'include') count++;
  return count;
}

const all = '__all';
const brandPreview = 8;

function countOf<T>(list: { value: T; count: number }[] | undefined, value: T): number | null {
  if (!list) return null;
  return list.find((entry) => entry.value === value)?.count ?? 0;
}

/** Offer options that would return something, plus whatever is already chosen. */
function offered<T extends string>(
  options: readonly T[],
  list: { value: T; count: number }[] | undefined,
  selected: T | undefined,
): T[] {
  if (!list) return [...options];
  return options.filter((option) => option === selected || (countOf(list, option) ?? 0) > 0);
}

function FilterSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 border-b py-5 last:border-b-0">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span id={id} className="text-xs font-semibold tracking-wider text-foreground uppercase">
          {title}
        </span>
        {action}
      </div>
      {children}
    </section>
  );
}

function OptionList({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; count: number | null; nested?: boolean }[];
}): React.JSX.Element {
  const id = useId();
  return (
    <RadioGroup aria-label={label} value={value} onValueChange={onChange} className="gap-0">
      {options.map((option, index) => (
        <Label
          key={option.value}
          htmlFor={`${id}-${index}`}
          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md text-sm font-normal xl:min-h-8 ${option.nested ? 'pl-6' : ''}`}
        >
          <RadioGroupItem id={`${id}-${index}`} value={option.value} />
          <span className="min-w-0 truncate">{option.label}</span>
          {option.count !== null ? (
            <>
              {' '}
              <span className="text-xs text-muted-foreground tabular-nums">({option.count})</span>
            </>
          ) : null}
        </Label>
      ))}
    </RadioGroup>
  );
}

function BrandFilter({
  query,
  facets,
  onQueryChange,
}: Pick<StoreFiltersProps, 'query' | 'facets' | 'onQueryChange'>): React.JSX.Element | null {
  const [searching, setSearching] = useState(false);
  const [needle, setNeedle] = useState('');
  const [expanded, setExpanded] = useState(false);
  const brands = facets?.brands ?? [];
  const selected = query.brand;
  const selectedKey = selected?.toLowerCase();
  if (!brands.length && !selected) return null;

  const matching = needle.trim()
    ? brands.filter((b) => b.value.toLowerCase().includes(needle.trim().toLowerCase()))
    : brands;
  const visible = expanded || needle.trim() ? matching : matching.slice(0, brandPreview);
  // Keep the chosen brand reachable even when it falls outside the preview.
  if (selected && !visible.some((b) => b.value.toLowerCase() === selectedKey))
    visible.unshift(
      brands.find((b) => b.value.toLowerCase() === selectedKey) ?? { value: selected, count: 0 },
    );
  const hidden = matching.length - visible.length;

  return (
    <FilterSection
      title="Brand"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={searching ? 'Close brand search' : 'Search brands'}
          aria-expanded={searching}
          onClick={() => {
            setSearching((open) => !open);
            setNeedle('');
          }}
          className="size-11 rounded-full xl:size-8"
        >
          {searching ? <XIcon aria-hidden="true" /> : <SearchIcon aria-hidden="true" />}
        </Button>
      }
    >
      {searching ? (
        <Input
          type="search"
          aria-label="Search brands"
          placeholder="Search brands"
          autoFocus
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          className="h-11 text-sm xl:h-9"
        />
      ) : null}
      {visible.length ? (
        <OptionList
          label="Brand"
          value={visible.find((b) => b.value.toLowerCase() === selectedKey)?.value ?? all}
          onChange={(value) => onQueryChange({ brand: value === all ? undefined : value })}
          options={[
            { value: all, label: 'All brands', count: null },
            ...visible.map((b) => ({ value: b.value, label: b.value, count: b.count })),
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No brand matches “{needle.trim()}”.</p>
      )}
      {hidden > 0 ? (
        <Button
          type="button"
          variant="link"
          onClick={() => setExpanded(true)}
          className="h-11 px-0 text-sm xl:h-8"
        >
          + {hidden} more
        </Button>
      ) : null}
      {facets?.brandsTruncated && expanded ? (
        <p className="text-xs text-muted-foreground">
          Showing the 100 most common brands. Search above to find any brand by name.
        </p>
      ) : null}
    </FilterSection>
  );
}

/** A step that keeps the slider to roughly a hundred positions. */
function niceStep(span: number): number {
  if (span <= 100) return 1;
  const raw = span / 100;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw)!;
}

function PriceFilter({
  query,
  facets,
  onQueryChange,
}: Pick<StoreFiltersProps, 'query' | 'facets' | 'onQueryChange'>): React.JSX.Element | null {
  const prices = facets?.prices ?? [];
  const range = prices.find((p) => p.currency === query.currency) ?? prices[0];
  const active = query.priceMin !== undefined || query.priceMax !== undefined;
  if (!range) return null;
  const { currency } = range;
  const scale = 10 ** currencyMinorDigits(currency);
  const lowest = Number(range.minMinor) / scale;
  const highest = Number(range.maxMinor) / scale;
  const step = niceStep(highest - lowest);
  const floor = Math.floor(lowest / step) * step;
  const ceiling = Math.max(Math.ceil(highest / step) * step, floor + step);
  const chosen = (minor: string | undefined, fallback: number): number =>
    minor === undefined ? fallback : Math.min(Math.max(Number(minor) / scale, floor), ceiling);
  return (
    <FilterSection title="Price paid">
      <PriceSlider
        // Re-seed the thumbs whenever the applied range or the bounds change.
        key={`${currency}:${floor}:${ceiling}:${query.priceMin}:${query.priceMax}`}
        currency={currency}
        floor={floor}
        ceiling={ceiling}
        step={step}
        initial={[chosen(query.priceMin, floor), chosen(query.priceMax, ceiling)]}
        onCommit={([low, high]) => {
          const toMinor = (major: number): string => String(BigInt(Math.round(major * scale)));
          const open = low <= floor && high >= ceiling;
          onQueryChange({
            priceMin: open || low <= floor ? undefined : toMinor(low),
            priceMax: open || high >= ceiling ? undefined : toMinor(high),
            currency: open && query.sort !== 'price' ? undefined : currency,
            // A chosen range means a known price inside it, not unpriced items too.
            priceKnown: open ? undefined : 'exclude',
          });
        }}
      />
      {prices.length > 1 ? (
        <p className="text-xs text-muted-foreground">Only {currency} prices are compared here.</p>
      ) : null}
      {active ? (
        <Button
          type="button"
          variant="link"
          className="h-11 px-0 text-sm xl:h-8"
          onClick={() =>
            onQueryChange({
              priceMin: undefined,
              priceMax: undefined,
              priceKnown: undefined,
              currency: query.sort === 'price' ? query.currency : undefined,
            })
          }
        >
          Any price
        </Button>
      ) : null}
    </FilterSection>
  );
}

function PriceSlider({
  currency,
  floor,
  ceiling,
  step,
  initial,
  onCommit,
}: {
  currency: string;
  floor: number;
  ceiling: number;
  step: number;
  initial: [number, number];
  onCommit: (value: [number, number]) => void;
}): React.JSX.Element {
  const [value, setValue] = useState<[number, number]>(initial);
  const scale = 10 ** currencyMinorDigits(currency);
  const format = (major: number): string =>
    formatMoney(parseMinorUnits(String(Math.round(major * scale)), currency));
  const label = `${format(value[0])} – ${format(value[1])}${value[1] >= ceiling ? '+' : ''}`;
  return (
    <div className="space-y-4 px-1">
      <Slider
        min={floor}
        max={ceiling}
        step={step}
        minStepsBetweenThumbs={0}
        value={value}
        thumbLabels={['Lowest price', 'Highest price']}
        onValueChange={(next) => setValue([next[0]!, next[1]!])}
        onValueCommit={(next) => onCommit([next[0]!, next[1]!])}
        className="py-3"
      />
      <p className="text-sm tabular-nums" aria-live="polite">
        {label}
      </p>
    </div>
  );
}

export function StoreFilters({
  query,
  taxonomy,
  facets,
  onQueryChange,
  onReset,
  className = '',
  isMobileModal = false,
  onCloseMobile,
}: StoreFiltersProps): React.JSX.Element {
  const activeCount = countActiveFilters(query);
  const categories = (taxonomy?.categories ?? []).filter(
    (c) => !c.retiredAt || c.id === query.categoryId,
  );
  const categoryCount = (id: string, fallback: number | null): number | null =>
    facets ? countOf(facets.categories, id) : fallback;
  const subcategoryCount = (id: string, fallback: number | null): number | null =>
    facets ? countOf(facets.subcategories, id) : fallback;
  const visibleCategories = categories.filter(
    (c) => c.id === query.categoryId || (categoryCount(c.id, c.itemCount) ?? 1) > 0,
  );
  const subcategories = query.categoryId
    ? (taxonomy?.subcategories ?? []).filter(
        (s) =>
          s.categoryId === query.categoryId &&
          (s.id === query.subcategoryId ||
            (!s.retiredAt && (subcategoryCount(s.id, s.itemCount) ?? 1) > 0)),
      )
    : [];

  const statuses = offered(itemStatuses, facets?.ownershipStatus, query.ownershipStatus);
  const frequencies = offered(itemFrequencies, facets?.useFrequency, query.useFrequency);

  return (
    <div className={className} data-testid="store-filters">
      <div className="flex min-h-11 items-center justify-between gap-2 border-b pb-3">
        <span className="text-sm font-bold tracking-wider uppercase">Filters</span>
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            className="h-11 px-2 text-xs font-semibold tracking-wide uppercase xl:h-8"
          >
            Clear all
          </Button>
        ) : null}
      </div>

      {visibleCategories.length ? (
        <FilterSection title="Categories">
          <OptionList
            label="Category"
            value={query.subcategoryId ? `sub:${query.subcategoryId}` : (query.categoryId ?? all)}
            onChange={(value) => {
              if (value === all) onQueryChange({ categoryId: undefined, subcategoryId: undefined });
              else if (value.startsWith('sub:')) onQueryChange({ subcategoryId: value.slice(4) });
              else onQueryChange({ categoryId: value, subcategoryId: undefined });
            }}
            options={[
              { value: all, label: 'All categories', count: null },
              ...visibleCategories.flatMap((category) => [
                {
                  value: category.id,
                  label:
                    subcategories.length && category.id === query.categoryId
                      ? `All ${category.name}`
                      : category.name,
                  count: categoryCount(category.id, category.itemCount),
                },
                ...(category.id === query.categoryId
                  ? subcategories.map((sub) => ({
                      value: `sub:${sub.id}`,
                      label: sub.name,
                      count: subcategoryCount(sub.id, sub.itemCount),
                      nested: true,
                    }))
                  : []),
              ]),
            ]}
          />
        </FilterSection>
      ) : null}

      <BrandFilter query={query} facets={facets} onQueryChange={onQueryChange} />

      <PriceFilter query={query} facets={facets} onQueryChange={onQueryChange} />

      <FilterSection title="Ownership">
        <OptionList
          label="Ownership"
          value={query.ownershipStatus ?? all}
          onChange={(value) =>
            onQueryChange({
              ownershipStatus:
                value === all ? undefined : (value as InventoryQuery['ownershipStatus']),
            })
          }
          options={[
            { value: all, label: 'Any status', count: null },
            ...statuses.map((status) => ({
              value: status,
              label: statusLabel(status),
              count: countOf(facets?.ownershipStatus, status),
            })),
          ]}
        />
      </FilterSection>

      <FilterSection title="How often used">
        <OptionList
          label="How often used"
          value={query.useFrequency ?? all}
          onChange={(value) =>
            onQueryChange({
              useFrequency: value === all ? undefined : (value as InventoryQuery['useFrequency']),
            })
          }
          options={[
            { value: all, label: 'Any frequency', count: null },
            ...frequencies.map((frequency) => ({
              value: frequency,
              label: frequencyLabel(frequency),
              count: countOf(facets?.useFrequency, frequency),
            })),
          ]}
        />
      </FilterSection>

      {isMobileModal && onCloseMobile ? (
        <div className="sticky bottom-0 border-t bg-background pt-4">
          <Button className="h-11 w-full" onClick={onCloseMobile}>
            {facets ? `Show ${facets.total} item${facets.total === 1 ? '' : 's'}` : 'Show items'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
