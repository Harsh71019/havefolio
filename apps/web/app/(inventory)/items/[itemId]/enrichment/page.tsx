import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductEnrichment } from '@/components/product-enrichment';
export const metadata: Metadata = { title: 'Product suggestions' };
export default async function ProductEnrichmentPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}): Promise<React.JSX.Element> {
  const { itemId } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(itemId))
    notFound();
  return <ProductEnrichment key={itemId} itemId={itemId} />;
}
