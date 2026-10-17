import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { DesireCompare } from '@/components/desire-compare';

export const metadata: Metadata = {
  title: 'Compare before buying',
  description: 'Compare your desire beside relevant possessions and make an intentional decision.',
};

export default async function DesireComparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mb-6">
        <PageHeading
          eyebrow="Wants"
          title="Compare before buying"
          description="Consider what you already have and reflect on what a new purchase would do differently."
        />
      </div>
      <DesireCompare desireId={id} />
    </main>
  );
}
