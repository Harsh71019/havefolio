'use client';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { AlertCircle, PlusCircle, RotateCcw, Target } from 'lucide-react';
import { goalStatuses, type Goal, type GoalStatus } from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
import { Progress } from '@havefolio/ui/components/progress';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { CollectionEmptyState } from './collection-empty-state';
import { DesireRequestError } from './desires-client';
import { listGoals } from './goals-client';
import { goalProgressSummary, goalStatusLabels } from './goal-presentation';
import { calendarDay } from './home-presentation';

type Filter = 'all' | GoalStatus;
const filters: readonly Filter[] = ['all', ...goalStatuses];
export const goalMessage = (e: unknown): string =>
  e instanceof DesireRequestError ? e.message : 'Goals could not be loaded. Try again.';

export function GoalCard({ goal }: Readonly<{ goal: Goal }>): ReactElement {
  const view = goalProgressSummary(goal);
  const textId = `goal-progress-${goal.id}`;
  return (
    <Card className="py-0">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 text-lg font-semibold break-words">
            <Link
              href={`/goals/${goal.id}`}
              className="underline-offset-4 hover:underline focus-visible:underline"
            >
              {goal.name}
            </Link>
          </h2>
          <Badge variant={goal.status === 'active' ? 'secondary' : 'outline'}>
            {goalStatusLabels[goal.status]}
          </Badge>
        </div>
        {view.bar === null ? null : <Progress value={view.bar} aria-labelledby={textId} />}
        <p id={textId} className="text-sm tabular-nums break-words">
          {goal.name}: {view.text}
        </p>
        <p className="text-sm text-muted-foreground">
          {[view.remaining, goal.targetDate ? `Target date ${calendarDay(goal.targetDate)}` : null]
            .filter(Boolean)
            .join(' · ') || 'No target date'}
        </p>
      </CardContent>
    </Card>
  );
}

/** Bounded owner-scoped goal list; status filtering and keyset pagination happen in the API. */
export function GoalsList(): ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const controller = useRef<AbortController | null>(null);

  const fetchPage = useCallback((next: Filter): void => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    listGoals({ status: next === 'all' ? null : next }, c.signal)
      .then((page) => {
        if (c.signal.aborted) return;
        setGoals(page.items);
        setAfter(page.nextAfter);
        setAnnouncement(
          page.items.length ? `Showing ${page.items.length} goals.` : 'No goals found.',
        );
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted) setError(goalMessage(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
  }, []);
  useEffect(() => {
    fetchPage('all');
    return () => controller.current?.abort();
  }, [fetchPage]);
  const load = (next: Filter): void => {
    setLoading(true);
    setError('');
    setMoreError('');
    fetchPage(next);
  };

  const loadMore = (): void => {
    if (!after || loadingMore) return;
    setLoadingMore(true);
    setMoreError('');
    listGoals({ after, status: filter === 'all' ? null : filter })
      .then((page) => {
        setGoals((old) => [...old, ...page.items]);
        setAfter(page.nextAfter);
        setAnnouncement(`Showing ${goals.length + page.items.length} goals.`);
      })
      .catch((e: unknown) => setMoreError(goalMessage(e)))
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="space-y-6">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div role="group" aria-label="Filter goals by status" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            className="min-h-11"
            variant={filter === f ? 'secondary' : 'outline'}
            aria-pressed={filter === f}
            onClick={() => {
              if (f === filter) return;
              setFilter(f);
              load(f);
            }}
          >
            {f === 'all' ? 'All' : goalStatusLabels[f]}
          </Button>
        ))}
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading goals">
          {[0, 1].map((n) => (
            <Skeleton key={n} className="h-36 w-full" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="space-y-3 rounded-lg border p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden="true" />
            {error}
          </p>
          <Button variant="outline" className="min-h-11" onClick={() => load(filter)}>
            <RotateCcw className="mr-2 size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : goals.length === 0 ? (
        filter === 'all' ? (
          <div className="space-y-4">
            <CollectionEmptyState
              icon={Target}
              title="No goals yet"
              description="A goal keeps another possibility in view, like a trip, a course or an emergency fund. Progress counts only what you confirm."
            />
            <Button asChild className="min-h-11">
              <Link href="/goals/new">
                <PlusCircle className="mr-2 size-4" aria-hidden="true" />
                Create your first goal
              </Link>
            </Button>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
            No {goalStatusLabels[filter].toLowerCase()} goals.
          </p>
        )
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2" aria-label="Goals">
            {goals.map((g) => (
              <li key={g.id}>
                <GoalCard goal={g} />
              </li>
            ))}
          </ul>
          {moreError ? <p role="alert">{moreError}</p> : null}
          {after ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? 'Loading…' : 'Load more goals'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
