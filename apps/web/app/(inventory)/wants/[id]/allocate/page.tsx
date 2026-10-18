import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesireAllocationFlow } from '@/components/desire-allocation';
export const metadata: Metadata = { title: 'Goal allocation' };
export default async function AllocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <DesireAllocationFlow key={id} desireId={id} />
    </main>
  );
}
