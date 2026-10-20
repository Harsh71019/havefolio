import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { GoalForm } from '@/components/goal-form';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'New goal' };

export default function NewGoalPage(): ReactElement {
  return (
    <PageShell width="form">
      <PageHeading
        eyebrow="Goals"
        title="New goal"
        description="Name something meaningful to compare purchases against."
      />
      <GoalForm />
    </PageShell>
  );
}
