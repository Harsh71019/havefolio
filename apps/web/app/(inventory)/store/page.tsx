import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { MyStore } from '@/components/my-store';
import { PageHeading } from '@/components/page-heading';

export const metadata: Metadata = { title: 'My Store' };

// Server-rendered shell; owner data loads client-side through the same-origin session API.
export default function StorePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeading
          eyebrow="My Store"
          title="The useful things you already own."
          description="Browse what is already at home, grouped the way you file it, before deciding you need something new."
        />
        <Button asChild className="h-11 self-start sm:self-auto">
          <Link href="/items/new">
            <Plus aria-hidden="true" className="mr-2 size-4" />
            Add item
          </Link>
        </Button>
      </div>
      <MyStore />
    </main>
  );
}
