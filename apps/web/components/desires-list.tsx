'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import type { Desire, DesireEffectiveState } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Heart, PlusCircle, RotateCcw, AlertCircle, LogIn } from 'lucide-react';
import { CollectionEmptyState } from './collection-empty-state';
import { DesireCard } from './desire-card';
import { listDesires, DesireRequestError, effectiveStateInfo } from './desires-client';

type FilterState = 'all' | DesireEffectiveState;

export function DesiresList(): ReactElement {
  const [filter, setFilter] = useState<FilterState>('all');
  const [items, setItems] = useState<Desire[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Loading & error states
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthExpired, setIsAuthExpired] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadInitial = useCallback((targetFilter: FilterState): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    listDesires(
      {
        limit: 25,
        ...(targetFilter !== 'all' ? { effectiveState: targetFilter } : {}),
      },
      controller.signal,
    )
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setError(null);
        setIsAuthExpired(false);
        setIsLoading(false);
        setAnnouncement(
          page.items.length === 0 ? 'No desires found.' : `Loaded ${page.items.length} desires.`,
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof DesireRequestError && err.unauthenticated) {
          setIsAuthExpired(true);
        } else {
          setError(err instanceof Error ? err.message : 'Could not load desires.');
        }
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    loadInitial(filter);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [filter, loadInitial]);

  const handleFilterChange = (newFilter: FilterState): void => {
    if (newFilter === filter) return;
    setIsLoading(true);
    setFilter(newFilter);
    setNextCursor(null);
  };

  const handleLoadMore = async (): Promise<void> => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setPaginationError(null);

    try {
      const page = await listDesires({
        limit: 25,
        after: nextCursor,
        ...(filter !== 'all' ? { effectiveState: filter } : {}),
      });

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const newItems = page.items.filter((i) => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setAnnouncement(`Loaded ${page.items.length} more desires.`);
    } catch (err) {
      if (err instanceof DesireRequestError && err.unauthenticated) {
        setIsAuthExpired(true);
      } else {
        setPaginationError(err instanceof Error ? err.message : 'Could not load more desires.');
      }
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleItemDeleted = (deletedId: string): void => {
    setItems((prev) => prev.filter((i) => i.id !== deletedId));
    setAnnouncement('Desire deleted.');
  };

  return (
    <div className="space-y-6">
      {/* Accessible live region for status announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Filter Tabs / Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <nav
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Filter desires by effective state"
        >
          <Button
            type="button"
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="min-h-11 px-3 text-xs sm:text-sm font-medium"
            onClick={() => handleFilterChange('all')}
          >
            All
          </Button>
          {(
            [
              'considering',
              'waiting',
              'ready_for_review',
              'bought',
              'declined',
              'used_owned',
            ] as const
          ).map((key) => {
            const isSelected = filter === key;
            return (
              <Button
                key={key}
                type="button"
                variant={isSelected ? 'secondary' : 'ghost'}
                size="sm"
                className="min-h-11 px-3 text-xs sm:text-sm font-medium"
                onClick={() => handleFilterChange(key)}
              >
                {effectiveStateInfo[key].label}
              </Button>
            );
          })}
        </nav>

        <Button asChild size="sm" className="min-h-11">
          <Link href="/wants/new">
            <PlusCircle className="mr-1.5 size-4" aria-hidden="true" />
            Add desire
          </Link>
        </Button>
      </div>

      {/* Content states */}
      {isLoading ? (
        <div className="space-y-4" aria-label="Loading desires">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4 sm:p-5 space-y-3">
              <div className="flex gap-4">
                <Skeleton className="size-16 sm:size-20 rounded-md shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-64" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : isAuthExpired ? (
        <Card className="border-destructive/30" role="alert">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-3">
            <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Your session has expired</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Sign in to view and reflect on your private desires.
            </p>
            <Button asChild className="min-h-11">
              <Link href="/login">
                <LogIn className="mr-2 size-4" aria-hidden="true" />
                Sign in
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/30" role="alert">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-3">
            <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Could not load desires</h2>
            <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setIsLoading(true);
                loadInitial(filter);
              }}
            >
              <RotateCcw className="mr-2 size-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        filter === 'all' ? (
          <div className="space-y-4">
            <CollectionEmptyState
              icon={Heart}
              title="Nothing is waiting for a decision"
              description="Record products or services you are considering to reflect without pressure or shame."
            />
            <div className="flex justify-center">
              <Button asChild size="lg" className="min-h-11">
                <Link href="/wants/new">
                  <PlusCircle className="mr-2 size-4" aria-hidden="true" />
                  Record your first desire
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <CollectionEmptyState
              icon={Heart}
              title="No desires match this filter"
              description={`There are currently no desires in “${effectiveStateInfo[filter].label}” state.`}
            />
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setFilter('all')}
              >
                Show all wants
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:gap-4" role="feed" aria-label="Desires list">
            {items.map((desire) => (
              <DesireCard key={desire.id} desire={desire} onDeleted={handleItemDeleted} />
            ))}
          </div>

          {/* Pagination Controls */}
          {hasMore ? (
            <div className="flex flex-col items-center gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 px-6"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? 'Loading more...' : 'Load more desires'}
              </Button>
              {paginationError ? (
                <p className="text-xs text-destructive">{paginationError}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
