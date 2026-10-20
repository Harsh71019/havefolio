import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { AddItemForm } from '@/components/add-item-form';

export const metadata: Metadata = {
  title: 'Add item',
  description: 'Fast manual item entry for your private inventory.',
};

export default function NewItemPage(): ReactElement {
  return (
    <PageShell width="form">
      <PageHeading
        eyebrow="My Store"
        title="Add an item to your home"
        description="Record a possession in under a minute without receipts, links or bank connections."
      />
      {/* PER-75: the form centres each of its states; pin them to the rail without touching it. */}
      <div className="*:mx-0">
        <AddItemForm />
      </div>
    </PageShell>
  );
}
