'use client';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { DownloadIcon, FileTextIcon, ImagesIcon, Trash2Icon } from 'lucide-react';
import {
  itemDocumentLimits,
  type ItemDocument,
  type ItemDocumentKind,
  type ItemDocumentSnapshot,
  type ItemPhotoSnapshot,
} from '@havefolio/contracts';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@havefolio/ui/components/alert-dialog';
import { Button } from '@havefolio/ui/components/button';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  DocumentRequestError,
  documentDownloadUrl,
  documentSelectionError,
  documentSize,
} from './documents-client';
import { photoAlt, photoSource } from './photos-client';

export type Loadable<T> =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; disabled?: boolean }
  | { kind: 'ready'; value: T };

/** The cover and a strip of photos; all changes happen in the PER-15 photo manager. */
export function ItemPhotosSummary({
  itemId,
  itemName,
  state,
  manageHref,
  onRetry,
}: {
  itemId: string;
  itemName: string;
  state: Loadable<ItemPhotoSnapshot>;
  manageHref: string;
  onRetry: () => void;
}): ReactElement {
  const photos = state.kind === 'ready' ? state.value.photos : [];
  const cover = photos[0];
  return (
    <section aria-labelledby="photos-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="photos-heading" className="text-lg font-semibold">
          Photos
          {state.kind === 'ready' ? (
            <span className="font-normal text-muted-foreground"> ({photos.length})</span>
          ) : null}
        </h2>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={manageHref}>
            <ImagesIcon aria-hidden="true" />
            {photos.length ? 'Manage photos' : 'Add photos'}
          </Link>
        </Button>
      </div>
      {state.kind === 'loading' ? (
        <Skeleton aria-hidden="true" className="aspect-[4/3] w-full motion-reduce:animate-none" />
      ) : null}
      {state.kind === 'failed' ? (
        <div role="alert" className="space-y-3 rounded-lg border border-dashed p-4 text-sm">
          <p>Photos could not load. {state.message}</p>
          <Button variant="outline" className="min-h-11" onClick={onRetry}>
            Try loading photos again
          </Button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <ItemCover
            className="rounded-xl border"
            fit="contain"
            loading="eager"
            emptyLabel="No photos yet"
            cover={
              cover
                ? photoSource(
                    itemId,
                    cover,
                    cover.decorative ? '' : (cover.altText ?? `Cover photo of ${itemName}`),
                    '(min-width: 1024px) 24rem, 92vw',
                    { large: true },
                  )
                : null
            }
          />
          {photos.length > 1 ? (
            <ul className="grid grid-cols-4 gap-2" aria-label="More photos">
              {photos.slice(1, 5).map((photo, index) => (
                <li
                  key={photo.id}
                  className="relative aspect-square overflow-hidden rounded-md bg-muted"
                >
                  <PrivatePhoto
                    {...photoSource(
                      itemId,
                      photo,
                      photoAlt(photo, index + 1, photos.length),
                      '6rem',
                    )}
                    announceFailure={false}
                    failedLabel={`Photo ${index + 2} could not load.`}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {photos.length > 5 ? (
            <p className="text-sm text-muted-foreground">
              {photos.length - 5} more in the photo manager.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const kindLabels: Record<ItemDocumentKind, string> = { receipt: 'Receipt', warranty: 'Warranty' };

/**
 * Receipts and warranties, kept apart from photos. Files are fetched only through the
 * authenticated download endpoint; no storage location is ever shown or linked.
 */
export function ItemDocuments({
  itemId,
  state,
  online,
  onRetry,
  onUpload,
  onDelete,
}: {
  itemId: string;
  state: Loadable<ItemDocumentSnapshot>;
  online: boolean;
  onRetry: () => void;
  onUpload: (kind: ItemDocumentKind, file: File, uploadId: string) => Promise<ItemDocument>;
  onDelete: (document: ItemDocument, revision: number) => Promise<void>;
}): ReactElement {
  const id = useId();
  const [kind, setKind] = useState<ItemDocumentKind>('receipt');
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | undefined>();
  const [removing, setRemoving] = useState<ItemDocument | undefined>();
  const [removeError, setRemoveError] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);
  // Retrying the same file reuses its Upload-Id so a completed upload is recovered, not duplicated.
  const attempt = useRef<{ file: File; kind: ItemDocumentKind; uploadId: string } | undefined>(
    undefined,
  );
  const inFlight = useRef(false);

  const documents = state.kind === 'ready' ? state.value.documents : [];
  const full = documents.length >= itemDocumentLimits.maxDocumentsPerItem;

  async function upload(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    if (!file) {
      setMessage({ error: true, text: 'Choose a file to upload.' });
      fileInput.current?.focus();
      return;
    }
    const invalid = documentSelectionError(file);
    if (invalid) {
      setMessage({ error: true, text: invalid });
      fileInput.current?.focus();
      return;
    }
    if (attempt.current?.file !== file || attempt.current.kind !== kind)
      attempt.current = { file, kind, uploadId: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await onUpload(kind, file, attempt.current.uploadId);
      attempt.current = undefined;
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      setMessage({ error: false, text: `${kindLabels[kind]} added.` });
    } catch (error) {
      const failed = error instanceof DocumentRequestError ? error : undefined;
      if (failed?.code === 'DOCUMENT_UPLOAD_RECOVERED') attempt.current = undefined;
      setMessage({
        error: true,
        text: `${failed?.message ?? 'The upload could not be confirmed.'} Your file is still selected; try again.`,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!removing || state.kind !== 'ready' || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRemoveError(undefined);
    try {
      await onDelete(removing, state.value.revision);
      setMessage({ error: false, text: `${kindLabels[removing.kind]} removed.` });
      setRemoving(undefined);
    } catch (error) {
      setRemoveError(
        error instanceof DocumentRequestError
          ? `${error.message} If removal was interrupted, the document stays hidden and cleanup is retried.`
          : 'The document could not be removed. Try again.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="documents-heading" className="space-y-3">
      <div>
        <h2 id="documents-heading" className="text-lg font-semibold">
          Receipts and warranties
        </h2>
        <p className="text-sm text-muted-foreground">
          Private documents, kept separate from photos. Downloads require your sign-in.
        </p>
      </div>
      {state.kind === 'loading' ? (
        <Skeleton aria-hidden="true" className="h-16 w-full motion-reduce:animate-none" />
      ) : null}
      {state.kind === 'failed' ? (
        state.disabled ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {state.message}
          </p>
        ) : (
          <div role="alert" className="space-y-3 rounded-lg border border-dashed p-4 text-sm">
            <p>Documents could not load. {state.message}</p>
            <Button variant="outline" className="min-h-11" onClick={onRetry}>
              Try loading documents again
            </Button>
          </div>
        )
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {documents.length ? (
            <ul className="divide-y rounded-lg border">
              {documents.map((doc, index) => {
                const label = `${kindLabels[doc.kind]} ${documents.filter((d, i) => d.kind === doc.kind && i <= index).length}`;
                return (
                  <li key={doc.id} className="flex flex-wrap items-center gap-3 p-3">
                    <FileTextIcon
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1 basis-32">
                      <p className="font-medium">{label}</p>
                      <p className="text-sm text-muted-foreground">
                        {doc.mimeType === 'application/pdf' ? 'PDF' : 'Image'} ·{' '}
                        {documentSize(doc.byteSize)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button asChild variant="ghost" className="min-h-11">
                        <a
                          href={documentDownloadUrl(itemId, doc.id)}
                          download
                          aria-label={`Download ${label}`}
                        >
                          <DownloadIcon aria-hidden="true" />
                          Download
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        aria-label={`Remove ${label}`}
                        disabled={!online || busy}
                        onClick={() => {
                          setRemoveError(undefined);
                          setRemoving(doc);
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No receipts or warranties yet. Adding them is optional.
            </p>
          )}
          <form
            noValidate
            onSubmit={(e) => void upload(e)}
            className="grid min-w-0 gap-3 rounded-lg border p-3"
            aria-labelledby={`${id}-upload-heading`}
          >
            <h3 id={`${id}-upload-heading`} className="font-medium">
              Add a document
            </h3>
            <fieldset disabled={busy || !online || full} className="grid min-w-0 gap-3">
              <legend className="sr-only">Document type</legend>
              <RadioGroup
                value={kind}
                onValueChange={(value) => setKind(value as ItemDocumentKind)}
                className="flex flex-wrap gap-x-6 gap-y-1"
                aria-label="Document type"
              >
                {(['receipt', 'warranty'] as const).map((value) => (
                  <Label
                    key={value}
                    htmlFor={`${id}-kind-${value}`}
                    className="flex min-h-11 items-center gap-3 font-normal"
                  >
                    <RadioGroupItem id={`${id}-kind-${value}`} value={value} />
                    {kindLabels[value]}
                  </Label>
                ))}
              </RadioGroup>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={`${id}-file`}>File</Label>
                <Input
                  ref={fileInput}
                  id={`${id}-file`}
                  type="file"
                  accept={itemDocumentLimits.acceptedMimeTypes.join(',')}
                  className="min-h-11 min-w-0 py-2"
                  aria-describedby={`${id}-file-hint`}
                  onChange={(e) => {
                    setFile(e.target.files?.[0]);
                    setMessage(undefined);
                  }}
                />
                <p id={`${id}-file-hint`} className="text-sm text-muted-foreground">
                  PDF up to 20 MB, or a JPEG, PNG or WebP image up to 10 MB.
                  {full ? ' The limit of 16 documents is reached.' : ''}
                </p>
              </div>
              <Button type="submit" variant="outline" className="min-h-11 justify-self-start">
                {busy && !removing ? 'Uploading…' : 'Upload document'}
              </Button>
            </fieldset>
            {message ? (
              <p role={message.error ? 'alert' : 'status'} className="text-sm">
                {message.text}
              </p>
            ) : null}
          </form>
        </>
      ) : null}
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => (!open && !busy ? setRemoving(undefined) : undefined)}
      >
        <AlertDialogContent className="motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this {removing ? kindLabels[removing.kind].toLowerCase() : 'document'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The private file is removed from Havefolio. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Not removed</AlertTitle>
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="min-h-11" disabled={busy}>
              Keep it
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={busy || !online}
              onClick={() => void remove()}
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
