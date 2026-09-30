import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';

export default function NotFoundPage(): ReactElement {
  return (
    <main className="grid min-h-[70svh] place-items-center px-5 py-12">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>That page is not in your home.</CardTitle>
          <CardDescription>Check the address or return to the household index.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
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
