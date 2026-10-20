'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { itemPhotoLimits } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
import { PhotoUploadPanel } from './photo-upload-panel';
import { fetchPhotos } from './photos-client';
import { PageHeading } from './page-heading';
import { PageShell } from './page-shell';

export function PhotoCapture({ itemId }: { itemId: string }): React.JSX.Element {
  const [existing, setExisting] = useState<number | undefined>();
  const [added, setAdded] = useState(0);
  useEffect(() => {
    let active = true;
    // Best effort: the API enforces the photo limit even when this count is unavailable.
    fetchPhotos(itemId)
      .then((snapshot) => active && setExisting(snapshot.photos.length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [itemId]);
  const remaining = itemPhotoLimits.maxPhotosPerItem - (existing ?? 0) - added;
  return (
    <PageShell width="form">
      <PageHeading
        title="Add item photos"
        description={`Private JPEG, PNG or WebP photos, up to 10 MiB each and 8 per item. HEIC/HEIF is converted on this device where the browser supports it.${existing ? ` This item already has ${existing} of 8.` : ''}`}
      />
      <Card>
        <CardContent>
          <PhotoUploadPanel
            itemId={itemId}
            remaining={remaining}
            onSaved={() => setAdded((count) => count + 1)}
          >
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/items/${itemId}/photos`}>Manage photos</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/items/${itemId}`}>Back to item</Link>
            </Button>
          </PhotoUploadPanel>
        </CardContent>
      </Card>
    </PageShell>
  );
}
