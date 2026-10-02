import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { TaxonomyManagement } from '@/components/taxonomy-management';

export const metadata: Metadata = { title: 'Categories & tags' };
export default function TaxonomyPage(): ReactElement {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Categories & tags</h1>
        <p className="text-muted-foreground">
          Organise your possessions in a way that makes sense to you.
        </p>
      </header>
      <TaxonomyManagement />
    </main>
  );
}
