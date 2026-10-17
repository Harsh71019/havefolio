import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { AddDesireForm } from '@/components/add-desire-form';

export const metadata: Metadata = {
  title: 'Add desire',
  description: 'Record what you are considering without judgment.',
};

export default function NewDesirePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto mb-6 max-w-xl">
        <PageHeading
          eyebrow="Wants"
          title="Add a desire to consider"
          description="Capture what you're thinking of buying and create intentional space before deciding."
        />
      </div>
      <AddDesireForm />
    </main>
  );
}
