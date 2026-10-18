import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { DesireGoalComparison } from '@/components/desire-goal-comparison';
import { PageHeading } from '@/components/page-heading';

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
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <Link className="text-sm underline underline-offset-4" href="/wants">
        Back to Wants
      </Link>
      <div className="mt-4 mb-8">
        <PageHeading
          eyebrow="Wants"
          title="Compare with a goal"
          description="See what this purchase could mean for something else you care about. Nothing here changes a goal."
        />
      </div>
      <DesireGoalComparison key={id} desireId={id} />
    </main>
  );
}
