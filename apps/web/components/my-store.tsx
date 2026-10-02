'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  ArchiveIcon,
  ArrowRightIcon,
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
import type { ItemListEntry, ItemStatus, TaxonomySnapshot } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
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
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  apiInventorySource,
  InventoryRequestError,
  type InventorySource,
} from './inventory-source';
import {
  acquiredFact,
  isInactive,
  itemHref,
  priceFact,
  statusLabel,
  useFact,
} from './item-presentation';
import { deletedFlashKey, storeReturnPath } from './navigation-context';
import { photoSource } from './photos-client';
import { groupInventory } from './store-grouping';

const statusIcons: Record<ItemStatus, LucideIcon> = {
  owned: CircleCheckIcon,
  sold: TagIcon,
  donated: HandHeartIcon,
  disposed: Trash2Icon,
  lost: SearchXIcon,
  returned: Undo2Icon,
};
const cardSizes =
  '(min-width: 1280px) 18rem, (min-width: 1024px) 30vw, (min-width: 480px) 46vw, 92vw';
// At most three columns beside the desktop sidebar so facts never wrap mid-word.
const gridClass = 'grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3';

const noSubscribe = (): (() => void) => () => undefined;
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
      nextCursor: string | null;
    };

const asRequestError = (error: unknown): InventoryRequestError =>
  error instanceof InventoryRequestError
    ? error
    : new InventoryRequestError(500, 'Your items could not load right now.');

export function MyStore({
  source = apiInventorySource,
  now,
}: {
  source?: InventorySource;
  /** Fixed clock for deterministic age labels in tests. */
  now?: Date;
}): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [more, setMore] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const [announcement, setAnnouncement] = useState('');
  const [deleted, setDeleted] = useState<string | undefined>();
  const flash = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Read after hydration; the ref survives a development double-run of this effect.
    flash.current ??= takeDeletedFlash();
    const name = flash.current;
    if (!name) return;
    const timer = window.setTimeout(() => setDeleted(name), 0);
    return () => window.clearTimeout(timer);
  }, []);
  // The current browse location (search, filters, sort, page) item pages return to.
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => '',
  );
  const returnTo = storeReturnPath(search);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const fetchFirst = useCallback(async (): Promise<Load> => {
    try {
      // Taxonomy only names groups; a failure keeps every item visible in one neutral group.
      const [page, taxonomy] = await Promise.all([
        source.loadPage({ cursor: null }),
        source.loadTaxonomy().catch(() => undefined),
      ]);
      return { kind: 'ready', items: page.items, taxonomy, nextCursor: page.nextCursor };
    } catch (error) {
      return { kind: 'failed', error: asRequestError(error) };
    }
  }, [source]);

  useEffect(() => {
    let active = true;
    void fetchFirst().then((next) => active && setLoad(next));
    return () => {
      active = false;
    };
  }, [fetchFirst]);

  const retry = (): void => {
    setLoad({ kind: 'loading' });
    void fetchFirst().then(setLoad);
  };

  async function loadMore(cursor: string): Promise<void> {
    setMore({ busy: true });
    try {
      const page = await source.loadPage({ cursor });
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

  return (
    <section aria-label="Your items" className="mt-8 space-y-8">
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
      {load.kind === 'loading' ? <StoreSkeleton /> : null}
      {load.kind === 'failed' ? <LoadFailure error={load.error} onRetry={retry} /> : null}
      {load.kind === 'ready' ? (
        <StoreContent
          load={load}
          now={now}
          more={more}
          online={online}
          returnTo={returnTo}
          onLoadMore={(cursor) => void loadMore(cursor)}
        />
      ) : null}
    </section>
  );
}

function StoreSkeleton(): React.JSX.Element {
  // Hidden from assistive technology; the single status message above announces loading once.
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="store-skeleton">
      <Skeleton className="h-7 w-40 motion-reduce:animate-none" />
      <div className={gridClass}>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="overflow-hidden rounded-xl border">
            <Skeleton className="aspect-[4/3] rounded-none motion-reduce:animate-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-1/3 motion-reduce:animate-none" />
              <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
              <Skeleton className="h-10 w-full motion-reduce:animate-none" />
            </div>
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

function StoreContent({
  load,
  more,
  now,
  onLoadMore,
  online,
  returnTo,
}: {
  load: Extract<Load, { kind: 'ready' }>;
  returnTo: string;
  more: { busy: boolean; error?: string };
  now: Date | undefined;
  onLoadMore: (cursor: string) => void;
  online: boolean;
}): React.JSX.Element {
  if (!load.items.length)
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
  const { groups, emptyCategories } = groupInventory(load.items, load.taxonomy);
  const total = load.items.length;
  // The first few cards in display order load eagerly; the rest wait until near the viewport.
  const eagerIds = new Set(
    groups.flatMap((g) => g.subgroups.flatMap((s) => s.items.map((i) => i.id))).slice(0, 4),
  );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Showing {total} item{total === 1 ? '' : 's'}
        {load.nextCursor ? ' so far' : ''}
        {load.taxonomy ? '' : '. Categories could not load, so items are not grouped'}.
      </p>
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
          {group.subgroups.map((subgroup) => (
            <div key={subgroup.key} className="space-y-3">
              {subgroup.title ? (
                <h3 className="text-base font-medium text-muted-foreground">{subgroup.title}</h3>
              ) : null}
              <ul className={gridClass}>
                {subgroup.items.map((item) => (
                  <li key={item.id}>
                    <StoreCard
                      item={item}
                      context={
                        // Context only adds information for a genuine subcategory.
                        subgroup.title && !subgroup.key.endsWith(':none')
                          ? `${group.title} › ${subgroup.title}`
                          : undefined
                      }
                      eager={eagerIds.has(item.id)}
                      now={now}
                      returnTo={returnTo}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {emptyCategories.length ? (
        <section aria-labelledby="empty-categories" className="rounded-xl border border-dashed p-4">
          <h2 id="empty-categories" className="text-base font-medium">
            Categories with nothing yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {emptyCategories.join(', ')}. They appear here once something you own is filed in them.
          </p>
        </section>
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

function StoreCard({
  context,
  eager,
  item,
  now,
  returnTo,
}: {
  item: ItemListEntry;
  returnTo: string;
  context: string | undefined;
  eager: boolean;
  now: Date | undefined;
}): React.JSX.Element {
  const id = `item-${item.id}`;
  const inactive = isInactive(item.ownershipStatus);
  const Icon = statusIcons[item.ownershipStatus];
  const cover = item.cover;
  return (
    <Link
      href={itemHref(item.id, returnTo)}
      aria-labelledby={`${id}-name ${id}-status`}
      aria-describedby={`${id}-facts`}
      className="block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <OwnedItemCard
        idPrefix={id}
        name={item.name}
        {...(context ? { context } : {})}
        status={statusLabel(item.ownershipStatus)}
        statusIcon={<Icon aria-hidden="true" />}
        {...(inactive ? { statusNote: ', no longer owned' } : {})}
        inactive={inactive}
        facts={[priceFact(item), acquiredFact(item.purchaseDate, now), useFact(item.useFrequency)]}
        media={
          cover ? (
            <ItemCover
              className="h-full"
              announceFailure={false}
              failedLabel="Photo could not load."
              loading={eager ? 'eager' : 'lazy'}
              cover={photoSource(
                item.id,
                { id: cover.photoId, width: cover.width, height: cover.height },
                cover.decorative ? '' : (cover.altText ?? `Photo of ${item.name}`),
                cardSizes,
              )}
            />
          ) : (
            <ItemCover className="h-full" cover={null} emptyLabel="No photo yet" />
          )
        }
        footer={
          <span className="flex min-h-6 items-center justify-between text-sm text-muted-foreground">
            {inactive ? 'No longer in your home' : 'View details'}
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </span>
        }
      />
    </Link>
  );
}
