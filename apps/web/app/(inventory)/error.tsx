'use client';

import { useEffect } from 'react';
import { captureRenderError } from '../../instrumentation-client';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

// PER-75: inside the app shell the failure sits on the content rail instead of a centred card.
export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): ReactElement {
  useEffect(() => captureRenderError(error), [error]);
  return (
    <PageShell width="form">
      <PageHeading
        title="We could not open this page."
        description="Your data has not been changed. Try loading the page again."
      />
      <div className="flex flex-wrap gap-3">
        <Button type="button" className="min-h-11" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            Go home
          </Link>
        </Button>
      </div>
    </PageShell>
  );
}
