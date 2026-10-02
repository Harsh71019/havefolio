'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import Image from 'next/image';
interface Selection {
  id: string;
  file: File;
  preview: string;
  status: 'selected' | 'uploading' | 'saved' | 'failed';
  progress: number;
  error?: string | undefined;
}
const messages: Record<string, string> = {
  PHOTO_HEIC_UNSUPPORTED: 'HEIC/HEIF is not supported. Export as JPEG, PNG or WebP.',
  PHOTO_FORMAT_MISMATCH: 'The file type, extension and contents must match JPEG, PNG or WebP.',
  PHOTO_INVALID: 'This image could not be decoded safely. Choose another image.',
  PHOTO_FILE_SIZE: 'Choose a photo smaller than 10 MiB.',
  PHOTO_PROCESSING_BUSY: 'Image processing is busy. Try this photo again shortly.',
  PHOTO_QUOTA_EXCEEDED: 'The photo limit is reached (8 per item).',
  PHOTO_UPLOAD_PENDING:
    'The previous attempt is being recovered. Keep this page open and retry later.',
  PHOTO_UPLOAD_RECOVERED: 'The failed attempt has been cleaned up. Retry to start a new upload.',
  MEDIA_STORAGE_DISABLED: 'Private photo storage is not enabled yet.',
  STALE_ITEM_REVISION: 'The item changed. Reload before continuing.',
};
export function PhotoCapture({ itemId }: { itemId: string }): React.JSX.Element {
  const [files, setFiles] = useState<Selection[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const previews = useRef(new Set<string>());
  const requests = useRef(new Set<XMLHttpRequest>());
  useEffect(
    () => () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
      requests.current.forEach((req) => req.abort());
    },
    [],
  );
  function select(list: FileList | null): void {
    if (!list) return;
    setNotice('');
    const incoming = Array.from(list);
    if (files.length + incoming.length > 8) {
      setNotice('Select up to 8 photos.');
      return;
    }
    const added = incoming.map((file) => {
      let error: string | undefined;
      if (file.size === 0 || file.size > 10 * 1024 * 1024) error = messages.PHOTO_FILE_SIZE;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        error = 'Choose JPEG, PNG or WebP. HEIC/HEIF is not supported.';
      const preview = error ? '' : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      return {
        id: crypto.randomUUID(),
        file,
        preview,
        status: error ? ('failed' as const) : ('selected' as const),
        progress: 0,
        error,
      };
    });
    setFiles((previous) => [...previous, ...added]);
  }
  function update(id: string, change: Partial<Selection>): void {
    setFiles((previous) => previous.map((f) => (f.id === id ? { ...f, ...change } : f)));
  }
  async function upload(): Promise<void> {
    setBusy(true);
    setNotice('');
    try {
      for (const file of files.filter((f) => f.status !== 'saved' && f.preview)) {
        update(file.id, { status: 'uploading', progress: 0, error: undefined });
        await new Promise<void>((resolve) => {
          const req = new XMLHttpRequest();
          requests.current.add(req);
          req.open('POST', `/api/v1/items/${itemId}/photos`);
          req.setRequestHeader('Upload-Id', file.id);
          req.timeout = 150_000;
          req.upload.onprogress = (e) => {
            if (e.lengthComputable)
              update(file.id, { progress: Math.round((e.loaded / e.total) * 100) });
          };
          const failed = (message: string, recovered = false): void => {
            update(file.id, {
              status: 'failed',
              error: message,
              ...(recovered ? { id: crypto.randomUUID() } : {}),
            });
            requests.current.delete(req);
            resolve();
          };
          req.onerror = () =>
            failed('Connection interrupted. Retry this photo to check its saved state.');
          req.ontimeout = () =>
            failed('Upload timed out. Retry this photo to check its saved state.');
          req.onabort = () => failed('Upload cancelled. Retry to check its saved state.');
          req.onload = () => {
            try {
              const response = JSON.parse(req.responseText) as {
                message?: string;
                results?: { photo?: { id: string }; error?: string }[];
              };
              const result = response.results?.[0];
              if (req.status === 201 && result?.photo) {
                update(file.id, { status: 'saved', progress: 100 });
                requests.current.delete(req);
                resolve();
              } else
                failed(
                  req.status === 401
                    ? 'Sign in to add private photos.'
                    : req.status === 404
                      ? 'This item is unavailable.'
                      : (messages[result?.error ?? response.message ?? ''] ??
                        'Could not save this photo. Retry to check its saved state.'),
                  result?.error === 'PHOTO_UPLOAD_RECOVERED',
                );
            } catch {
              failed('Could not confirm the upload. Retry to check its saved state.');
            }
          };
          const form = new FormData();
          form.append('photos', file.file);
          req.send(form);
        });
      }
    } finally {
      setBusy(false);
    }
  }
  const saved = files.filter((f) => f.status === 'saved').length;
  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle>Add item photos</CardTitle>
          <p className="text-sm text-muted-foreground">
            Private JPEG, PNG or WebP photos. Up to 10 MiB each and 8 per item. HEIC/HEIF is not
            supported.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="photo-camera">Take a photo</Label>
              <Input
                className="min-h-11"
                id="photo-camera"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  select(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="photo-gallery">Choose from gallery or files</Label>
              <Input
                className="min-h-11"
                id="photo-gallery"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => {
                  select(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          {notice ? <p role="alert">{notice}</p> : null}
          <ul className="space-y-4">
            {files.map((f, index) => (
              <li key={f.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  {f.preview ? (
                    /* Local object URLs never reach the server or a remote image optimizer. */ <Image
                      unoptimized
                      width={80}
                      height={80}
                      src={f.preview}
                      alt={`Preview of selected photo ${index + 1}`}
                      className="h-20 w-20 rounded-md object-contain"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm">{f.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {f.status === 'saved'
                        ? 'Saved privately'
                        : f.status === 'uploading'
                          ? f.progress === 100
                            ? 'Processing and saving…'
                            : `Uploading ${f.progress}%`
                          : f.status === 'failed'
                            ? 'Not confirmed saved'
                            : 'Ready to upload'}
                    </p>
                  </div>
                  {f.status !== 'saved' ? (
                    <Button
                      className="min-h-11"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (f.preview) {
                          URL.revokeObjectURL(f.preview);
                          previews.current.delete(f.preview);
                        }
                        setFiles((previous) => previous.filter((row) => row.id !== f.id));
                      }}
                      aria-label={`Remove photo ${index + 1}`}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                {f.status === 'uploading' ? (
                  <progress
                    aria-label={`Upload progress for photo ${index + 1}`}
                    value={f.progress}
                    max={100}
                    className="w-full"
                  />
                ) : null}
                {f.error ? (
                  <p role="alert" className="text-sm">
                    {f.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p role="status" aria-live="polite">
            {saved
              ? `${saved} of ${files.length} photos saved.`
              : 'Select photos to preview before uploading.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className="min-h-11"
              disabled={busy || !files.some((f) => f.status !== 'saved' && f.preview)}
              onClick={() => void upload()}
            >
              {busy
                ? 'Saving photos…'
                : files.some((f) => f.status === 'failed')
                  ? 'Upload or retry unsaved photos'
                  : 'Upload photos'}
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`/items/${itemId}`}>Back to item</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
