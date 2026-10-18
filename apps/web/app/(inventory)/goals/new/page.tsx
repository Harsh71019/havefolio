import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { GoalForm } from '@/components/goal-form';
import { PageHeading } from '@/components/page-heading';

export const metadata: Metadata = { title: 'New goal' };

export default function NewGoalPage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <PageHeading
        eyebrow="Goals"
        title="New goal"
        description="Name something meaningful to compare purchases against."
      />
      <div className="mt-8">
        <GoalForm />
      </div>
    </main>
  );
}
