import { Archive, Plus } from 'lucide-react';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { CollectionEmptyState } from '@/components/collection-empty-state';
import { PageHeading } from '@/components/page-heading';

export default function StorePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeading
          eyebrow="My Store"
          title="The useful things you already own."
          description="Searchable inventory, honest purchase details and gentle prompts to use what is already at home."
        />
        <Button asChild className="h-11 self-start sm:self-auto">
          <Link href="/items/new">
            <Plus aria-hidden="true" className="mr-2 size-4" />
            Add item
          </Link>
        </Button>
      </div>
      <section className="mt-10" aria-label="Inventory">
        <CollectionEmptyState
          icon={Archive}
          title="Your shelves are ready"
          description="Owned-item entry arrives in its dedicated ticket. This state is ready for the first real item without inventing demo inventory."
        />
      </section>
    </main>
  );
}
