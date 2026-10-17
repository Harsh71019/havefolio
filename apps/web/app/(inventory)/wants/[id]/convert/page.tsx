import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesireConversionFlow } from '@/components/desire-conversion';
export const metadata: Metadata = { title: 'Add to inventory' };
export default async function ConvertDesirePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <DesireConversionFlow desireId={id} />
    </main>
  );
}
