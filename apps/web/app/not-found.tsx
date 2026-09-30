import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';

export default function NotFoundPage(): ReactElement {
  return (
    <main className="grid min-h-[70svh] place-items-center px-5 py-12">
      <Card className="w-full max-w-xl shadow-none">
        <CardContent>
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Havefolio</p>
          <h1 className="mt-3 font-display text-4xl font-medium">That page is not in your home.</h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            Check the address or return to the household index.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Go home
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
