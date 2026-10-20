import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { DesireMatches } from '@/components/desire-matches';

export const metadata: Metadata = {
  title: 'Connected possessions',
  description: 'Consider existing possessions that might fulfill this need before buying.',
};

export default async function DesireMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    notFound();
  }

  return (
    <PageShell width="content">
      <PageHeading
        eyebrow="Wants"
        title="Consider your possessions"
        description="Explore items you already own that may fulfill the same purpose without assuming equivalence."
      />
      <DesireMatches desireId={id} />
    </PageShell>
  );
}
