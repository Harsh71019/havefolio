'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import type {
  CreateReviewRequest,
  Desire,
  DesireConversion,
  ItemListEntry,
  ReviewEvent,
  ReviewHistoryPage,
  ReviewOutcome,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Textarea } from '@havefolio/ui/components/textarea';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  getConversion,
  getDesire,
  readReviews,
  recordReview,
  reviewItems,
  DesireRequestError,
} from './desires-client';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  getEffectiveStateLabel,
} from './desire-presentation';
import { PageLoadFailure } from './page-load-failure';
import { randomId } from './random-id';
import { pageTitleClassName } from './page-heading';
const labels: Record<ReviewOutcome, string> = {
  bought: 'Bought',
  delayed: 'Delayed',
  declined: 'Declined',
  used_owned: 'Using something already owned',
};
const errorMessage = (error: unknown): string =>
  error instanceof DesireRequestError
    ? error.message
    : 'Could not load or save this decision. Try again.';
export function DecisionHistory({ desireId }: { desireId: string }): ReactElement {
  const [desire, setDesire] = useState<Desire | null>(null);
  const [page, setPage] = useState<ReviewHistoryPage | null>(null);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome>('delayed');
  const [note, setNote] = useState('');
  const [reviewAt, setReviewAt] = useState('');
  const [correction, setCorrection] = useState<string | null>(null);
  const [items, setItems] = useState<ItemListEntry[] | null>(null);
  const [nextItem, setNextItem] = useState<string | null>(null);
  const [itemId, setItemId] = useState('');
  const [itemBusy, setItemBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [conversion, setConversion] = useState<DesireConversion | null>(null);
  const pending = useRef<CreateReviewRequest | null>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const [d, p] = await Promise.all([
        getDesire(desireId, signal),
        readReviews(desireId, undefined, signal),
      ]);
      setDesire(d);
      setPage(p);
      setEvents(p.items);
      setCorrection(null);
    },
    [desireId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getDesire(desireId, controller.signal),
      readReviews(desireId, undefined, controller.signal),
    ])
      .then(([d, p]) => {
        if (!controller.signal.aborted) {
          setDesire(d);
          setPage(p);
          setEvents(p.items);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [desireId]);
  // PER-29: the optional inventory offer never blocks reading or recording decisions.
  const status = desire?.status;
  const revision = desire?.revision;
  useEffect(() => {
    if (!status) return;
    const controller = new AbortController();
    void getConversion(desireId, controller.signal)
      .then((c) => {
        if (!controller.signal.aborted) setConversion(c.conversion);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [desireId, status, revision]);
  const loadItems = async (after?: string): Promise<void> => {
    setItemBusy(true);
    setError('');
    try {
      const p = await reviewItems(after);
      setItems((old) => (after ? [...(old ?? []), ...p.items] : p.items));
      setNextItem(p.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setItemBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!desire || busy) return;
    setError('');
    setSuccess('');
    if (!uncertain) {
      if (
        outcome === 'delayed' &&
        (!reviewAt ||
          !Number.isFinite(new Date(reviewAt).getTime()) ||
          new Date(reviewAt).getTime() <= Date.now())
      ) {
        setError('Choose a future review date and time.');
        return;
      }
      if (outcome === 'used_owned' && !itemId) {
        setError('Choose an owned item.');
        return;
      }
      pending.current = {
        commandId: randomId(),
        revision: desire.revision,
        outcome,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(outcome === 'delayed' ? { reviewAt: new Date(reviewAt).toISOString() } : {}),
        ...(['bought', 'used_owned'].includes(outcome) && itemId ? { linkedItemId: itemId } : {}),
        ...(correction ? { supersedesEventId: correction } : {}),
      };
    }
    setBusy(true);
    try {
      await recordReview(desireId, pending.current!);
      await reload();
      pending.current = null;
      setUncertain(false);
      setNote('');
      setItemId('');
      setSuccess('Decision recorded.');
    } catch (e) {
      // Keep the exact original command on ambiguous network/server failures, even if refresh failed after commit.
      setUncertain(
        pending.current !== null &&
          (!(e instanceof DesireRequestError) || e.status === 0 || e.status >= 500),
      );
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      notice.current?.focus();
    }
  };
  const more = async (): Promise<void> => {
    if (!page?.nextBefore) return;
    setBusy(true);
    setError('');
    try {
      const p = await readReviews(desireId, page.nextBefore);
      setEvents((old) => [...old, ...p.items]);
      setPage(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div role="status" aria-label="Loading decision history">
        <Skeleton className="h-40 w-full" />
        <span className="sr-only">Loading decision history…</span>
      </div>
    );
  if (!desire || !page)
    return (
      <PageLoadFailure
        heading="Decision history"
        message={error}
        onRetry={() =>
          reload().then(
            () => setError(''),
            (e: unknown) => setError(errorMessage(e)),
          )
        }
        backHref="/wants"
        backLabel="Back to Wants"
      />
    );
  const resolved = ['bought', 'declined', 'used_owned'].includes(desire.status);
  return (
    <div className="space-y-6">
      <Link
        href="/wants"
        className="inline-flex min-h-11 items-center underline underline-offset-4"
      >
        Back to Wants
      </Link>
      <header className="space-y-2">
        <h1 className={pageTitleClassName}>Decision history</h1>
        <h2 className="text-lg break-words">{desire.name}</h2>
        <p>{getEffectiveStateLabel(desire.effectiveState)}</p>
        <p className="text-sm text-muted-foreground">
          Record what happened and keep earlier decisions visible. Corrections add a new event.
        </p>
      </header>
      <p
        ref={notice}
        tabIndex={-1}
        role={error ? 'alert' : 'status'}
        className="text-sm break-words"
      >
        {error || success}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Current estimate</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {page.estimatedNotSpentMinor !== null
              ? `${formatLikelyPrice(page.estimatedNotSpentMinor, page.currency)} estimated not spent`
              : desire.status === 'declined'
                ? 'Amount not known'
                : 'No current declined estimate'}
          </p>
          <p className="text-sm text-muted-foreground">
            An estimate in the recorded currency, counted once for this desire. This is not savings.
          </p>
        </CardContent>
      </Card>
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`/wants/${desireId}/allocate`}>Allocate to a goal / allocation history</Link>
      </Button>
      {conversion || desire.status === 'bought' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Inventory</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm break-words">
            {conversion ? (
              <p>
                Added to your inventory as{' '}
                <Link href={`/items/${conversion.itemId}`} className="underline">
                  {conversion.itemName}
                </Link>
                .
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Your bought decision is complete on its own. You can also add the item to your
                  inventory by confirming what you paid and when.
                </p>
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={`/wants/${desireId}/convert`}>Add to inventory (optional)</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
      {resolved && !correction ? (
        <Button
          className="min-h-11"
          onClick={() => {
            setCorrection(page.currentEventId);
            setSuccess('');
          }}
        >
          Correct latest decision
        </Button>
      ) : null}
      {!resolved || correction ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{correction ? 'Correct latest decision' : 'Record a decision'}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <fieldset disabled={busy || uncertain} className="space-y-4">
                <legend className="mb-3 text-sm font-medium">Outcome</legend>
                {correction ? (
                  <p className="text-sm text-muted-foreground">
                    This supersedes the latest decision and preserves the original event. Earlier
                    historical events stay unchanged.
                  </p>
                ) : null}
                <RadioGroup
                  value={outcome}
                  onValueChange={(v) => {
                    setOutcome(v as ReviewOutcome);
                    setError('');
                  }}
                  aria-label="Outcome"
                  className="gap-3"
                >
                  {(Object.keys(labels) as ReviewOutcome[]).map((o) => (
                    <div key={o} className="flex items-center gap-3 min-h-11">
                      <RadioGroupItem value={o} id={`outcome-${o}`} />
                      <Label htmlFor={`outcome-${o}`} className="min-h-11 flex-1">
                        {labels[o]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                {outcome === 'delayed' ? (
                  <div className="space-y-2">
                    <Label htmlFor="review-time">Next review (local date and time)</Label>
                    <Input
                      id="review-time"
                      className="min-h-11"
                      type="datetime-local"
                      value={reviewAt}
                      onChange={(e) => setReviewAt(e.target.value)}
                      required
                    />
                    <p className="text-sm text-muted-foreground">
                      A new reminder replaces the previous schedule.
                    </p>
                  </div>
                ) : null}
                {['bought', 'used_owned'].includes(outcome) ? (
                  <fieldset className="space-y-3">
                    <legend>Linked owned item {outcome === 'bought' ? '(optional)' : ''}</legend>
                    <p className="text-sm text-muted-foreground">
                      Recording bought does not create an inventory item or a purchase amount.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void loadItems()}
                      disabled={itemBusy}
                    >
                      {itemBusy ? 'Loading items…' : 'Choose from owned items'}
                    </Button>
                    {items ? (
                      <RadioGroup
                        value={itemId}
                        onValueChange={setItemId}
                        aria-label="Linked owned item"
                      >
                        <div className="flex gap-3 min-h-11 items-center">
                          <RadioGroupItem id="item-none" value="" />
                          <Label htmlFor="item-none" className="min-h-11 flex-1">
                            No linked item
                          </Label>
                        </div>
                        {items.map((i) => (
                          <div key={i.id} className="flex gap-3 min-h-11 items-center">
                            <RadioGroupItem id={`item-${i.id}`} value={i.id} />
                            <Label htmlFor={`item-${i.id}`} className="min-h-11 flex-1 break-words">
                              {i.name}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    ) : null}
                    {items?.length === 0 ? <p>No owned items on this page.</p> : null}
                    {nextItem ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadItems(nextItem)}
                        disabled={itemBusy}
                      >
                        More owned items
                      </Button>
                    ) : null}
                  </fieldset>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="review-note">Private note (optional)</Label>
                  <Textarea
                    id="review-note"
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </fieldset>
              {uncertain ? (
                <p className="text-sm">
                  The result is unconfirmed. Retry the same submission to check its saved state.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy} className="min-h-11">
                  {busy
                    ? 'Saving…'
                    : uncertain
                      ? 'Retry same decision'
                      : correction
                        ? 'Record correction'
                        : 'Record decision'}
                </Button>
                {correction && !uncertain ? (
                  <Button
                    className="min-h-11"
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setCorrection(null)}
                  >
                    Cancel correction
                  </Button>
                ) : null}
                <Button
                  className="min-h-11"
                  type="button"
                  variant="outline"
                  disabled={busy || uncertain}
                  onClick={() => {
                    setError('');
                    void reload().catch((e) => setError(errorMessage(e)));
                  }}
                >
                  Reload history
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <section aria-labelledby="timeline-title" className="space-y-4">
        <h2 id="timeline-title" className="text-lg font-semibold">
          Timeline
        </h2>
        <p className="text-sm text-muted-foreground">
          Newest first. Historical estimate snapshots are not additional amounts.
        </p>
        {events.length === 0 ? (
          <p>No decisions recorded yet.</p>
        ) : (
          <ol className="space-y-4" aria-label="Decision timeline">
            {events.map((e) => (
              <li key={e.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      <h3>
                        {labels[e.outcome]}
                        {e.id === page.currentEventId ? ' · Current decision' : ''}
                      </h3>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      <time dateTime={e.occurredAt}>
                        {formatReviewDateTime(e.occurredAt) || 'Date unavailable'}
                      </time>{' '}
                      · Event {e.sequence}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm break-words">
                    {e.supersedesEventId ? (
                      <p>
                        Correction of event{' '}
                        {events.find((old) => old.id === e.supersedesEventId)?.sequence ??
                          e.supersedesEventId}
                        . Original retained.
                      </p>
                    ) : null}
                    {e.note ? (
                      <p className="whitespace-pre-wrap">{e.note}</p>
                    ) : (
                      <p className="text-muted-foreground">No note added.</p>
                    )}
                    {e.reviewAt ? (
                      <p>Next review: {formatReviewDateTime(e.reviewAt) || 'Date unavailable'}</p>
                    ) : null}
                    {e.linkedItemId ? (
                      <p>
                        Linked item:{' '}
                        {e.linkedItemName ? (
                          <Link href={`/items/${e.linkedItemId}`} className="underline">
                            {e.linkedItemName}
                          </Link>
                        ) : (
                          'Item unavailable'
                        )}
                      </p>
                    ) : null}
                    {e.outcome === 'declined' ? (
                      <p>
                        Historical estimate:{' '}
                        {e.estimatedNotSpentMinor === null
                          ? 'Amount not known'
                          : formatLikelyPrice(e.estimatedNotSpentMinor, e.currency)}
                        . Not savings.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
        {page.nextBefore ? (
          <Button variant="outline" disabled={busy} onClick={() => void more()}>
            Load earlier decisions
          </Button>
        ) : null}
      </section>
    </div>
  );
}
