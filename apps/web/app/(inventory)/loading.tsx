import type { ReactElement } from 'react';
import { Skeleton } from '@havefolio/ui/components/skeleton';

export default function Loading(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12" aria-busy="true">
      <span className="sr-only">Preparing your household index…</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-5 h-12 w-full max-w-xl" />
      <Skeleton className="mt-4 h-6 w-full max-w-2xl" />
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </main>
  );
}
