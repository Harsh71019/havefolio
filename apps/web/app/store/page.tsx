import { Archive } from 'lucide-react';
import type { ReactElement } from 'react';
import { CollectionEmptyState } from '@/components/collection-empty-state';
import { PageHeading } from '@/components/page-heading';

export default function StorePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="My Store"
        title="The useful things you already own."
        description="Searchable inventory, honest purchase details and gentle prompts to use what is already at home."
      />
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
