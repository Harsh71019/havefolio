import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ItemDetails } from '@/components/item-details';

export const metadata: Metadata = { title: 'Item details' };

export default async function ItemDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { itemId } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(itemId))
    notFound();
  const { returnTo } = await searchParams;
  // The component re-validates; only a single same-origin My Store route is ever honoured.
  return (
    <ItemDetails
      key={itemId}
      itemId={itemId}
      returnTo={typeof returnTo === 'string' ? returnTo : undefined}
    />
  );
}
