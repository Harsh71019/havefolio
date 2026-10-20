import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { DesireGoalComparison } from '@/components/desire-goal-comparison';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'Compare with a goal' };

export default async function DesireGoalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  return (
    <PageShell width="content">
      <Link
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        href="/wants"
      >
        Back to Wants
      </Link>
      <PageHeading
        eyebrow="Wants"
        title="Compare with a goal"
        description="See what this purchase could mean for something else you care about. Nothing here changes a goal."
      />
      <DesireGoalComparison key={id} desireId={id} />
    </PageShell>
  );
}
