import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { AddItemForm } from '@/components/add-item-form';

export const metadata: Metadata = {
  title: 'Add item',
  description: 'Fast manual item entry for your private inventory.',
};

export default function NewItemPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto mb-6 max-w-xl">
        <PageHeading
          eyebrow="My Store"
          title="Add an item to your home"
          description="Record a possession in under a minute without receipts, links or bank connections."
        />
      </div>
      <AddItemForm />
    </main>
  );
}
