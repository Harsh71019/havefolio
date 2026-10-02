'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import type { ItemPhoto } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Progress } from '@havefolio/ui/components/progress';
import { selectionError, uploadPhoto } from './photos-client';

interface Selection {
  /** Stable Upload-Id: kept across uncertain retries, rotated only after confirmed recovery. */
  id: string;
  key: string;
  file: File;
  preview: string;
  status: 'selected' | 'uploading' | 'saved' | 'failed' | 'rejected';
  progress: number;
  error?: string | undefined;
}

export interface PhotoUploadPanelProps {
  itemId: string;
  /** Free photo slots on the item, if known. The API still enforces the limit. */
  remaining: number;
  multiple?: boolean;
  disabled?: boolean;
  idPrefix?: string;
  uploadLabel?: string;
  onSaved?: (photo: ItemPhoto) => void | Promise<void>;
  onFinished?: (summary: { saved: number; failed: number }) => void;
  children?: ReactNode;
}

function statusText(f: Selection): string {
  if (f.status === 'saved') return 'Saved privately';
  if (f.status === 'rejected') return 'Not uploaded';
  if (f.status === 'failed') return 'Not confirmed saved';
  if (f.status === 'uploading')
    return f.progress === 100 ? 'Processing and saving…' : `Uploading ${f.progress}%`;
  return 'Ready to upload';
}

export function PhotoUploadPanel({
  children,
  disabled = false,
  idPrefix = 'photo',
  itemId,
  multiple = true,
  onFinished,
  onSaved,
  remaining,
  uploadLabel = 'Upload photos',
}: PhotoUploadPanelProps): React.JSX.Element {
  const [files, setFiles] = useState<Selection[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const previews = useRef(new Set<string>());
  const requests = useRef(new Set<XMLHttpRequest>());
  useEffect(() => {
    const urls = previews.current;
    const pending = requests.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      pending.forEach((req) => req.abort());
    };
  }, []);
  const unsaved = files.filter((f) => f.status !== 'saved' && f.status !== 'rejected');
  const limit = multiple ? remaining : Math.min(1, remaining);

  function select(list: FileList | null): void {
    if (!list?.length) return;
    setNotice('');
    const incoming = Array.from(list);
    if (unsaved.length + incoming.length > limit) {
      setNotice(
        limit <= 0
          ? 'This item already has 8 photos. Delete one before adding another.'
          : `Select up to ${limit} more photo${limit === 1 ? '' : 's'}.`,
      );
      return;
    }
    const added = incoming.map((file): Selection => {
      const error = selectionError(file);
      const preview = error ? '' : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      const id = crypto.randomUUID();
      return {
        id,
        key: id,
        file,
        preview,
        status: error ? 'rejected' : 'selected',
        progress: 0,
        error,
      };
    });
    setFiles((previous) => [...previous, ...added]);
  }

  function update(key: string, change: Partial<Selection>): void {
    setFiles((previous) => previous.map((f) => (f.key === key ? { ...f, ...change } : f)));
  }

  function remove(f: Selection): void {
    if (f.preview) {
      URL.revokeObjectURL(f.preview);
      previews.current.delete(f.preview);
    }
    setFiles((previous) => previous.filter((row) => row.key !== f.key));
  }

  async function upload(): Promise<void> {
    setBusy(true);
    setNotice('');
    let saved = 0;
    let failed = 0;
    try {
      // Only unsaved, valid files are sent; confirmed photos are never uploaded twice.
      for (const f of files.filter((row) => row.status === 'selected' || row.status === 'failed')) {
        update(f.key, { status: 'uploading', progress: 0, error: undefined });
        const outcome = await uploadPhoto(
          itemId,
          f.id,
          f.file,
          (progress) => update(f.key, { progress }),
          (req) => {
            requests.current.add(req);
            return () => requests.current.delete(req);
          },
        );
        if (outcome.ok) {
          saved++;
          update(f.key, { status: 'saved', progress: 100 });
          await onSaved?.(outcome.photo);
        } else {
          failed++;
          update(f.key, {
            status: 'failed',
            error: outcome.message,
            ...(outcome.recovered ? { id: crypto.randomUUID() } : {}),
          });
        }
      }
    } finally {
      setBusy(false);
      onFinished?.({ saved, failed });
    }
  }

  const savedCount = files.filter((f) => f.status === 'saved').length;
  const failedCount = files.filter((f) => f.status === 'failed').length;
  const uploading = files.find((f) => f.status === 'uploading');
  const counted = files.filter((f) => f.status !== 'rejected').length;
  const blocked = disabled || busy;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-camera`}>Take a photo</Label>
          <Input
            className="min-h-11"
            id={`${idPrefix}-camera`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={blocked || limit <= 0}
            onChange={(e) => {
              select(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-gallery`}>Choose from gallery or files</Label>
          <Input
            className="min-h-11"
            id={`${idPrefix}-gallery`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple={multiple}
            disabled={blocked || limit <= 0}
            onChange={(e) => {
              select(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      {notice ? (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      ) : null}
      {files.length ? (
        <ul className="space-y-4" aria-label="Selected photos">
          {files.map((f, index) => (
            <li key={f.key} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                {f.preview ? (
                  /* Local object URLs never reach the server or a remote image optimizer. */ <Image
                    unoptimized
                    width={80}
                    height={80}
                    src={f.preview}
                    alt={`Preview of selected photo ${index + 1}`}
                    className="size-20 shrink-0 rounded-md bg-muted object-contain"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-all">{f.file.name}</p>
                  <p className="text-sm text-muted-foreground">{statusText(f)}</p>
                </div>
                {f.status !== 'saved' ? (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => remove(f)}
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              {f.status === 'uploading' ? (
                <Progress
                  aria-label={`Upload progress for photo ${index + 1}`}
                  value={f.progress}
                  className="motion-reduce:[&_*]:transition-none"
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
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {uploading
          ? `Uploading photo ${files.indexOf(uploading) + 1} of ${files.length}.`
          : savedCount
            ? `${savedCount} of ${counted} photos saved.${failedCount ? ` ${failedCount} not saved — retry ${failedCount === 1 ? 'it' : 'them'} below.` : ''}`
            : 'Select photos to preview before uploading.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          className="min-h-11"
          disabled={blocked || !files.some((f) => f.status === 'selected' || f.status === 'failed')}
          onClick={() => void upload()}
        >
          {busy ? 'Saving photos…' : failedCount ? 'Upload or retry unsaved photos' : uploadLabel}
        </Button>
        {children}
      </div>
    </div>
  );
}
