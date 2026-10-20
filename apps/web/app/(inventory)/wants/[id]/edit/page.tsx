import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { EditDesireForm } from '@/components/edit-desire-form';

export const metadata: Metadata = {
  title: 'Edit desire',
  description: 'Reflect on and update what you are considering.',
};

export default async function EditDesirePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
    notFound();
  }

  return (
    <PageShell width="form">
      <PageHeading
        eyebrow="Wants"
        title="Review and update desire"
        description="Adjust your thoughts, change waiting periods or remove what you decided against."
      />
      {/* PER-75: the form centres each of its states; pin them to the rail without touching it. */}
      <div className="*:mx-0">
        <EditDesireForm desireId={id} />
      </div>
    </PageShell>
  );
}
