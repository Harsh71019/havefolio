import { Onboarding } from '@/components/onboarding';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { MyStore } from '@/components/my-store';

export const metadata: Metadata = { title: 'My Store' };

// Server-rendered shell; owner data loads client-side through the same-origin session API.
export default function StorePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-[112rem] px-4 py-4 sm:px-8 sm:py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">My Store</h1>
        <Button asChild className="h-10">
          <Link href="/items/new">
            <Plus aria-hidden="true" className="mr-2 size-4" />
            Add item
          </Link>
        </Button>
      </div>
      <Onboarding store />
      <MyStore />
    </main>
  );
}
