'use client';
import type { ReactElement } from 'react';
import type { ItemEvent } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { auditTime, describeEvent, eventDay, recordedSeparately } from './item-detail-presentation';

export type HistoryState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'ready';
      events: ItemEvent[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError?: string;
    };

/**
 * A semantic ordered list, oldest first, so it reads as text without any visual timeline.
 * Corrections are their own entries; earlier entries are never rewritten.
 */
export function ItemHistory({
  state,
  onRetry,
  onLoadMore,
}: {
  state: HistoryState;
  onRetry: () => void;
  onLoadMore: () => void;
}): ReactElement {
  return (
    <section aria-labelledby="history-heading" className="space-y-4">
      <div>
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        <p className="text-sm text-muted-foreground">
          What happened to it, oldest first. Past entries are kept as they were recorded.
        </p>
      </div>
      {state.kind === 'loading' ? (
        <div aria-hidden="true" className="space-y-3">
          <Skeleton className="h-12 w-full motion-reduce:animate-none" />
          <Skeleton className="h-12 w-full motion-reduce:animate-none" />
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <div role="alert" className="space-y-3 rounded-lg border border-dashed p-4 text-sm">
          <p>History could not load. {state.message}</p>
          <Button variant="outline" className="min-h-11" onClick={onRetry}>
            Try loading history again
          </Button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <ol className="relative space-y-0 border-l pl-5" aria-label="Item history, oldest first">
            {state.events.map((event) => {
              const entry = describeEvent(event);
              return (
                <li key={event.id} className="relative pb-5 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-foreground"
                  />
                  <p className="font-medium">{entry.title}</p>
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={event.occurredAt}>{eventDay(event.occurredAt)}</time>
                    {recordedSeparately(event) ? (
                      <>
                        {' · recorded '}
                        <time dateTime={event.createdAt}>{auditTime(event.createdAt)}</time>
                      </>
                    ) : null}
                  </p>
                  {entry.detail ? <p className="text-sm">{entry.detail}</p> : null}
                  {entry.note ? (
                    <p className="mt-1 text-sm break-words whitespace-pre-line">
                      <span className="text-muted-foreground">Note: </span>
                      {entry.note}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {state.nextCursor ? (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={state.loadingMore}
                onClick={onLoadMore}
              >
                {state.loadingMore ? 'Loading…' : 'Show later entries'}
              </Button>
              {state.moreError ? (
                <p role="alert" className="text-sm">
                  {state.moreError}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
