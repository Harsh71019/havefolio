'use client';

import { RotateCcw } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>): ReactElement {
  return (
    <main className="grid min-h-[70svh] place-items-center px-5 py-12">
      <Card className="w-full max-w-xl shadow-none">
        <CardContent>
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Havefolio</p>
          <h1 className="mt-3 font-display text-4xl font-medium">We could not open this page.</h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            Your data has not been changed. Try loading the page again.
          </p>
          <Button className="mt-6" type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
