import { Onboarding } from '@/components/onboarding';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { MyStore } from '@/components/my-store';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'My Store' };

// Server-rendered shell; owner data loads client-side through the same-origin session API.
export default function StorePage(): ReactElement {
  return (
    <PageShell width="full">
      <PageHeading
        title="My Store"
        action={
          <Button asChild className="h-11">
            <Link href="/items/new">
              <Plus aria-hidden="true" className="mr-2 size-4" />
              Add item
            </Link>
          </Button>
        }
      />
      <Onboarding store />
      <MyStore />
    </PageShell>
  );
}
