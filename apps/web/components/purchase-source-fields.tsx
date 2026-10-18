'use client';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type { Merchant, MerchantsPage } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { merchantRequest, saveMerchant } from './merchants-client';

/** Havefolio composition of registry Input + Select, with server search instead of client filtering. */
export function PurchaseSourceFields({
  merchant,
  merchantId,
  purchaseUrl,
  onMerchant,
  onUrl,
  disabled = false,
  idPrefix,
  urlError,
}: {
  merchant: Merchant | null;
  merchantId: string | null;
  purchaseUrl: string;
  onMerchant: (merchant: Merchant | null) => void;
  onUrl: (value: string) => void;
  disabled?: boolean;
  idPrefix?: string;
  urlError?: string;
}): ReactElement {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const [q, setQ] = useState('');
  const [page, setPage] = useState<MerchantsPage>({
    merchants: [],
    nextCursor: null,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [customName, setCustomName] = useState(''),
    [host, setHost] = useState('');
  const [manage, setManage] = useState(false);
  const generation = useRef(0),
    mutation = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      merchantRequest(
        `?${new URLSearchParams({ q, limit: '25' })}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((result) => {
          if (version === generation.current) setPage(result);
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted && version === generation.current)
            setError(e instanceof Error ? e.message : 'Could not load merchants.');
        })
        .finally(() => {
          if (version === generation.current) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      generation.current = version + 1;
    };
  }, [q, retry]);
  async function change(operation: () => Promise<Merchant>, select = true): Promise<void> {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (result.state === 'retired' && select) {
        setError('That merchant is retired. Choose an active merchant or use Not recorded.');
        return;
      }
      onMerchant(result);
      setNotice(
        select ? 'Merchant selected.' : 'Merchant updated. Historical item links are kept.',
      );
      setManage(false);
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save merchant. Retry.');
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function more(): Promise<void> {
    if (!page.nextCursor || loading) return;
    const version = generation.current;
    setLoading(true);
    try {
      const next = await merchantRequest(
        `?${new URLSearchParams({ q, limit: '25', after: page.nextCursor })}`,
      );
      if (version === generation.current)
        setPage((p) => ({ ...next, merchants: [...p.merchants, ...next.merchants] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more.');
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  const entries = page.merchants.filter((m) => m.state === 'active' && m.id !== merchant?.id);
  if (merchant) entries.unshift(merchant);
  return (
    <fieldset disabled={disabled || busy} className="grid min-w-0 gap-3">
      <legend className="mb-2 font-medium">Where you purchased it (optional)</legend>
      <p className="text-sm text-muted-foreground">
        Merchant is the seller, separate from the brand. These details stay private. No page or
        account is imported.
      </p>
      <Label htmlFor={`${id}-search`}>Search saved merchants</Label>
      <Input
        id={`${id}-search`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={120}
        autoComplete="off"
        className="min-h-11"
      />
      <Label htmlFor={`${id}-merchantId`}>Purchase merchant</Label>
      <Select
        value={merchantId ?? 'none'}
        onValueChange={(value) => {
          onMerchant(value === 'none' ? null : (entries.find((m) => m.id === value) ?? null));
          setManage(false);
        }}
      >
        <SelectTrigger id={`${id}-merchantId`} className="min-h-11 w-full">
          <SelectValue placeholder={merchantId ? 'Recorded merchant' : 'Not recorded'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not recorded</SelectItem>
          {entries.map((m) => (
            <SelectItem key={m.id} value={m.id} disabled={m.state === 'retired'}>
              {m.displayName}
              {m.state === 'retired' ? ' (retired)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {loading
          ? 'Loading merchants…'
          : notice ||
            (entries.length
              ? `${entries.length} saved merchants shown.`
              : q
                ? 'No matching merchants. You can create one below.'
                : 'No saved merchants yet. Manual entry is available below.')}
      </p>
      {page.hasMore ? (
        <Button
          className="min-h-11"
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => void more()}
        >
          Load more merchants
        </Button>
      ) : null}
      {error ? (
        <div role="alert" className="grid gap-2 text-sm">
          <p>{error}</p>
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry merchants
          </Button>
          <p>You can keep the merchant Not recorded and save the item.</p>
        </div>
      ) : null}
      <div role="group" className="flex flex-wrap gap-2" aria-label="Common merchant suggestions">
        {['Amazon', 'Flipkart'].map((displayName) => (
          <Button
            className="min-h-11"
            key={displayName}
            type="button"
            variant="outline"
            onClick={() => void change(() => saveMerchant({ displayName }))}
          >
            {displayName}
          </Button>
        ))}
      </div>
      <details className="grid min-w-0 gap-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm leading-5 focus-visible:outline-2">
          Create a custom merchant
        </summary>
        <div className="grid gap-3 py-3">
          <Label htmlFor={`${id}-custom`}>Merchant name</Label>
          <Input
            className="min-h-11"
            id={`${id}-custom`}
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
          <Label htmlFor={`${id}-host`}>Website host (optional)</Label>
          <Input
            className="min-h-11"
            id={`${id}-host`}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="shop.example.test"
            maxLength={253}
            autoComplete="off"
          />
          <p className="text-sm text-muted-foreground">
            Leave the host empty for an offline seller.
          </p>
          <Button
            className="min-h-11"
            type="button"
            variant="outline"
            disabled={!customName.trim()}
            onClick={() =>
              void change(() =>
                saveMerchant({ displayName: customName, websiteHost: host || null }),
              )
            }
          >
            Create and select merchant
          </Button>
        </div>
      </details>
      {merchant ? (
        <>
          <Button
            className="min-h-11"
            type="button"
            variant="ghost"
            onClick={() => {
              setManage(!manage);
              setCustomName(merchant.displayName);
              setHost(merchant.websiteHost ?? '');
            }}
          >
            Correct or retire merchant
          </Button>
          {manage ? (
            <div className="grid gap-3 rounded-md border p-3">
              <p className="text-sm">
                Corrections apply to this merchant everywhere in your inventory. Retiring keeps
                historical links and prevents new assignments.
              </p>
              <Label htmlFor={`${id}-rename`}>Correct merchant name</Label>
              <Input
                className="min-h-11"
                id={`${id}-rename`}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                maxLength={120}
              />
              <Label htmlFor={`${id}-correct-host`}>Correct website host</Label>
              <Input
                className="min-h-11"
                id={`${id}-correct-host`}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                maxLength={253}
              />
              <Button
                className="min-h-11"
                type="button"
                variant="outline"
                onClick={() =>
                  void change(
                    () =>
                      merchantRequest<Merchant>(`/${merchant.id}`, 'PATCH', {
                        displayName: customName,
                        websiteHost: host || null,
                      }),
                    false,
                  )
                }
              >
                Save merchant correction
              </Button>
              <Button
                className="min-h-11"
                type="button"
                variant="outline"
                onClick={() =>
                  void change(
                    () =>
                      merchantRequest<Merchant>(`/${merchant.id}`, 'PATCH', {
                        state: merchant.state === 'active' ? 'retired' : 'active',
                      }),
                    false,
                  )
                }
              >
                {merchant.state === 'active' ? 'Retire merchant' : 'Restore merchant'}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      <Label htmlFor={`${id}-purchaseUrl`}>Purchase URL (optional)</Label>
      <Input
        id={`${id}-purchaseUrl`}
        type="url"
        value={purchaseUrl}
        onChange={(e) => onUrl(e.target.value)}
        maxLength={2048}
        autoComplete="off"
        spellCheck={false}
        className="min-h-11"
        aria-invalid={Boolean(urlError)}
        aria-describedby={`${id}-url-help${urlError ? ` ${id}-purchaseUrl-error` : ''}`}
      />
      <p id={`${id}-url-help`} className="text-sm text-muted-foreground">
        An absolute HTTP or HTTPS link without a login or password. Leave empty for Not recorded;
        you can clear it independently.
      </p>
    </fieldset>
  );
}
