'use client';

import { AlertCircle, ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Button } from '@havefolio/ui/components/button';

/**
 * PER-36: page-level read failure. Keeps the page's level-one heading, explains that nothing
 * changed, and offers a busy-aware retry plus a way back, all at 44 px touch targets.
 */
export function PageLoadFailure({
  heading,
  message,
  onRetry,
  backHref,
  backLabel,
}: Readonly<{
  /** Omit when the page already renders its own level-one heading. */
  heading?: string;
  message: string;
  onRetry?: () => Promise<unknown>;
  backHref: string;
  backLabel: string;
}>): ReactElement {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="space-y-6">
      {heading ? <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1> : null}
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>Could not load</AlertTitle>
        <AlertDescription>
          <p>{message}</p>
          <p>Nothing has been changed.</p>
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-3">
        {onRetry ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={retrying}
            aria-busy={retrying}
            onClick={() => {
              setRetrying(true);
              void onRetry().finally(() => setRetrying(false));
            }}
          >
            <RotateCcw aria-hidden="true" />
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        ) : null}
        <Button asChild variant="outline" className="min-h-11">
          <Link href={backHref}>
            <ArrowLeft aria-hidden="true" />
            {backLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
