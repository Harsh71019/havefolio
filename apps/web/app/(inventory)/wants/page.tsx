import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { DesiresList } from '@/components/desires-list';

export const metadata: Metadata = {
  title: 'Wants',
  description: 'Make room between wanting and buying. Reflect on what you are considering.',
};

export default function WantsPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mb-8">
        <PageHeading
          eyebrow="Wants"
          title="Make room between wanting and buying."
          description="Capture what you are considering and give yourself breathing room to reflect before deciding."
        />
      </div>
      <section aria-label="Desires list">
        <DesiresList />
      </section>
    </main>
  );
}
