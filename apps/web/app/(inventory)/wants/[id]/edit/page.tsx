import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto mb-6 max-w-xl">
        <PageHeading
          eyebrow="Wants"
          title="Review and update desire"
          description="Adjust your thoughts, change waiting periods or remove what you decided against."
        />
      </div>
      <EditDesireForm desireId={id} />
    </main>
  );
}
