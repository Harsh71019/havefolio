import { Heart } from 'lucide-react';
import type { ReactElement } from 'react';
import { CollectionEmptyState } from '@/components/collection-empty-state';
import { PageHeading } from '@/components/page-heading';

export default function WantsPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="Wants"
        title="Make room between wanting and buying."
        description="Capture what you are considering, why it matters and what you already own that may serve the same purpose."
      />
      <section className="mt-10" aria-label="Wants">
        <CollectionEmptyState
          icon={Heart}
          title="Nothing is waiting for a decision"
          description="The desire and waiting-period workflow will arrive in its dedicated ticket."
        />
      </section>
    </main>
  );
}
