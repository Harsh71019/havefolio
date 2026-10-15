'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { SpendingBucket, SpendingReport, TaxonomySnapshot } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@havefolio/ui/components/empty';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@havefolio/ui/components/table';
import { readSpending, SpendingRequestError } from './spending-client';
import {
  changeSpendingQuery,
  defaultInsightsQuery,
  readSpendingQuery,
  reconcileSpendingTaxonomy,
  spendingQueryParams,
  type InsightsPatch,
  type InsightsQuery,
} from './spending-query';
import {
  dateDescriptions,
  dateNames,
  formatAggregate,
  scopeNames,
  spendingGroupName,
} from './spending-presentation';
import { SpendingFilters } from './spending-filters';
import { SpendingDrilldown, spendingItemQuery } from './spending-drilldown';
import { taxonomyRequest, TaxonomyRequestError } from './taxonomy-client';

function subscribeLocation(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener('havefolio-insights-query', callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener('havefolio-insights-query', callback);
  };
}
function saveLocation(query: InsightsQuery, replace = false): void {
  const url = `/insights?${spendingQueryParams(query)}`;
  if (window.location.pathname + window.location.search === url) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  window.dispatchEvent(new Event('havefolio-insights-query'));
}
const relations = ['dated', 'spanningRange', 'unknownDate'] as const;
type Reports = {
  key: string;
  summary?: SpendingReport;
  breakdown?: SpendingReport;
  error?: SpendingRequestError;
};
function Counts({ bucket: b }: { bucket: SpendingBucket }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
      {[
        ['Total items', b.totalItemCount],
        ['Unknown prices', b.unknownPriceCount],
        ['Gifts / other non-spending', b.notSpendingCount],
        ['Explicit zero amounts', b.explicitZeroCount],
        ['Known purchase dates', b.knownDateCount],
        ['Unknown purchase dates', b.unknownDateCount],
      ].map(([label, count]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-medium tabular-nums">{count}</dd>
        </div>
      ))}
    </dl>
  );
}
const noSubscribe = (): (() => void) => () => undefined;
/** Mount interactive controls only after hydration, with the actual browser URL.
 * Radix's form-backed selects must not mount with a different server-default filter value. */
export function SpendingInsights(): React.JSX.Element {
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return ready ? <SpendingInsightsContent /> : <p role="status">Loading recorded spending…</p>;
}
function SpendingInsightsContent(): React.JSX.Element {
  const search = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => '',
  );
  const [taxonomy, setTaxonomy] = useState<TaxonomySnapshot>();
  const [taxonomyError, setTaxonomyError] = useState(false);
  const [taxonomyAuth, setTaxonomyAuth] = useState(false);
  const [taxonomyRetry, setTaxonomyRetry] = useState(0);
  const parsed = readSpendingQuery(new URLSearchParams(search));
  const query = taxonomy ? reconcileSpendingTaxonomy(parsed, taxonomy) : parsed;
  const queryKey = spendingQueryParams(query).toString();
  const [retry, setRetry] = useState(0);
  const [filterReset, setFilterReset] = useState(0);
  const waitingForTaxonomy = Boolean(query.subcategoryId && !taxonomy && !taxonomyError);
  const [load, setLoad] = useState<Reports>({ key: '' });
  const drillTrigger = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<{ key: string; bucket: SpendingBucket } | null>(null);
  useEffect(() => {
    let active = true;
    void taxonomyRequest()
      .then((data) => {
        if (active) {
          setTaxonomy(data);
          setTaxonomyError(false);
          setTaxonomyAuth(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setTaxonomyError(true);
          setTaxonomyAuth(e instanceof TaxonomyRequestError && e.status === 401);
        }
      });
    return () => {
      active = false;
    };
  }, [taxonomyRetry]);
  useEffect(() => {
    if (search !== window.location.search) return;
    saveLocation(readSpendingQuery(new URLSearchParams(queryKey)), true);
  }, [queryKey, search]);
  useEffect(() => {
    if (search !== window.location.search || waitingForTaxonomy) return;
    let active = true;
    const abort = new AbortController();
    const q = readSpendingQuery(new URLSearchParams(queryKey));
    const summary = readSpending({ ...q, grouping: 'overall' }, abort.signal);
    // Two bounded aggregate requests. Summary is never reconstructed from groups or item pages.
    void Promise.all([summary, q.grouping === 'overall' ? summary : readSpending(q, abort.signal)])
      .then(([overall, breakdown]) => {
        if (active) setLoad({ key: queryKey, summary: overall, breakdown });
      })
      .catch((error: unknown) => {
        if (active)
          setLoad({
            key: queryKey,
            error:
              error instanceof SpendingRequestError
                ? error
                : new SpendingRequestError(
                    503,
                    'Recorded spending is temporarily unavailable. Please retry.',
                  ),
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [queryKey, retry, search, waitingForTaxonomy]);
  const current = load.key === queryKey ? load : undefined;
  const change = (patch: InsightsPatch): void => saveLocation(changeSpendingQuery(query, patch));
  const currencies = [...new Set(current?.summary?.buckets.map((b) => b.currency) ?? [])];
  const auth = current?.error?.status === 401 || taxonomyAuth;
  return (
    <div className="space-y-8">
      <SpendingFilters
        key={filterReset}
        query={query}
        taxonomy={taxonomy}
        change={change}
        reset={() => {
          saveLocation(defaultInsightsQuery);
          setFilterReset((n) => n + 1);
          setRetry((n) => n + 1);
        }}
      />
      {taxonomyError && !auth ? (
        <Alert>
          <AlertTitle>Category names unavailable</AlertTitle>
          <AlertDescription>
            Spending results remain available. No private identifiers are displayed.
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-fit"
              onClick={() => setTaxonomyRetry((n) => n + 1)}
            >
              Retry category names
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {auth ? (
        <Alert role="alert">
          <AlertTitle>Sign in to continue</AlertTitle>
          <AlertDescription>
            Your session has ended. Sign in again to see recorded spending.
            <Button asChild className="mt-3 w-fit">
              <Link href="/login">Sign in</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : !current ? (
        <div>
          <p role="status">Loading recorded spending…</p>
          <div aria-hidden="true" className="mt-4 space-y-3">
            <Skeleton className="h-32 w-full motion-reduce:animate-none" />
            <Skeleton className="h-48 w-full motion-reduce:animate-none" />
          </div>
        </div>
      ) : current.error ? (
        <Alert role="alert">
          <AlertTitle>Recorded spending could not load</AlertTitle>
          <AlertDescription>
            {current.error.message}
            <Button
              className="mt-3 min-h-11 w-fit"
              onClick={() => {
                setLoad({ key: '' });
                setRetry((n) => n + 1);
              }}
            >
              Retry spending
            </Button>
          </AlertDescription>
        </Alert>
      ) : !current.summary?.buckets.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {query.currency || query.categoryId || query.purchasedFrom || query.purchasedTo
                ? 'No records match these filters'
                : 'No recorded purchases in this scope'}
            </EmptyTitle>
            <EmptyDescription>
              Unknown amounts still appear when items exist. Demo items do not enter this report.
              Try another scope or record a purchase manually.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => saveLocation(defaultInsightsQuery)}>
              Reset filters
            </Button>
            <Button asChild>
              <Link href="/items/new">Add an item</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {scopeNames[query.scope]} · Purchase-date basis · {currencies.length}{' '}
            {currencies.length === 1 ? 'currency' : 'currencies'}, shown separately
          </p>
          <section aria-label="Recorded spending summary" className="space-y-8">
            <h2 className="text-xl font-semibold">Recorded spending summary</h2>
            {currencies.map((currency) => (
              <section
                key={currency}
                aria-label={`${currency} · ${scopeNames[query.scope]}`}
                className="space-y-6 border-t pt-5"
              >
                <h3 className="text-lg font-semibold">
                  {currency} · {scopeNames[query.scope]}
                </h3>
                {relations.map((relation) => {
                  const bucket = current.summary!.buckets.find(
                    (b) => b.currency === currency && b.dateBucket === relation,
                  );
                  if (!bucket) return null;
                  return (
                    <section
                      key={relation}
                      aria-label={`${currency} ${dateNames[relation]} summary`}
                      className="space-y-4"
                    >
                      <div>
                        <h4 className="font-medium">{dateNames[relation]}</h4>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                          {dateDescriptions[relation]}
                        </p>
                      </div>
                      <dl className="grid gap-4 sm:grid-cols-3">
                        {(
                          [
                            ['Gross recorded amount', bucket.grossMinor],
                            ['Confirmed refunds', bucket.refundedMinor],
                            ['Net recorded spending', bucket.netMinor],
                          ] as const
                        ).map(([label, amount]) => (
                          <div key={label}>
                            <dt className="text-sm text-muted-foreground">{label}</dt>
                            <dd className="mt-1 break-words text-lg font-semibold tabular-nums">
                              {formatAggregate(amount, currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <Counts bucket={bucket} />
                    </section>
                  );
                })}
              </section>
            ))}
          </section>
          {query.grouping !== 'overall' && current.breakdown ? (
            <section aria-label="Spending breakdown" className="space-y-6">
              <h2 className="text-xl font-semibold">
                {query.grouping === 'year'
                  ? 'Yearly trend'
                  : query.grouping === 'category'
                    ? 'Category totals'
                    : 'Subcategory totals'}
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Exact tables show gross purchases, confirmed refunds and net spending. Item counts
                include unknown amounts and non-spending records. Disclosure tables are never added
                to dated totals.
              </p>
              <p className="text-sm text-muted-foreground sm:hidden">
                Scroll each table horizontally to see refunds, net spending and item actions.
              </p>
              {currencies.flatMap((currency) =>
                relations.map((relation) => {
                  const rows = current.breakdown!.buckets.filter(
                    (b) => b.currency === currency && b.dateBucket === relation,
                  );
                  if (!rows.length) return null;
                  const name = `${currency} · ${scopeNames[query.scope]} · ${dateNames[relation]}`;
                  return (
                    <section key={currency + relation} className="space-y-3">
                      <h3 className="font-medium">{name}</h3>
                      <p className="text-sm text-muted-foreground">{dateDescriptions[relation]}</p>
                      <div className="rounded-md border focus-visible:outline-2 focus-visible:outline-ring">
                        <Table
                          containerProps={{
                            role: 'region',
                            'aria-label': `${name} table, scroll horizontally`,
                            tabIndex: 0,
                          }}
                        >
                          <TableCaption>
                            {name}. Amounts are exact. Row actions open matching inventory items.
                          </TableCaption>
                          <TableHeader>
                            <TableRow>
                              {[
                                'Group / counts',
                                'Gross recorded',
                                'Confirmed refunds',
                                'Net recorded',
                                'Items',
                              ].map((h) => (
                                <TableHead key={h} scope="col">
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rows.map((b) => (
                              <TableRow key={b.key ?? 'unassigned'}>
                                <TableCell className="min-w-52 whitespace-normal">
                                  <span className="font-medium">
                                    {spendingGroupName(b, query.grouping, taxonomy)}
                                  </span>
                                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    {b.totalItemCount} items · {b.unknownPriceCount} unknown prices
                                    · {b.notSpendingCount} non-spending · {b.explicitZeroCount}{' '}
                                    explicit zero · {b.unknownDateCount} unknown dates
                                  </p>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatAggregate(b.grossMinor, currency)}
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatAggregate(b.refundedMinor, currency)}
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {formatAggregate(b.netMinor, currency)}
                                </TableCell>
                                <TableCell>
                                  {spendingItemQuery(query, b, taxonomy) ? (
                                    <Button
                                      variant="outline"
                                      className="min-h-11"
                                      aria-label={`View items: ${spendingGroupName(b, query.grouping, taxonomy)}, ${name}`}
                                      onClick={(event) => {
                                        drillTrigger.current = event.currentTarget;
                                        setSelected({ key: queryKey, bucket: b });
                                      }}
                                    >
                                      View items
                                    </Button>
                                  ) : (
                                    <span className="text-xs">
                                      Retry category names to view items.
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                  );
                }),
              )}
            </section>
          ) : null}
        </>
      )}
      {selected?.key === queryKey && !auth ? (
        <SpendingDrilldown
          query={query}
          bucket={selected.bucket}
          taxonomy={taxonomy}
          close={() => setSelected(null)}
          returnFocus={() => drillTrigger.current?.focus()}
        />
      ) : null}
    </div>
  );
}
