'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ImagePlusIcon,
  MoreHorizontalIcon,
  StarIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-react';
import { itemPhotoLimits, type ItemPhoto, type ItemPhotoSnapshot } from '@havefolio/contracts';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@havefolio/ui/components/alert-dialog';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@havefolio/ui/components/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { toast } from '@havefolio/ui/components/sonner';
import { PhotoDescriptionDialog } from './photo-description-dialog';
import { itemDetailHref } from './navigation-context';
import { PhotoUploadPanel } from './photo-upload-panel';
import {
  deletePhoto,
  describePhoto,
  fetchPhotos,
  PhotoRequestError,
  photoAlt,
  photoName,
  photoSource,
  reorderPhotos,
} from './photos-client';

const limit = itemPhotoLimits.maxPhotosPerItem;
const tileSizes = '(min-width: 1024px) 14rem, (min-width: 640px) 30vw, 45vw';
const coverSizes = '(min-width: 640px) 20rem, 90vw';
const message = (error: unknown): string =>
  error instanceof PhotoRequestError ? error.message : 'Something went wrong. Try again.';

function focusFirst(ids: string[]): boolean {
  for (const id of ids) {
    const target = document.getElementById(id);
    if (target && !(target as HTMLButtonElement).disabled) {
      target.focus();
      return true;
    }
  }
  return false;
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

type Dialogs =
  | { kind: 'describe'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'replace'; id: string }
  | undefined;

export function PhotoGallery({
  itemId,
  fromStore = false,
  returnTo,
}: {
  itemId: string;
  /** Opened from My Store: the back link returns there instead of the item page. */
  fromStore?: boolean;
  /** The item page's My Store context, re-validated and carried back to the item page. */
  returnTo?: string | undefined;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ItemPhotoSnapshot | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [optimistic, setOptimistic] = useState<string[] | undefined>();
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [alert, setAlert] = useState<string | undefined>();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [dialog, setDialog] = useState<Dialogs>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const autoRetried = useRef(new Set<string>());
  const pendingFocus = useRef<string[] | undefined>(undefined);
  // Dialogs restore focus asynchronously after closing, so their target is applied on close.
  const dialogFocus = useRef<string[] | undefined>(undefined);

  const load = useCallback(async (): Promise<ItemPhotoSnapshot | undefined> => {
    try {
      const next = await fetchPhotos(itemId);
      setSnapshot(next);
      setLoadError(undefined);
      return next;
    } catch (error) {
      setLoadError(message(error));
      return undefined;
    }
  }, [itemId]);

  useEffect(() => {
    // Initial load; refreshes also follow reconnection and returning to a hidden tab.
    let active = true;
    fetchPhotos(itemId)
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        setLoadError(undefined);
      })
      .catch((error: unknown) => active && setLoadError(message(error)));
    const reload = (): void => void load();
    const visible = (): void => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.removeEventListener('online', reload);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [itemId, load]);

  useLayoutEffect(() => {
    if (pendingFocus.current && focusFirst(pendingFocus.current)) pendingFocus.current = undefined;
  });
  const restoreDialogFocus = (event: Event): void => {
    const keys = dialogFocus.current;
    if (!keys) return;
    event.preventDefault();
    dialogFocus.current = undefined;
    focusFirst(keys);
  };

  const byId = new Map(snapshot?.photos.map((p) => [p.id, p]));
  const photos = optimistic
    ? optimistic.map((id) => byId.get(id)).filter((p): p is ItemPhoto => Boolean(p))
    : (snapshot?.photos ?? []);
  const cover = photos[0];
  const locked = pending || !online || !snapshot;
  const focusLater = (...keys: string[]): void => {
    pendingFocus.current = keys;
  };
  const announce = (text: string): void => {
    setAlert(undefined);
    // Clear first so repeating the same sentence is announced again.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(text), 50);
  };
  const nameOf = (photo: ItemPhoto, list = photos): string =>
    photoName(
      photo,
      list.findIndex((p) => p.id === photo.id),
    );

  /** Optimistic, revision-protected ordering. Any rejection restores the server order. */
  async function commitOrder(
    next: string[],
    success: (fresh: ItemPhotoSnapshot) => string,
  ): Promise<void> {
    if (!snapshot) return;
    setPending(true);
    setOptimistic(next);
    try {
      const fresh = await reorderPhotos(itemId, snapshot.revision, next);
      setSnapshot(fresh);
      setOptimistic(undefined);
      announce(success(fresh));
    } catch (error) {
      setOptimistic(undefined);
      if (error instanceof PhotoRequestError && error.conflict) {
        await load();
        setAlert(
          'Photos changed elsewhere, so this change was not saved. The latest order is shown — try again.',
        );
      } else setAlert(`${message(error)} The previous order has been restored.`);
    } finally {
      setPending(false);
    }
  }

  function move(photo: ItemPhoto, delta: -1 | 1): void {
    const ids = photos.map((p) => p.id);
    const from = ids.indexOf(photo.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    const name = nameOf(photo);
    focusLater(
      `photo-${delta < 0 ? 'earlier' : 'later'}-${photo.id}`,
      `photo-${delta < 0 ? 'later' : 'earlier'}-${photo.id}`,
    );
    void commitOrder(
      ids,
      (fresh) =>
        `${name} moved to position ${to + 1} of ${fresh.photos.length}.${to === 0 ? ' It is now the cover.' : ''}`,
    );
  }

  function makeCover(photo: ItemPhoto): void {
    const name = nameOf(photo);
    focusLater(`photo-menu-${photo.id}`);
    void commitOrder(
      [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)],
      () => `${name} is now the cover.`,
    );
  }

  async function saveDescription(
    photo: ItemPhoto,
    altText: string | null,
    decorative: boolean,
  ): Promise<string | undefined> {
    if (!snapshot) return 'Photos are still loading.';
    try {
      const fresh = await describePhoto(itemId, photo.id, {
        revision: snapshot.revision,
        altText,
        decorative,
      });
      setSnapshot(fresh);
      setDialog(undefined);
      const text = decorative
        ? 'Photo marked as decorative.'
        : altText
          ? 'Description saved.'
          : 'Description cleared.';
      announce(text);
      toast.success(text);
      return undefined;
    } catch (error) {
      if (error instanceof PhotoRequestError && error.conflict) {
        await load();
        return 'Photos changed elsewhere. Check the latest version and save again.';
      }
      return message(error);
    }
  }

  async function confirmDelete(photo: ItemPhoto): Promise<void> {
    if (!snapshot || pending) return;
    const index = photos.findIndex((p) => p.id === photo.id);
    const wasCover = index === 0;
    setPending(true);
    setDeleteError(undefined);
    const after = (fresh: ItemPhotoSnapshot, text: string): void => {
      setSnapshot(fresh);
      const next = fresh.photos[Math.min(index, fresh.photos.length - 1)];
      dialogFocus.current = [...(next ? [`photo-menu-${next.id}`] : []), 'add-photos-heading'];
      setDialog(undefined);
      const coverText = !wasCover
        ? ''
        : fresh.photos[0]
          ? ` ${photoName(fresh.photos[0], 0)} is now the cover.`
          : ' The item has no cover photo now.';
      announce(`${text}${coverText}`);
      toast.success(text);
    };
    try {
      after(await deletePhoto(itemId, photo.id, snapshot.revision), 'Photo deleted.');
    } catch (error) {
      const fresh = await fetchPhotos(itemId).catch(() => undefined);
      if (fresh && !fresh.photos.some((p) => p.id === photo.id))
        // The photo is hidden; reconciliation finishes private storage cleanup on its own.
        after(fresh, 'Photo removed. Private storage cleanup will finish automatically.');
      else if (error instanceof PhotoRequestError && error.conflict && fresh) {
        setSnapshot(fresh);
        setDeleteError('Photos changed elsewhere. Review the latest version, then delete again.');
      } else setDeleteError(`${message(error)} The photo is still in your gallery.`);
    } finally {
      setPending(false);
    }
  }

  /**
   * Replacement upload is already confirmed ready; then take the original's position, copy its
   * description and only then delete the original. Every intermediate state is a valid gallery.
   */
  async function completeReplace(original: ItemPhoto, replacement: ItemPhoto): Promise<void> {
    setPending(true);
    try {
      let fresh = await fetchPhotos(itemId);
      const ids = fresh.photos.map((p) => p.id).filter((id) => id !== replacement.id);
      const at = ids.indexOf(original.id);
      if (at >= 0) {
        ids.splice(at, 0, replacement.id);
        fresh = await reorderPhotos(itemId, fresh.revision, ids);
        if (original.altText || original.decorative)
          fresh = await describePhoto(itemId, replacement.id, {
            revision: fresh.revision,
            altText: original.altText,
            decorative: original.decorative,
          }).catch(() => fresh);
        fresh = await deletePhoto(itemId, original.id, fresh.revision);
      }
      setSnapshot(fresh);
      setDialog(undefined);
      dialogFocus.current = [`photo-menu-${replacement.id}`];
      const text =
        at >= 0
          ? `Photo ${at + 1} replaced.`
          : 'The original was already removed elsewhere, so the new photo was added instead.';
      announce(text);
      toast.success(text);
    } catch (error) {
      await load();
      setDialog(undefined);
      setAlert(
        `The replacement was saved, but the original could not be removed (${message(error)}). Both photos are shown — delete the one you no longer need.`,
      );
    } finally {
      setPending(false);
    }
  }

  function imageFailed(photo: ItemPhoto): void {
    // One automatic recovery: revalidate access (session, deletion) and request fresh bytes.
    if (autoRetried.current.has(photo.id)) return;
    autoRetried.current.add(photo.id);
    void load().then((fresh) => {
      if (fresh?.photos.some((p) => p.id === photo.id)) retryImage(photo);
    });
  }
  function retryImage(photo: ItemPhoto): void {
    setAttempts((current) => ({ ...current, [photo.id]: (current[photo.id] ?? 0) + 1 }));
  }

  // Dialogs open from a menu item that unmounts, so focus returns to the photo's menu trigger.
  const openDialog = (kind: 'describe' | 'delete' | 'replace', photo: ItemPhoto): void => {
    dialogFocus.current = [`photo-menu-${photo.id}`];
    if (kind === 'delete') setDeleteError(undefined);
    setDialog({ kind, id: photo.id });
  };
  const active = dialog ? byId.get(dialog.id) : undefined;
  const activeIndex = active ? photos.findIndex((p) => p.id === active.id) : -1;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Item photos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Private to you. The first photo is the cover shown on My Store and the item page.
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-11 self-start">
          {fromStore ? (
            <Link href="/store">Back to My Store</Link>
          ) : (
            <Link href={itemDetailHref(itemId, returnTo)}>Back to item</Link>
          )}
        </Button>
      </header>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {!online ? (
        <div className="flex items-center gap-3 rounded-lg border p-3 text-sm" role="status">
          <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
          You are offline. Photos cannot be changed until you reconnect.
        </div>
      ) : null}
      {alert ? (
        <div role="alert" className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <p className="flex-1">{alert}</p>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Dismiss message"
            onClick={() => setAlert(undefined)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {!snapshot && loadError ? (
        <Card role="alert">
          <CardContent className="space-y-3">
            <p>Photos could not load. {loadError}</p>
            <Button className="min-h-11" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!snapshot && !loadError ? (
        <div aria-busy="true" aria-label="Loading photos" className="space-y-6">
          <Skeleton className="aspect-[4/3] w-full max-w-80 motion-reduce:animate-none" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="aspect-square motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <section aria-labelledby="cover-heading">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>
                  <h2 id="cover-heading">Cover</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-center">
                <ItemCover
                  className="rounded-lg"
                  fit="contain"
                  loading="eager"
                  cover={
                    cover
                      ? photoSource(itemId, cover, photoAlt(cover, 0, photos.length), coverSizes, {
                          attempt: attempts[cover.id] ?? 0,
                          large: true,
                        })
                      : null
                  }
                  onRetry={() => cover && retryImage(cover)}
                />
                <p className="text-sm text-muted-foreground">
                  {cover
                    ? `${photoName(cover, 0)} is the cover. Choose “Set as cover” on another photo, or move it first, to change it.`
                    : 'No cover yet. Your first uploaded photo becomes the cover automatically.'}
                </p>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="gallery-heading" className="space-y-3">
            <h2 id="gallery-heading" className="text-lg font-semibold">
              Photos{' '}
              <span className="text-muted-foreground">
                ({photos.length} of {limit})
              </span>
            </h2>
            {photos.length === 0 ? (
              <Card className="border-dashed py-0">
                <Empty className="min-h-56">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ImagePlusIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No photos yet</EmptyTitle>
                    <EmptyDescription>
                      Add up to {limit} private photos below. Take one with your camera or choose
                      from your gallery.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </Card>
            ) : (
              <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((photo, index) => {
                  const name = `photo ${index + 1}`;
                  const isCover = index === 0;
                  return (
                    <li key={photo.id}>
                      <Card className="gap-0 overflow-hidden py-0">
                        <div className="relative aspect-square">
                          <PrivatePhoto
                            {...photoSource(
                              itemId,
                              photo,
                              photoAlt(photo, index, photos.length),
                              tileSizes,
                              {
                                attempt: attempts[photo.id] ?? 0,
                              },
                            )}
                            loading={index < 2 ? 'eager' : 'lazy'}
                            failedLabel={`Photo ${index + 1} could not load.`}
                            onFailure={() => imageFailed(photo)}
                            onRetry={() => retryImage(photo)}
                          />
                          {isCover ? (
                            <Badge className="absolute top-2 left-2">
                              <StarIcon aria-hidden="true" />
                              Cover
                            </Badge>
                          ) : null}
                        </div>
                        <div className="space-y-2 p-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              Photo {index + 1}
                              {isCover ? <span className="sr-only"> (cover)</span> : null}
                            </p>
                            <p className="line-clamp-2 text-xs break-words text-muted-foreground">
                              {photo.decorative
                                ? 'Decorative — skipped by screen readers'
                                : (photo.altText ?? 'No description yet')}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              id={`photo-earlier-${photo.id}`}
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`Move ${name} earlier`}
                              disabled={locked || index === 0}
                              onClick={() => move(photo, -1)}
                            >
                              <ArrowLeftIcon aria-hidden="true" />
                            </Button>
                            <Button
                              id={`photo-later-${photo.id}`}
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`Move ${name} later`}
                              disabled={locked || index === photos.length - 1}
                              onClick={() => move(photo, 1)}
                            >
                              <ArrowRightIcon aria-hidden="true" />
                            </Button>
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  id={`photo-menu-${photo.id}`}
                                  variant="outline"
                                  size="icon"
                                  className="size-11"
                                  aria-label={`More actions for ${name}`}
                                  disabled={!snapshot}
                                >
                                  <MoreHorizontalIcon aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  className="min-h-11"
                                  disabled={locked || isCover}
                                  onSelect={() => makeCover(photo)}
                                >
                                  <StarIcon aria-hidden="true" />
                                  {isCover ? 'Current cover' : 'Set as cover'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="min-h-11"
                                  disabled={locked}
                                  onSelect={() => openDialog('describe', photo)}
                                >
                                  Edit description
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="min-h-11"
                                  disabled={locked}
                                  onSelect={() => openDialog('replace', photo)}
                                >
                                  Replace photo
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="min-h-11"
                                  variant="destructive"
                                  disabled={locked}
                                  onSelect={() => openDialog('delete', photo)}
                                >
                                  Delete photo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section aria-labelledby="add-photos-heading">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id="add-photos-heading" tabIndex={-1}>
                    Add photos
                  </h2>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  JPEG, PNG or WebP, up to 10 MiB each. HEIC/HEIF is not supported.{' '}
                  {photos.length >= limit
                    ? `This item has the maximum of ${limit} photos.`
                    : `${limit - photos.length} of ${limit} slots free.`}
                </p>
              </CardHeader>
              <CardContent>
                <PhotoUploadPanel
                  itemId={itemId}
                  remaining={limit - photos.length}
                  disabled={!online || pending}
                  onSaved={async () => {
                    await load();
                  }}
                />
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}

      <PhotoDescriptionDialog
        onCloseAutoFocus={restoreDialogFocus}
        open={dialog?.kind === 'describe' && Boolean(active)}
        photo={dialog?.kind === 'describe' ? active : undefined}
        position={activeIndex + 1}
        onOpenChange={(open) => !open && setDialog(undefined)}
        onSave={(altText, decorative) =>
          active ? saveDescription(active, altText, decorative) : Promise.resolve(undefined)
        }
      />

      <AlertDialog
        open={dialog?.kind === 'delete' && Boolean(active)}
        onOpenChange={(open) => !open && !pending && setDialog(undefined)}
      >
        <AlertDialogContent
          // The trigger may be gone after deletion; focus moves to the nearest photo instead.
          onCloseAutoFocus={restoreDialogFocus}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete photo {activeIndex + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the photo from Havefolio.
              {activeIndex === 0
                ? photos.length > 1
                  ? ' It is the cover, so the next photo will become the cover.'
                  : ' It is the cover and the only photo, so the item will have no cover.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              Keep photo
            </AlertDialogCancel>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={pending || !online}
              onClick={() => active && void confirmDelete(active)}
            >
              {pending ? 'Deleting…' : 'Delete photo'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dialog?.kind === 'replace' && Boolean(active)}
        onOpenChange={(open) => !open && !pending && setDialog(undefined)}
      >
        <DialogContent
          className="max-h-[90svh] overflow-y-auto"
          onCloseAutoFocus={restoreDialogFocus}
        >
          <DialogHeader>
            <DialogTitle>Replace photo {activeIndex + 1}</DialogTitle>
            <DialogDescription>
              The new photo is uploaded and confirmed first. It then takes this photo’s place
              {activeIndex === 0 ? ' as the cover' : ''} and keeps its description, and only then is
              the original deleted. If anything fails, the original stays.
            </DialogDescription>
          </DialogHeader>
          {active && photos.length >= limit ? (
            <p role="alert" className="text-sm">
              Replacing needs one free photo slot so the original stays safe until the new photo is
              saved. This item has {limit} photos — delete one first.
            </p>
          ) : active ? (
            <PhotoUploadPanel
              itemId={itemId}
              idPrefix="replacement"
              multiple={false}
              remaining={1}
              disabled={!online}
              uploadLabel="Upload replacement"
              onSaved={(replacement) => completeReplace(active, replacement)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
