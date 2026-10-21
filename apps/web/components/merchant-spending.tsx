'use client';
import { useEffect, useState } from 'react';
import type { MerchantSpendingReport, MerchantSpendingRow } from '@havefolio/contracts';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Button } from '@havefolio/ui/components/button';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { readMerchantSpending, SpendingRequestError } from './spending-client';
import { formatAggregate } from './spending-presentation';

function merchantName(row: MerchantSpendingRow): string {
  if (!row.merchant) return 'No merchant recorded';
  return `${row.merchant.displayName}${row.merchant.state === 'retired' ? ' (retired)' : ''}`;
}
/** Bar width relative to the top merchant in the same currency; BigInt keeps huge totals exact. */
function share(net: string, top: bigint): number {
  if (top <= 0n) return 0;
  return Number((BigInt(net) * 1000n) / top) / 10;
}

/** PER-69: lifetime spend per merchant, independent of the filterable breakdown below. */
export function MerchantSpending(): React.JSX.Element {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    retry: number;
    report?: MerchantSpendingReport;
    error?: SpendingRequestError;
  }>();
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void readMerchantSpending(abort.signal)
      .then((report) => {
        // A malformed body is treated like an unavailable response, never a page crash.
        if (!Array.isArray(report?.rows)) throw new Error('Malformed merchant spending');
        if (active) setState({ retry, report });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            retry,
            error:
              error instanceof SpendingRequestError
                ? error
                : new SpendingRequestError(503, 'Merchant spending is temporarily unavailable.'),
          });
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [retry]);
  const current = state?.retry === retry ? state : undefined;
  const currencies = [...new Set(current?.report?.rows.map((r) => r.currency) ?? [])];
  return (
    <section aria-labelledby="merchant-spending-heading" className="space-y-4">
      <div>
        <h2 id="merchant-spending-heading" className="text-xl font-semibold">
          Spend by merchant
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Net of confirmed refunds, across all recorded history.
        </p>
      </div>
      {!current ? (
        <div data-testid="merchant-spending-skeleton">
          <p role="status" className="sr-only">
            Loading merchant spending…
          </p>
          <div aria-hidden="true" className="rounded-lg border divide-y">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-32 motion-reduce:animate-none" />
                    <Skeleton className="h-3.5 w-24 motion-reduce:animate-none" />
                  </div>
                  <Skeleton className="h-6 w-24 motion-reduce:animate-none" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
      ) : current.error ? (
        <Alert role="alert">
          <AlertTitle>Merchant spending could not load</AlertTitle>
          <AlertDescription>
            {current.error.message}
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-fit"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry merchant spending
            </Button>
          </AlertDescription>
        </Alert>
      ) : !currencies.length ? (
        <p className="text-sm text-muted-foreground">
          No purchases recorded yet. Add a merchant when you record an item to see it here.
        </p>
      ) : (
        currencies.map((currency) => {
          const rows = current.report!.rows.filter((r) => r.currency === currency);
          const top = rows.reduce(
            (max, r) => (BigInt(r.netMinor) > max ? BigInt(r.netMinor) : max),
            0n,
          );
          return (
            <div key={currency} className="rounded-lg border">
              {currencies.length > 1 ? (
                <h3 className="border-b px-4 py-2 text-sm font-medium">{currency}</h3>
              ) : null}
              <ol aria-label={`Merchants by ${currency} spend`} className="divide-y">
                {rows.map((row) => (
                  <li key={row.merchant?.id ?? 'none'} className="space-y-2 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium wrap-anywhere">{merchantName(row)}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.totalItemCount} {row.totalItemCount === 1 ? 'item' : 'items'}
                          {row.unknownPriceCount
                            ? ` · ${row.unknownPriceCount} without a price`
                            : ''}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums">
                        {formatAggregate(row.netMinor, currency)}
                      </p>
                    </div>
                    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${share(row.netMinor, top)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          );
        })
      )}
    </section>
  );
}
