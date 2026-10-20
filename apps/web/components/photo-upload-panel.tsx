'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Image from 'next/image';
import type { ItemPhoto } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Progress } from '@havefolio/ui/components/progress';
import { selectionError, uploadPhoto } from './photos-client';
import { canConvertHeic, convertHeic, isHeic } from './heic-conversion';
import { randomId } from './random-id';
import { useOnlineStatus } from './use-online-status';

interface Selection {
  /** Stable Upload-Id: kept across uncertain retries, rotated only after confirmed recovery. */
  id: string;
  key: string;
  /** Exact bytes sent on every retry; HEIC is converted once, before the first attempt. */
  file: File;
  /** Original file name, shown when a converted copy is uploaded. */
  name: string;
  converted: boolean;
  preview: string;
  status: 'preparing' | 'selected' | 'uploading' | 'saved' | 'failed' | 'rejected';
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
  if (f.status === 'preparing') return 'Preparing photo on this device…';
  if (f.status === 'saved') return 'Saved privately';
  if (f.status === 'rejected') return 'Not uploaded';
  if (f.status === 'failed') return 'Not confirmed saved';
  if (f.status === 'uploading')
    return f.progress === 100 ? 'Processing and saving…' : `Uploading ${f.progress}%`;
  return f.converted ? 'Converted from HEIC to JPEG · Ready to upload' : 'Ready to upload';
}

const noSubscribe = (): (() => void) => () => undefined;

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
  // File selections made before handlers are attached cannot be replayed reliably.
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [files, setFiles] = useState<Selection[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [heicSupported, setHeicSupported] = useState(false);
  const online = useOnlineStatus();
  const previews = useRef(new Set<string>());
  const requests = useRef(new Set<XMLHttpRequest>());
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const urls = previews.current;
    const pending = requests.current;
    void canConvertHeic().then((supported) => mounted.current && setHeicSupported(supported));
    return () => {
      mounted.current = false;
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
      const id = randomId();
      return {
        id,
        key: id,
        file,
        name: file.name,
        converted: false,
        preview: '',
        status: 'preparing',
        progress: 0,
      };
    });
    setFiles((previous) => [...previous, ...added]);
    void prepare(added);
  }

  // Sequential so only one full-resolution decode is in memory at a time.
  async function prepare(rows: Selection[]): Promise<void> {
    for (const row of rows) {
      let file = row.file;
      let converted = false;
      let error: string | undefined;
      if (await isHeic(file)) {
        const result = await convertHeic(file);
        if (result.ok) {
          file = result.file;
          converted = true;
        } else error = result.message;
      }
      error ??= selectionError(file);
      if (!mounted.current) return;
      const preview = error ? '' : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      update(row.key, {
        file,
        converted,
        preview,
        status: error ? 'rejected' : 'selected',
        error,
      });
    }
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

  function cancel(): void {
    cancelled.current = true;
    requests.current.forEach((req) => req.abort());
  }

  async function upload(): Promise<void> {
    setBusy(true);
    setNotice('');
    cancelled.current = false;
    let saved = 0;
    let failed = 0;
    try {
      // Only unsaved, valid files are sent; confirmed photos are never uploaded twice.
      for (const f of files.filter((row) => row.status === 'selected' || row.status === 'failed')) {
        if (cancelled.current) break;
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
            ...(outcome.recovered ? { id: randomId() } : {}),
          });
        }
      }
    } finally {
      setBusy(false);
      onFinished?.({ saved, failed });
    }
  }

  const savedCount = files.filter((f) => f.status === 'saved').length;
  const preparing = files.some((f) => f.status === 'preparing');
  const accept = heicSupported
    ? 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
    : 'image/jpeg,image/png,image/webp';
  const failedCount = files.filter((f) => f.status === 'failed').length;
  const uploading = files.find((f) => f.status === 'uploading');
  const counted = files.filter((f) => f.status !== 'rejected').length;
  const blocked = !ready || disabled || busy;
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
            accept={accept}
            multiple={multiple}
            disabled={blocked || limit <= 0}
            onChange={(e) => {
              select(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {heicSupported
          ? 'HEIC/HEIF photos are converted to JPEG on this device before upload; location and other photo metadata are removed.'
          : 'If a HEIC/HEIF photo is rejected, export it as JPEG, PNG or WebP, or add photos later from the item.'}
      </p>
      {!online ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          You&apos;re offline. Selected photos stay on this page only — they are never stored on
          this device. Upload when you&apos;re back online; retrying never duplicates a saved photo.
        </p>
      ) : null}
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
                  <p className="text-sm break-all">{f.name}</p>
                  <p className="text-sm text-muted-foreground">{statusText(f)}</p>
                </div>
                {f.status !== 'saved' && f.status !== 'preparing' ? (
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
          disabled={
            blocked ||
            preparing ||
            !files.some((f) => f.status === 'selected' || f.status === 'failed')
          }
          onClick={() => void upload()}
        >
          {busy ? 'Saving photos…' : failedCount ? 'Upload or retry unsaved photos' : uploadLabel}
        </Button>
        {busy ? (
          <Button className="min-h-11" variant="outline" onClick={cancel}>
            Cancel upload
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
