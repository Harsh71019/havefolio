import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { TaxonomyManagement } from '@/components/taxonomy-management';

export const metadata: Metadata = { title: 'Categories & tags' };
export default function TaxonomyPage(): ReactElement {
  return (
    <PageShell width="content">
      <PageHeading
        title="Categories & tags"
        description="Organise your possessions in a way that makes sense to you."
      />
      <TaxonomyManagement />
    </PageShell>
  );
}
