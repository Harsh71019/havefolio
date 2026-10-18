import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { GoalForm } from '@/components/goal-form';
import { PageHeading } from '@/components/page-heading';

export const metadata: Metadata = { title: 'Edit goal' };

export default async function EditGoalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <PageHeading
        eyebrow="Goals"
        title="Edit goal"
        description="Edits never rewrite confirmed contributions."
      />
      <div className="mt-8">
        <GoalForm key={id} goalId={id} />
      </div>
    </main>
  );
}
