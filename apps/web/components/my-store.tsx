'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  ArchiveIcon,
  CircleCheckIcon,
  HandHeartIcon,
  PlusIcon,
  SearchXIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
  WifiOffIcon,
  type LucideIcon,
} from 'lucide-react';
import type {
  InventoryFacets,
  ItemListEntry,
  ItemStatus,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { OwnedItemCard } from '@havefolio/ui/components/havefolio/owned-item-card';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Label } from '@havefolio/ui/components/label';
import {
  collapsedDensityImageSizes,
  densityImageSizes,
  storeDensities,
  type StoreDensity,
} from './store-density-config';
import { selectDensity, useStoreDensity } from './store-density';
import { useSidebarState } from './sidebar-state';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  apiInventorySource,
  InventoryRequestError,
  type InventoryQuery,
  type InventorySource,
} from './inventory-source';
import {
  changeInventoryQuery,
  readInventoryQuery,
  type InventoryPatch,
} from './inventory-query-state';
import { isInactive, itemHref, statusLabel } from './item-presentation';
import { deletedFlashKey, storeReturnPath } from './navigation-context';
import { photoSource } from './photos-client';
import { groupInventory } from './store-grouping';
import { StoreFilters, countActiveFilters } from './store-filters';
import { StoreToolbar } from './store-toolbar';
import { StoreActiveChips } from './store-active-chips';
import { saveStoreLocation, subscribeStoreLocation } from './store-location';

const statusIcons: Record<ItemStatus, LucideIcon> = {
  owned: CircleCheckIcon,
  sold: TagIcon,
  donated: HandHeartIcon,
  disposed: Trash2Icon,
  lost: SearchXIcon,
  returned: Undo2Icon,
};
// PER-67: roomy catalog spacing — two columns on phones, wider auto-fill columns on desktop.
const gridClass = 'store-grid grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6';

/** The deleted item's name left by the item page; read once, then cleared. */
function takeDeletedFlash(): string | undefined {
  try {
    const name = window.sessionStorage.getItem(deletedFlashKey) ?? undefined;
    window.sessionStorage.removeItem(deletedFlashKey);
    return name?.slice(0, 300);
  } catch {
    return undefined;
  }
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

type Load =
  | { kind: 'loading' }
  | { kind: 'failed'; error: InventoryRequestError }
  | {
      kind: 'ready';
      items: ItemListEntry[];
      taxonomy: TaxonomySnapshot | undefined;
      facets: InventoryFacets | undefined;
      nextCursor: string | null;
    };

const asRequestError = (error: unknown): InventoryRequestError =>
  error instanceof InventoryRequestError
    ? error
    : new InventoryRequestError(500, 'Your items could not load right now.');

export function MyStore({
  source = apiInventorySource,
}: {
  source?: InventorySource;
}): React.JSX.Element {
  const density = useStoreDensity();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const changed = (): void => setRefresh((n) => n + 1);
    window.addEventListener('havefolio-inventory-changed', changed);
    return () => window.removeEventListener('havefolio-inventory-changed', changed);
  }, []);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [more, setMore] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [announcement, setAnnouncement] = useState('');
  const [deleted, setDeleted] = useState<string | undefined>();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const flash = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Read after hydration; the ref survives a development double-run of this effect.
    flash.current ??= takeDeletedFlash();
    const name = flash.current;
    if (!name) return;
    const timer = window.setTimeout(() => setDeleted(name), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Synchronize location search params with local query state
  const search = useSyncExternalStore(
    subscribeStoreLocation,
    () => window.location.search,
    () => '',
  );
  const query = useMemo(() => readInventoryQuery(new URLSearchParams(search)), [search]);
  const returnTo = storeReturnPath(search);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const handleQueryChange = (patch: InventoryPatch): void => {
    const next = changeInventoryQuery(query, patch);
    saveStoreLocation(next);
  };

  // Clearing filters keeps the chosen order (and the currency price order needs).
  const handleReset = (): void => {
    saveStoreLocation(
      query.sort
        ? {
            sort: query.sort,
            ...(query.direction ? { direction: query.direction } : {}),
            ...(query.sort === 'price' && query.currency ? { currency: query.currency } : {}),
          }
        : {},
    );
  };

  const fetchFirst = useCallback(async (): Promise<Load> => {
    try {
      const isClean = Object.keys(query).length === 0;
      const cleanQuery: InventoryQuery = { ...query };
      delete (cleanQuery as { cursor?: unknown }).cursor;
      // Taxonomy only names groups and facets only add counts; a failure of either keeps every
      // item browsable.
      const [page, taxonomy, facets] = await Promise.all([
        source.loadPage(isClean ? { cursor: null } : cleanQuery),
        source.loadTaxonomy().catch(() => undefined),
        source.loadFacets?.(cleanQuery).catch(() => undefined),
      ]);
      return { kind: 'ready', items: page.items, taxonomy, facets, nextCursor: page.nextCursor };
    } catch (error) {
      return { kind: 'failed', error: asRequestError(error) };
    }
  }, [source, query]);

  useEffect(() => {
    let active = true;
    void fetchFirst().then((next) => active && setLoad(next));
    return () => {
      active = false;
    };
  }, [fetchFirst, refresh]);

  const retry = (): void => {
    setLoad({ kind: 'loading' });
    void fetchFirst().then(setLoad);
  };

  async function loadMore(cursor: string): Promise<void> {
    setMore({ busy: true });
    try {
      const isClean = Object.keys(query).length === 0;
      const cleanQuery: InventoryQuery = { ...query, after: cursor };
      delete (cleanQuery as { cursor?: unknown }).cursor;
      const page = await source.loadPage(isClean ? { cursor } : cleanQuery);
      setLoad((current) => {
        if (current.kind !== 'ready') return current;
        // Keyset pages are live views; drop any item already shown.
        const seen = new Set(current.items.map((i) => i.id));
        return {
          ...current,
          items: [...current.items, ...page.items.filter((i) => !seen.has(i.id))],
          nextCursor: page.nextCursor,
        };
      });
      setAnnouncement(
        `Loaded ${page.items.length} more item${page.items.length === 1 ? '' : 's'}.`,
      );
      setMore({ busy: false });
    } catch (error) {
      setMore({ busy: false, error: asRequestError(error).message });
    }
  }

  const taxonomy = load.kind === 'ready' ? load.taxonomy : undefined;
  const facets = load.kind === 'ready' ? load.facets : undefined;
  const summary =
    load.kind === 'loading'
      ? 'Loading your items…'
      : load.kind === 'failed'
        ? 'Items unavailable'
        : `${
            facets && facets.total > load.items.length
              ? `Showing ${load.items.length} of ${facets.total} items`
              : `Showing ${load.items.length} item${load.items.length === 1 ? '' : 's'}${load.nextCursor ? ' so far' : ''}`
          }.${load.taxonomy ? '' : ' Categories could not load, so items are not grouped.'}`;

  return (
    <section aria-label="Your items" className="my-store mt-8 space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {load.kind === 'loading' ? 'Loading your items.' : announcement}
      </p>
      {deleted ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            “{deleted}” and its private photos and documents were deleted.
          </span>
        </div>
      ) : null}
      {!online ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
          You are offline. Items already shown stay visible; reconnect to load more.
        </div>
      ) : null}

      <Dialog open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>Narrow what you see. Counts update as you choose.</DialogDescription>
          </DialogHeader>
          <StoreFilters
            query={query}
            taxonomy={taxonomy}
            facets={facets}
            onQueryChange={handleQueryChange}
            onReset={handleReset}
            isMobileModal
            onCloseMobile={() => setMobileFiltersOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Catalog: filters beside the results where there is room, in a dialog otherwise. */}
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <aside
          aria-label="Filters"
          className="sticky top-4 hidden max-h-[calc(100svh-2rem)] overflow-y-auto pr-2 xl:block"
        >
          <StoreFilters
            query={query}
            taxonomy={taxonomy}
            facets={facets}
            onQueryChange={handleQueryChange}
            onReset={handleReset}
          />
        </aside>

        <div className="min-w-0 space-y-6">
          <StoreActiveChips
            query={query}
            taxonomy={taxonomy}
            onQueryChange={handleQueryChange}
            onReset={handleReset}
          />
          <StoreToolbar
            query={query}
            onQueryChange={handleQueryChange}
            onOpenMobileFilters={() => setMobileFiltersOpen(true)}
            summary={summary}
          >
            <div className="hidden items-center gap-3 lg:flex">
              <span id="store-density-label" className="text-sm font-medium">
                View density
              </span>
              <RadioGroup
                aria-labelledby="store-density-label"
                orientation="horizontal"
                value={density}
                onValueChange={selectDensity}
                className="flex gap-3"
              >
                {storeDensities.map((mode) => (
                  <Label key={mode} className="flex min-h-11 cursor-pointer items-center gap-2">
                    <RadioGroupItem
                      value={mode}
                      aria-label={mode[0]!.toUpperCase() + mode.slice(1)}
                    />
                    {mode[0]!.toUpperCase() + mode.slice(1)}
                  </Label>
                ))}
              </RadioGroup>
            </div>
          </StoreToolbar>

          {load.kind === 'loading' ? <StoreSkeleton /> : null}
          {load.kind === 'failed' ? <LoadFailure error={load.error} onRetry={retry} /> : null}
          {load.kind === 'ready' ? (
            <StoreContent
              density={density}
              load={load}
              more={more}
              online={online}
              returnTo={returnTo}
              query={query}
              onResetFilters={handleReset}
              onLoadMore={(cursor) => void loadMore(cursor)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StoreSkeleton(): React.JSX.Element {
  // Hidden from assistive technology; the single status message above announces loading once.
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="store-skeleton">
      <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
      <div className={gridClass}>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="space-y-2.5">
            <Skeleton className="aspect-square rounded-lg motion-reduce:animate-none" />
            <Skeleton className="h-4 w-3/4 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadFailure({
  error,
  onRetry,
}: {
  error: InventoryRequestError;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Card role="alert" className="border-dashed">
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="font-medium">
            {error.unauthenticated ? 'Please sign in again' : 'My Store could not load'}
          </p>
          <p className="text-sm text-muted-foreground">{error.message} Nothing has been changed.</p>
        </div>
        {error.unauthenticated ? (
          <Button asChild className="min-h-11">
            <Link href="/login">Sign in</Link>
          </Button>
        ) : (
          <Button className="min-h-11" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyCategories({ names }: { names: string[] }): React.JSX.Element {
  return (
    <section aria-labelledby="empty-categories" className="rounded-xl border border-dashed p-4">
      <h2 id="empty-categories" className="text-base font-medium">
        Categories with nothing yet
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {names.join(', ')}. They appear here once something you own is filed in them.
      </p>
    </section>
  );
}

function resolveItemContext(
  item: ItemListEntry,
  taxonomy: TaxonomySnapshot | undefined,
): string | undefined {
  if (!taxonomy || !item.categoryId) return undefined;
  const category = taxonomy.categories.find((c) => c.id === item.categoryId);
  if (!category) return undefined;
  if (!item.subcategoryId) return category.name;
  const subcategory = taxonomy.subcategories.find((s) => s.id === item.subcategoryId);
  if (!subcategory) return category.name;
  return `${category.name} › ${subcategory.name}`;
}

function StoreContent({
  density,
  load,
  more,
  onLoadMore,
  online,
  returnTo,
  query,
  onResetFilters,
}: {
  density: StoreDensity;
  load: Extract<Load, { kind: 'ready' }>;
  returnTo: string;
  more: { busy: boolean; error?: string };
  onLoadMore: (cursor: string) => void;
  online: boolean;
  query: InventoryQuery;
  onResetFilters: () => void;
}): React.JSX.Element {
  if (!load.items.length) {
    const hasFilters = countActiveFilters(query) > 0;
    if (hasFilters) {
      return (
        <Card className="border-dashed py-0">
          <Empty className="min-h-80">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No items match your filters</EmptyTitle>
              <EmptyDescription>
                We couldn’t find anything in your home matching your search and filter criteria. Try
                adjusting your search terms or clearing some filters to see your items.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" className="min-h-11" onClick={onResetFilters}>
                Clear all filters
              </Button>
            </EmptyContent>
          </Empty>
        </Card>
      );
    }
    return (
      <Card className="border-dashed py-0">
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Nothing recorded yet</EmptyTitle>
            <EmptyDescription>
              My Store shows the things you already have at home. Add one you own now — a name is
              enough to start, and it takes under a minute.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild className="min-h-11">
              <Link href="/items/new">
                <PlusIcon aria-hidden="true" />
                Add your first item
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </Card>
    );
  }

  // PER-66: across all categories, show one catalog grid. Explicit sorts keep the API order;
  // the default keeps taxonomy order, with each card naming its category instead of a heading.
  const sorted = Boolean(query.sort && query.sort !== 'id');
  if (sorted || !query.categoryId) {
    const grouped = sorted ? undefined : groupInventory(load.items, load.taxonomy);
    const items = grouped?.groups.flatMap((g) => g.subgroups.flatMap((s) => s.items)) ?? load.items;
    const eagerIds = new Set(items.slice(0, 4).map((i) => i.id));
    return (
      <>
        <section aria-labelledby="store-items-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="store-items-heading" className="text-xl font-semibold tracking-tight">
              {query.q ? `Search results for “${query.q}”` : 'All items'}
            </h2>
            <span className="text-sm text-muted-foreground">
              {load.nextCursor && load.items.length
                ? `${load.items.length} items shown so far`
                : `${load.items.length} item${load.items.length === 1 ? '' : 's'}`}
            </span>
          </div>
          <ul className={gridClass}>
            {items.map((item) => (
              <li key={item.id}>
                <StoreCard
                  density={density}
                  item={item}
                  context={resolveItemContext(item, load.taxonomy)}
                  eager={eagerIds.has(item.id)}
                  returnTo={returnTo}
                />
              </li>
            ))}
          </ul>
        </section>
        {grouped?.emptyCategories.length ? (
          <EmptyCategories names={grouped.emptyCategories} />
        ) : null}
        {load.nextCursor ? (
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={more.busy || !online}
              onClick={() => load.nextCursor && onLoadMore(load.nextCursor)}
            >
              {more.busy
                ? 'Loading more…'
                : more.error
                  ? 'Try loading more again'
                  : 'Show more items'}
            </Button>
            {more.error ? (
              <p role="alert" className="text-sm">
                {more.error} Items already shown are unchanged.
              </p>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  // A single selected category keeps its heading and per-category count.
  const { groups, emptyCategories } = groupInventory(load.items, load.taxonomy);
  // The first few cards in display order load eagerly; the rest wait until near the viewport.
  const eagerIds = new Set(
    groups.flatMap((g) => g.subgroups.flatMap((s) => s.items.map((i) => i.id))).slice(0, 4),
  );
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`} className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id={`group-${group.key}`} className="text-xl font-semibold tracking-tight">
              {group.title}
              {group.retired ? (
                <span className="text-sm font-normal text-muted-foreground"> (retired)</span>
              ) : null}
            </h2>
            <span className="text-sm text-muted-foreground">
              {load.nextCursor && group.total !== null && group.total > group.loaded
                ? `${group.loaded} of ${group.total} shown`
                : `${group.loaded} item${group.loaded === 1 ? '' : 's'}`}
            </span>
          </div>
          {/* One grid per category so sparse subcategories still fill the density's columns;
              each card carries its subcategory instead of a per-subcategory heading. */}
          <ul className={gridClass}>
            {group.subgroups.flatMap((subgroup) =>
              subgroup.items.map((item) => (
                <li key={item.id}>
                  <StoreCard
                    density={density}
                    item={item}
                    context={
                      // Context only adds information for a genuine subcategory.
                      subgroup.title && !subgroup.key.endsWith(':none')
                        ? `${group.title} › ${subgroup.title}`
                        : undefined
                    }
                    eager={eagerIds.has(item.id)}
                    returnTo={returnTo}
                  />
                </li>
              )),
            )}
          </ul>
        </section>
      ))}
      {emptyCategories.length ? <EmptyCategories names={emptyCategories} /> : null}
      {load.nextCursor ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={more.busy || !online}
            onClick={() => load.nextCursor && onLoadMore(load.nextCursor)}
          >
            {more.busy
              ? 'Loading more…'
              : more.error
                ? 'Try loading more again'
                : 'Show more items'}
          </Button>
          {more.error ? (
            <p role="alert" className="text-sm">
              {more.error} Items already shown are unchanged.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function StoreCard({
  density,
  context,
  eager,
  item,
  returnTo,
}: {
  density: StoreDensity;
  item: ItemListEntry;
  returnTo: string;
  context: string | undefined;
  eager: boolean;
}): React.JSX.Element {
  const id = `item-${item.id}`;
  const inactive = isInactive(item.ownershipStatus);
  const Icon = statusIcons[item.ownershipStatus];
  const cover = item.cover;
  const imageSizes =
    useSidebarState() === 'collapsed' ? collapsedDensityImageSizes : densityImageSizes;
  return (
    <Link
      href={itemHref(item.id, returnTo)}
      aria-labelledby={`${id}-name ${id}-status`}
      {...(context ? { 'aria-describedby': `${id}-context` } : {})}
      className="block h-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <OwnedItemCard
        className="store-card"
        idPrefix={id}
        name={item.name}
        status={
          item.isDemo
            ? `Demo · ${statusLabel(item.ownershipStatus)}`
            : statusLabel(item.ownershipStatus)
        }
        statusIcon={<Icon aria-hidden="true" />}
        {...(inactive ? { statusNote: ', no longer owned' } : {})}
        // Owned items need no badge; anything no longer at home, or demo data, says so.
        showStatus={inactive || item.isDemo}
        inactive={inactive}
        media={
          cover ? (
            <ItemCover
              className="absolute inset-0 h-full"
              announceFailure={false}
              failedLabel="Photo could not load."
              loading={eager ? 'eager' : 'lazy'}
              cover={photoSource(
                item.id,
                { id: cover.photoId, width: cover.width, height: cover.height },
                cover.decorative ? '' : (cover.altText ?? `Photo of ${item.name}`),
                imageSizes[density],
              )}
            />
          ) : (
            <ItemCover className="absolute inset-0 h-full" cover={null} emptyLabel="No photo yet" />
          )
        }
      />
      {/* The card stays name-only; the category is still announced for context. */}
      {context ? (
        <span id={`${id}-context`} className="sr-only">
          {context}
        </span>
      ) : null}
    </Link>
  );
}
