'use client';

import { useEffect } from 'react';
import { captureRenderError } from '../../instrumentation-client';
import { RotateCcw } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';

export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): ReactElement {
  useEffect(() => captureRenderError(error), [error]);
  return (
    <main className="grid min-h-[70svh] place-items-center px-5 py-12">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1>We could not open this page.</h1>
          </CardTitle>
          <CardDescription>
            Your data has not been changed. Try loading the page again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
