import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { AddDesireForm } from '@/components/add-desire-form';

export const metadata: Metadata = {
  title: 'Add desire',
  description: 'Record what you are considering without judgment.',
};

export default function NewDesirePage(): ReactElement {
  return (
    <PageShell width="form">
      <PageHeading
        eyebrow="Wants"
        title="Add a desire to consider"
        description="Capture what you're thinking of buying and create intentional space before deciding."
      />
      {/* PER-75: the form centres each of its states; pin them to the rail without touching it. */}
      <div className="*:mx-0">
        <AddDesireForm />
      </div>
    </PageShell>
  );
}
