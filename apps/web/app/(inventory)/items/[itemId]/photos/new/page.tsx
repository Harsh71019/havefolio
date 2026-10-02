import { notFound } from 'next/navigation';
import { PhotoCapture } from '@/components/photo-capture';
export default async function PhotoCapturePage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}): Promise<React.JSX.Element> {
  const { itemId } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(itemId))
    notFound();
  return <PhotoCapture itemId={itemId} />;
}
