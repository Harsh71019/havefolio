'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  InventoryQuery,
  ItemsPage,
  SpendingBucket,
  TaxonomySnapshot,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import { inventoryQueryParams } from './inventory-query-state';
import { dateNames, scopeNames, spendingGroupName } from './spending-presentation';
import type { InsightsQuery } from './spending-query';
import { acquiredFact, priceFact, statusLabel } from './item-presentation';
import { SpendingRequestError } from './spending-client';

export function spendingItemQuery(
  q: InsightsQuery,
  b: SpendingBucket,
  taxonomy?: TaxonomySnapshot,
): InventoryQuery | null {
  const query: InventoryQuery = {
    spendingScope: q.scope,
    spendingDateBucket: b.dateBucket,
    currency: b.currency,
    limit: 25,
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.subcategoryId ? { subcategoryId: q.subcategoryId } : {}),
    ...(q.purchasedFrom ? { purchasedFrom: q.purchasedFrom } : {}),
    ...(q.purchasedTo ? { purchasedTo: q.purchasedTo } : {}),
  };
  if (q.grouping === 'category') {
    if (b.key) query.categoryId = b.key;
    else query.spendingUnassigned = 'category';
  }
  if (q.grouping === 'subcategory') {
    if (b.key) {
      const child = taxonomy?.subcategories.find((s) => s.id === b.key);
      if (!child) return null;
      query.categoryId = child.categoryId;
      query.subcategoryId = b.key;
    } else query.spendingUnassigned = 'subcategory';
  }
  if (q.grouping === 'year' && b.key) query.spendingYear = b.key;
  return query;
}
async function readPage(query: InventoryQuery, signal: AbortSignal): Promise<ItemsPage> {
  let r: Response;
  try {
    r = await fetch(`/api/v1/items?${inventoryQueryParams(query)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch {
    throw new SpendingRequestError(0, 'Unable to connect. Check your connection and retry.');
  }
  if (!r.ok)
    throw new SpendingRequestError(
      r.status,
      r.status === 401
        ? 'Your session has ended. Sign in again to see these items.'
        : 'These items could not load. Retry or reload the report.',
    );
  try {
    return (await r.json()) as ItemsPage;
  } catch {
    throw new SpendingRequestError(503, 'These items could not load. Retry or reload the report.');
  }
}
export function SpendingDrilldown({
  query,
  bucket,
  taxonomy,
  close,
  returnFocus,
}: {
  query: InsightsQuery;
  bucket: SpendingBucket;
  taxonomy?: TaxonomySnapshot | undefined;
  close: () => void;
  returnFocus: () => void;
}): React.JSX.Element {
  const filter = spendingItemQuery(query, bucket, taxonomy);
  const key = filter ? inventoryQueryParams(filter).toString() : '';
  const [cursor, setCursor] = useState<string | undefined>();
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<{ key: string; page?: ItemsPage; error?: SpendingRequestError }>(
    { key: '' },
  );
  const requestKey = key + '&after=' + (cursor ?? '') + '&retry=' + retry;
  useEffect(() => {
    if (!key) return;
    let active = true;
    const abort = new AbortController();
    const query = Object.fromEntries(new URLSearchParams(key)) as unknown as InventoryQuery;
    void readPage({ ...query, ...(cursor ? { after: cursor } : {}) }, abort.signal)
      .then((page) => {
        if (active) setLoad({ key: requestKey, page });
      })
      .catch((error: unknown) => {
        if (active)
          setLoad({
            key: requestKey,
            error:
              error instanceof SpendingRequestError
                ? error
                : new SpendingRequestError(503, 'These items could not load. Retry.'),
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [key, cursor, retry, requestKey]);
  const current = load.key === requestKey ? load : undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-h-[85svh] overflow-y-auto motion-reduce:animate-none motion-reduce:transition-none sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Matching inventory items</DialogTitle>
          <DialogDescription>
            {spendingGroupName(bucket, query.grouping, taxonomy)} · {bucket.currency} ·{' '}
            {scopeNames[query.scope]} · {dateNames[bucket.dateBucket]}. Server-filtered pages of up
            to 25 items. Demo records are excluded.
          </DialogDescription>
        </DialogHeader>
        {!filter ? (
          <p>Reload category names to view this subcategory’s items.</p>
        ) : !current ? (
          <p role="status">Loading matching items…</p>
        ) : current.error ? (
          <div role="alert" className="space-y-3">
            <p>{current.error.message}</p>
            {current.error.status === 401 ? (
              <Button asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            ) : (
              <Button onClick={() => setRetry((n) => n + 1)}>Retry items</Button>
            )}
          </div>
        ) : current.page ? (
          <>
            {!current.page.items.length ? (
              <p>No matching items remain. Records may have changed since the report loaded.</p>
            ) : (
              <ul className="divide-y">
                {current.page.items.map((item) => (
                  <li key={item.id} className="py-3">
                    <Link
                      href={`/items/${encodeURIComponent(item.id)}`}
                      className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                    >
                      {item.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {statusLabel(item.ownershipStatus)} · {acquiredFact(item.purchaseDate).value}
                    </p>
                    <p className="text-sm">
                      Recorded purchase · {priceFact(item).value} · {scopeNames[query.scope]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-3">
              {cursor ? (
                <Button variant="outline" onClick={() => setCursor(undefined)}>
                  First page
                </Button>
              ) : null}
              {current.page.hasMore && current.page.nextCursor ? (
                <Button onClick={() => setCursor(current.page!.nextCursor!)}>Next 25 items</Button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
