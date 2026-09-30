import { Target } from 'lucide-react';
import type { ReactElement } from 'react';
import { CollectionEmptyState } from '@/components/collection-empty-state';
import { PageHeading } from '@/components/page-heading';

export default function GoalsPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="Goals"
        title="Keep the other possibility in view."
        description="Compare a planned purchase with something meaningful while keeping estimated avoided spend separate from actual savings."
      />
      <section className="mt-10" aria-label="Goals">
        <CollectionEmptyState
          icon={Target}
          title="No goals yet"
          description="Goal tracking and explicit savings allocation remain part of their own product ticket."
        />
      </section>
    </main>
  );
}
