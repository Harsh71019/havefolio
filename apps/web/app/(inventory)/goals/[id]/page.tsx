import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { GoalDetail } from '@/components/goal-detail';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'Goal' };

export default async function GoalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  return (
    <PageShell width="content">
      <GoalDetail key={id} goalId={id} />
    </PageShell>
  );
}
