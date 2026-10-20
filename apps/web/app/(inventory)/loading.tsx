import type { ReactElement } from 'react';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { PageShell } from '@/components/page-shell';

// PER-75: reserves the compact heading on the same rail the loaded page uses.
export default function Loading(): ReactElement {
  return (
    <PageShell width="wide" aria-busy="true">
      <span className="sr-only">Preparing your household index…</span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-full max-w-xl sm:h-9" />
        <Skeleton className="h-6 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </PageShell>
  );
}
