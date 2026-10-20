import type { ReactElement } from 'react';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { PageShell } from '@/components/page-shell';

// PER-75 & PER-88: reserves the heading and content rails without an artificial eyebrow.
export default function Loading(): ReactElement {
  return (
    <PageShell width="wide" aria-busy="true">
      <span className="sr-only">Preparing your household index…</span>
      <div className="mb-8 space-y-2">
        <Skeleton className="h-8 w-64 max-w-sm motion-reduce:animate-none sm:h-9" />
        <Skeleton className="h-5 w-full max-w-md motion-reduce:animate-none" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-64 w-full rounded-xl motion-reduce:animate-none" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-xl motion-reduce:animate-none" />
          <Skeleton className="h-48 w-full rounded-xl motion-reduce:animate-none" />
        </div>
      </div>
    </PageShell>
  );
}
