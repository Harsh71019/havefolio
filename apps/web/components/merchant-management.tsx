'use client';

import { useEffect, useRef, useState, type ReactElement, type FormEvent } from 'react';
import type { Merchant, MerchantsPage } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Badge } from '@havefolio/ui/components/badge';
import { Card } from '@havefolio/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { Store } from 'lucide-react';
import { merchantRequest, saveMerchant } from './merchants-client';

const emptyPage: MerchantsPage = { merchants: [], hasMore: false, nextCursor: null };

export function MerchantManagement(): ReactElement {
  const [page, setPage] = useState(emptyPage);
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setListError('');
      setPage(emptyPage);
      merchantRequest(
        `?${new URLSearchParams({ q: query, state: 'all', limit: '25' })}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (generation.current === version) setPage(result);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && generation.current === version)
            setListError(
              error instanceof Error ? error.message : 'Could not load merchants. Retry.',
            );
        })
        .finally(() => {
          if (generation.current === version) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      generation.current = version + 1;
    };
  }, [query, retry]);

  async function loadMore(): Promise<void> {
    if (loading || !page.nextCursor) return;
    const version = generation.current;
    setLoading(true);
    setListError('');
    try {
      const result = await merchantRequest(
        `?${new URLSearchParams({ q: query, state: 'all', limit: '25', after: page.nextCursor })}`,
      );
      if (generation.current === version)
        setPage((previous) => ({
          ...result,
          merchants: [...previous.merchants, ...result.merchants],
        }));
    } catch (error) {
      if (generation.current === version)
        setListError(error instanceof Error ? error.message : 'Could not load more merchants.');
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }

  async function mutate(
    operation: () => Promise<Merchant>,
    message: string,
    resetForm = false,
  ): Promise<void> {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setSaveError('');
    setNotice('');
    try {
      await operation();
      if (resetForm) {
        setName('');
        setHost('');
        setEditing(null);
      }
      setNotice(message);
      setRetry((value) => value + 1);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Could not save merchant. Your entries are kept; retry.',
      );
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input = { displayName: name.trim(), websiteHost: host.trim() || null };
    void mutate(
      () =>
        editing ? merchantRequest<Merchant>(`/${editing.id}`, 'PATCH', input) : saveMerchant(input),
      editing
        ? 'Merchant updated. Existing item links are kept.'
        : 'Merchant saved. You can now select it when adding or editing an item.',
      true,
    );
  }

  return (
    <>
      <section
        aria-labelledby="merchant-form-title"
        className="space-y-4 rounded-lg border p-4 sm:p-6"
      >
        <h2 id="merchant-form-title" className="text-lg font-semibold">
          {editing ? 'Edit merchant' : 'Add merchant'}
        </h2>
        {editing ? (
          <p className="text-sm text-muted-foreground">
            Corrections apply wherever this merchant is recorded. Item links and purchase history
            are preserved.
          </p>
        ) : null}
        <form onSubmit={save} aria-busy={busy} className="grid gap-4">
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="merchant-name">Merchant name</Label>
              <Input
                ref={nameInput}
                id="merchant-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={120}
                autoComplete="off"
                placeholder="For example, Myntra or your local shop"
                className="min-h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="merchant-host">Website host (optional)</Label>
              <Input
                id="merchant-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                maxLength={253}
                autoComplete="off"
                spellCheck={false}
                placeholder="myntra.com"
                aria-describedby="merchant-host-help"
                className="min-h-11"
              />
              <p id="merchant-host-help" className="text-sm text-muted-foreground">
                Use a host such as myntra.com, without a path. Leave empty for an offline seller. No
                website or account is fetched.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!name.trim()} className="min-h-11">
                {busy ? 'Saving…' : editing ? 'Save merchant changes' : 'Add merchant'}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setEditing(null);
                    setName('');
                    setHost('');
                    setSaveError('');
                  }}
                >
                  Cancel editing
                </Button>
              ) : null}
            </div>
          </fieldset>
        </form>
        {saveError ? <p role="alert">{saveError}</p> : null}
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      </section>
      <section aria-labelledby="saved-merchants-title" className="space-y-4">
        <h2 id="saved-merchants-title" className="text-lg font-semibold">
          Saved merchants
        </h2>
        <div className="grid gap-2">
          <Label htmlFor="merchant-search">Search saved merchants</Label>
          <Input
            id="merchant-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLoading(true);
            }}
            maxLength={120}
            autoComplete="off"
            className="min-h-11"
          />
          <p className="text-sm text-muted-foreground">
            Search by the start of a name. Retired merchants remain listed and keep their historical
            item links.
          </p>
        </div>
        {loading ? <p role="status">Loading merchants…</p> : null}
        {listError ? (
          <div role="alert" className="space-y-2">
            <p>{listError}</p>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry merchants
            </Button>
          </div>
        ) : null}
        {!loading && !listError && page.merchants.length === 0 ? (
          <Card className="border-dashed py-0">
            <Empty className="min-h-48">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Store aria-hidden="true" className="size-5" />
                </EmptyMedia>
                <EmptyTitle>
                  {query ? 'No matching merchants' : 'No saved merchants yet'}
                </EmptyTitle>
                <EmptyDescription>
                  {query
                    ? 'No matching merchants. Try another search or add one above.'
                    : 'No saved merchants yet. Add your first merchant above.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : null}
        <ul className="grid gap-3" aria-busy={loading}>
          {page.merchants.map((merchant) => (
            <li
              key={merchant.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0 space-y-1">
                <h3 className="wrap-anywhere font-medium">{merchant.displayName}</h3>
                <p className="break-all text-sm text-muted-foreground">
                  {merchant.websiteHost ?? 'Website not recorded'}
                </p>
                <Badge variant="secondary">
                  {merchant.state === 'retired' ? 'Retired' : 'Active'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  aria-label={`Edit ${merchant.displayName}`}
                  onClick={() => {
                    setEditing(merchant);
                    setName(merchant.displayName);
                    setHost(merchant.websiteHost ?? '');
                    setSaveError('');
                    setNotice('');
                    nameInput.current?.focus();
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  aria-label={`${merchant.state === 'active' ? 'Retire' : 'Restore'} ${merchant.displayName}`}
                  onClick={() =>
                    void mutate(
                      () =>
                        merchantRequest<Merchant>(`/${merchant.id}`, 'PATCH', {
                          state: merchant.state === 'active' ? 'retired' : 'active',
                        }),
                      merchant.state === 'active'
                        ? 'Merchant retired. Historical item links are kept.'
                        : 'Merchant restored. It is available for new items.',
                    )
                  }
                >
                  {merchant.state === 'active' ? 'Retire' : 'Restore'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {page.hasMore ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            Load more merchants
          </Button>
        ) : null}
      </section>
    </>
  );
}
