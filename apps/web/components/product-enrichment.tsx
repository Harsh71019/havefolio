'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  EnrichmentField,
  EnrichmentRequest,
  EnrichmentReview,
  EnrichmentReviewEvent,
  EnrichmentWork,
  ItemResponse,
} from '@havefolio/contracts';
import { validBarcode } from '@havefolio/domain';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Card, CardContent } from '@havefolio/ui/components/card';
import { Textarea } from '@havefolio/ui/components/textarea';
import { readItem } from './items-client';
import { randomId } from './random-id';
import { BarcodeCamera } from './barcode-camera';
import { productEnrichmentApi } from './product-enrichment-client';
const label = (field: EnrichmentField): string =>
  field.startsWith('specification:')
    ? field.slice(14)
    : field === 'image'
      ? 'Product image'
      : field[0]!.toUpperCase() + field.slice(1);
const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'Suggestions are temporarily unavailable.';
export function ProductEnrichment({
  itemId,
  api = productEnrichmentApi,
  loadItem = readItem,
}: {
  itemId: string;
  api?: typeof productEnrichmentApi;
  loadItem?: typeof readItem;
}): React.JSX.Element {
  const [item, setItem] = useState<ItemResponse | null>(null),
    [works, setWorks] = useState<EnrichmentWork[]>([]),
    [before, setBefore] = useState<string | null>(null),
    [url, setUrl] = useState(''),
    [barcode, setBarcode] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [events, setEvents] = useState<EnrichmentReviewEvent[]>([]),
    [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const requestCommand = useRef<{ key: string; body: EnrichmentRequest } | null>(null),
    reviewCommand = useRef<{ key: string; body: EnrichmentReview } | null>(null);
  useEffect(() => {
    let active = true;
    void loadItem(itemId)
      .then((i) => {
        if (active) {
          setItem(i);
          setUrl(i.purchaseUrl ?? '');
        }
      })
      .catch((e) => active && setError(message(e)));
    return () => {
      active = false;
    };
  }, [itemId, loadItem]);
  const act = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (): Promise<void> => {
    const [i, page] = await Promise.all([loadItem(itemId), api.list(itemId)]);
    // PER-43 cursors use UUID ordering, so a newly submitted pending job can be on a
    // later page. Resolve known active jobs within the existing 100-work item cap.
    const pending = new Set(
      works.filter((w) => ['pending', 'processing', 'retry'].includes(w.state)).map((w) => w.id),
    );
    const rows = [...page.items];
    let next = page.nextBefore;
    for (
      let pages = 1;
      next && pages < 10 && [...pending].some((id) => !rows.some((w) => w.id === id));
      pages++
    ) {
      const more = await api.list(itemId, next);
      rows.push(...more.items.filter((w) => !rows.some((r) => r.id === w.id)));
      next = more.nextBefore;
    }
    setItem(i);
    setWorks(rows);
    setBefore(next);
    requestCommand.current = null;
    reviewCommand.current = null;
    setStatus('Suggestions refreshed.');
  };
  const request = async (kind: 'url' | 'barcode'): Promise<void> => {
    if (!item) return;
    if (kind === 'barcode' && !validBarcode(barcode)) {
      setError('Enter a valid 8, 12, 13 or 14 digit GTIN with its check digit.');
      return;
    }
    const key = JSON.stringify([kind, kind === 'url' ? url : barcode, item.revision]);
    if (requestCommand.current?.key !== key)
      requestCommand.current = {
        key,
        body: {
          commandId: randomId(),
          revision: item.revision,
          kind,
          ...(kind === 'url'
            ? { url, providerConsent: 'public-product-metadata-v1' as const }
            : { barcode, providerConsent: 'open-food-facts-v1' as const }),
        },
      };
    const work = await api.request(itemId, requestCommand.current.body);
    requestCommand.current = null;
    setWorks((previous) => [work, ...previous.filter((w) => w.id !== work.id)]);
    setStatus('Request saved. Refresh suggestions to check its progress.');
  };
  const decide = async (
    w: EnrichmentWork,
    field: EnrichmentField,
    decision: EnrichmentReview['decision'],
    value?: string,
  ): Promise<void> => {
    if (!item || !selected[w.id]) return;
    const key = JSON.stringify([w.id, selected[w.id], field, decision, value]);
    if (reviewCommand.current?.key !== key)
      reviewCommand.current = {
        key,
        body: {
          commandId: randomId(),
          revision: item.revision,
          candidateId: selected[w.id]!,
          field,
          decision,
          ...(value === undefined ? {} : { value }),
        },
      };
    const event = await api.review(itemId, w.id, reviewCommand.current.body);
    // The returned revision allows a safe retry even if the following item refresh fails.
    setItem((previous) =>
      previous ? { ...previous, revision: event.resultingRevision } : previous,
    );
    reviewCommand.current = null;
    setEvents((previous) => [event, ...previous.filter((e) => e.id !== event.id)]);
    setStatus(
      `${label(field)} ${decision === 'reject' ? 'rejected' : decision === 'correct' ? 'corrected' : 'accepted'}.`,
    );
    setItem(await loadItem(itemId));
  };
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <Button className="min-h-11" asChild variant="ghost">
        <Link href={`/items/${encodeURIComponent(itemId)}`}>Back to item</Link>
      </Button>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Product suggestions</h1>
        <p className="break-words text-muted-foreground">{item?.name ?? 'Loading saved item…'}</p>
        <p>
          Choose a source, then review each field. Your original entry is kept. Price paid and
          purchase date stay under your control.
        </p>
      </header>
      {error ? (
        <p role="alert" className="rounded-md border p-3">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite">
        {status}
      </p>
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold">From a product link</h2>
          <p className="text-sm text-muted-foreground">
            Only requesting suggestions contacts this public website. No sign-in cookies or private
            inventory details are sent. Images are fetched only when you explicitly import one.
          </p>
          <Label htmlFor="product-url">Public product URL</Label>
          <Input
            className="min-h-11"
            id="product-url"
            disabled={!item || busy}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2048}
          />
          <Button
            className="min-h-11"
            disabled={busy || !item || item.isDemo || !url}
            onClick={() => void act(() => request('url'))}
          >
            Request link suggestions
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold">From a barcode</h2>
          <BarcodeCamera onChoose={setBarcode} />
          <Label htmlFor="product-barcode">Barcode number</Label>
          <Input
            className="min-h-11"
            id="product-barcode"
            disabled={!item || busy}
            inputMode="numeric"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            maxLength={14}
          />
          <p className="text-sm text-muted-foreground">
            Requesting sends this barcode to Open Food Facts. It covers food products; other items
            may have no match. Camera frames stay on your device.
          </p>
          <Button
            className="min-h-11"
            disabled={busy || !item || item.isDemo || !barcode}
            onClick={() => void act(() => request('barcode'))}
          >
            Request food barcode suggestions
          </Button>
        </CardContent>
      </Card>
      <section className="space-y-4" aria-labelledby="review-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="review-heading" className="text-lg font-semibold">
            Review suggestions
          </h2>
          <Button
            className="min-h-11"
            disabled={busy || !item}
            variant="outline"
            onClick={() => void act(refresh)}
          >
            Refresh suggestions
          </Button>
        </div>
        {!works.length ? (
          <p className="text-muted-foreground">
            No suggestions loaded. Request a source or refresh earlier requests. Manual item editing
            is always available.
          </p>
        ) : null}
        {works.map((w) => (
          <Card key={w.id}>
            <CardContent className="space-y-4">
              <p>
                Request {new Date(w.createdAt).toLocaleString()} · {w.state}
              </p>
              {w.state === 'succeeded' && !w.candidates.length ? (
                <p>No matching product found. Try another source or edit your item manually.</p>
              ) : null}
              {['pending', 'processing', 'retry'].includes(w.state) ? (
                <p>Suggestions are being checked. Refresh to see progress.</p>
              ) : null}
              {['failed', 'unconfigured', 'stale'].includes(w.state) ? (
                <p>
                  This request is unavailable or out of date. Refresh the item, then make a new
                  explicit request. Manual editing remains available.
                </p>
              ) : null}
              {w.candidates.length ? (
                <fieldset className="space-y-3">
                  <legend className="font-medium">
                    Choose the matching product ({w.candidates.length} candidates)
                  </legend>
                  {w.candidates.map((c, index) => (
                    <Label key={c.id} className="flex min-h-11 items-center gap-3 break-words">
                      <input
                        type="radio"
                        name={`candidate-${w.id}`}
                        checked={selected[w.id] === c.id}
                        onChange={() => setSelected((p) => ({ ...p, [w.id]: c.id }))}
                      />
                      <span>
                        Candidate {index + 1}:{' '}
                        {c.fields.find((f) => f.field === 'name')?.value ?? 'Product details'}
                      </span>
                    </Label>
                  ))}
                </fieldset>
              ) : null}
              {w.candidates
                .find((c) => c.id === selected[w.id])
                ?.fields.map((f) => {
                  const key = `${w.id}:${selected[w.id]}:${f.field}`;
                  const current = f.field.startsWith('specification:')
                    ? item?.specifications?.[f.field.slice(14)]
                    : f.field === 'image'
                      ? null
                      : item?.[f.field as 'name' | 'brand' | 'model' | 'description'];
                  return (
                    <div key={f.field} className="space-y-3 rounded-md border p-4">
                      <h3 className="font-semibold">{label(f.field)}</h3>
                      <p className="break-words text-sm text-muted-foreground">
                        Current:{' '}
                        {current === null || current === undefined
                          ? 'Not recorded'
                          : typeof current === 'string'
                            ? current
                            : JSON.stringify(current)}
                      </p>
                      <p className="break-all whitespace-pre-wrap">{f.value}</p>
                      <p className="break-all text-sm text-muted-foreground">
                        Source: {f.source.provider} · confidence {Math.round(f.confidence * 100)}%
                        (estimate)
                        <br />
                        {f.source.reference}
                      </p>
                      {f.source.provider === 'open-food-facts' ? (
                        <p className="text-sm">
                          <a
                            className="underline"
                            href="https://world.openfoodfacts.org/terms-of-use"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open Food Facts contributors · ODbL / DbCL; images CC BY-SA
                          </a>
                        </p>
                      ) : null}
                      {f.field !== 'image' ? (
                        <>
                          <Label htmlFor={`edit-${encodeURIComponent(key)}`}>
                            Correct {label(f.field)}
                          </Label>
                          <Textarea
                            id={`edit-${encodeURIComponent(key)}`}
                            maxLength={
                              f.field === 'description'
                                ? 5000
                                : f.field.startsWith('specification:')
                                  ? 1000
                                  : 300
                            }
                            value={edits[key] ?? f.value}
                            onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
                          />
                        </>
                      ) : (
                        <p className="text-sm">
                          No remote preview is loaded. Import validates and stores a private photo.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="min-h-11"
                          disabled={busy}
                          onClick={() => void act(() => decide(w, f.field, 'accept'))}
                        >
                          {f.field === 'image'
                            ? 'Import private image'
                            : `Accept ${label(f.field)}`}
                        </Button>
                        {f.field !== 'image' ? (
                          <Button
                            className="min-h-11"
                            disabled={busy}
                            variant="outline"
                            onClick={() =>
                              void act(() => decide(w, f.field, 'correct', edits[key] ?? f.value))
                            }
                          >
                            Save correction
                          </Button>
                        ) : null}
                        <Button
                          className="min-h-11"
                          disabled={busy}
                          variant="outline"
                          onClick={() => void act(() => decide(w, f.field, 'reject'))}
                        >
                          Reject {label(f.field)}
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        ))}
        {before ? (
          <Button
            className="min-h-11"
            disabled={busy}
            variant="outline"
            onClick={() =>
              void act(async () => {
                const page = await api.list(itemId, before);
                setWorks((p) => [...p, ...page.items.filter((w) => !p.some((x) => x.id === w.id))]);
                setBefore(page.nextBefore);
              })
            }
          >
            Load more requests
          </Button>
        ) : null}
      </section>
      <section className="space-y-3" aria-labelledby="enrichment-history">
        <h2 id="enrichment-history" className="text-lg font-semibold">
          Review history
        </h2>
        <Button
          className="min-h-11"
          disabled={busy}
          variant="outline"
          onClick={() =>
            void act(async () => {
              const page = await api.history(itemId);
              setEvents(page.items);
              setHistoryBefore(page.nextBefore);
            })
          }
        >
          Load review history
        </Button>
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.id} className="rounded-md border p-3 break-words">
              {label(e.field)} · {e.decision}
              <br />
              Previous: {e.previousValue ?? 'Not recorded'}
              <br />
              Confirmed: {e.confirmedValue ?? 'Not recorded'}
              <br />
              <span className="text-sm text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
        {historyBefore ? (
          <Button
            className="min-h-11"
            disabled={busy}
            variant="outline"
            onClick={() =>
              void act(async () => {
                const page = await api.history(itemId, historyBefore);
                setEvents((p) => [
                  ...p,
                  ...page.items.filter((e) => !p.some((x) => x.id === e.id)),
                ]);
                setHistoryBefore(page.nextBefore);
              })
            }
          >
            Load more decisions
          </Button>
        ) : null}
      </section>
    </main>
  );
}
