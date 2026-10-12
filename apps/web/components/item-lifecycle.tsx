'use client';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ChevronDownIcon, HammerIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import type { ItemActionRequest, ItemResponse } from '@havefolio/contracts';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@havefolio/ui/components/alert-dialog';
import { Button } from '@havefolio/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@havefolio/ui/components/dropdown-menu';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Textarea } from '@havefolio/ui/components/textarea';
import { lifecycleChoices, type LifecycleChoice } from './item-detail-presentation';
import { ItemRequestError } from './items-client';

const asItemError = (error: unknown): ItemRequestError =>
  error instanceof ItemRequestError
    ? error
    : new ItemRequestError(500, 'Something went wrong. Try again.');

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * A compact set of actions valid for the current status: the two common ones directly, the
 * ownership changes behind one menu. Nothing is recorded until the owner confirms in a dialog.
 */
export function LifecycleActions({
  item,
  online,
  onRecord,
  onRecorded,
  onFailure,
}: {
  item: ItemResponse;
  online: boolean;
  onRecord: (input: ItemActionRequest) => Promise<ItemResponse>;
  onRecorded: (item: ItemResponse, message: string) => void;
  /** Stale or invalid transitions: the parent reloads the item so valid actions are shown. */
  onFailure: (error: ItemRequestError) => Promise<void>;
}): ReactElement {
  const [choice, setChoice] = useState<LifecycleChoice | undefined>();
  const choices = lifecycleChoices(item.ownershipStatus);
  const direct = choices.filter((c) => !c.confirm || item.ownershipStatus !== 'owned');
  const statusChanges = choices.filter((c) => c.confirm && item.ownershipStatus === 'owned');
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Where focus returns on close; menu items unmount, and a status change can remove a button.
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = (c: LifecycleChoice, from: HTMLElement | null): void => {
    returnFocus.current = from;
    setChoice(c);
  };
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Record what happened">
      {direct.map((c) => (
        <Button
          key={c.key}
          variant={c.key === 'used' ? 'default' : 'outline'}
          className="min-h-11"
          disabled={!online}
          onClick={(e) => open(c, e.currentTarget)}
        >
          {c.key === 'repaired' ? <HammerIcon aria-hidden="true" /> : null}
          {c.key === 'owned' ? <RotateCcwIcon aria-hidden="true" /> : null}
          {c.label}
        </Button>
      ))}
      {statusChanges.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={triggerRef} variant="outline" className="min-h-11" disabled={!online}>
              No longer have it
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>What happened to it?</DropdownMenuLabel>
            {statusChanges.map((c) => (
              <DropdownMenuItem
                key={c.key}
                className="min-h-11"
                onSelect={() => open(c, triggerRef.current)}
              >
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <LifecycleDialog
        key={choice?.key ?? 'closed'}
        item={item}
        choice={choice}
        online={online}
        onClose={() => setChoice(undefined)}
        returnFocus={returnFocus}
        onRecord={onRecord}
        onRecorded={(updated, message) => {
          setChoice(undefined);
          onRecorded(updated, message);
        }}
        onFailure={onFailure}
      />
    </div>
  );
}

function LifecycleDialog({
  item,
  choice,
  online,
  onClose,
  returnFocus,
  onRecord,
  onRecorded,
  onFailure,
}: {
  item: ItemResponse;
  choice: LifecycleChoice | undefined;
  online: boolean;
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  onRecord: (input: ItemActionRequest) => Promise<ItemResponse>;
  onRecorded: (item: ItemResponse, message: string) => void;
  onFailure: (error: ItemRequestError) => Promise<void>;
}): ReactElement {
  const id = useId();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const inFlight = useRef(false);

  async function confirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!choice || inFlight.current) return;
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today())) {
      setDateError('Choose a date that is not in the future, or leave it empty for today.');
      return;
    }
    setDateError(undefined);
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await onRecord({
        revision: item.revision,
        action: choice.action,
        ...(choice.ownershipStatus ? { ownershipStatus: choice.ownershipStatus } : {}),
        // Midday UTC keeps the chosen calendar day in every common time zone.
        ...(date ? { occurredAt: `${date}T12:00:00Z` } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onRecorded(
        updated,
        `${choice.title.replace(/^Record /, 'Recorded ').replace(/^Mark/, 'Marked')}.`,
      );
    } catch (caught) {
      const failed = asItemError(caught);
      if (failed.stale || failed.code === 'INVALID_ITEM_TRANSITION') {
        await onFailure(failed);
        setError(
          failed.stale
            ? 'This item changed since you opened it, so nothing was recorded. The latest details are now shown — check them and try again if it still applies.'
            : 'This no longer applies to the item’s current status, so nothing was recorded. The latest details are now shown.',
        );
      } else
        setError(
          failed.unauthenticated
            ? failed.message
            : `${failed.message} Nothing was recorded; your note is still here.`,
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={Boolean(choice)}
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
    >
      {choice ? (
        <AlertDialogContent
          className="max-h-[92svh] overflow-y-auto motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current;
            (target?.isConnected ? target : document.getElementById('item-heading'))?.focus();
          }}
        >
          <form noValidate onSubmit={(e) => void confirm(e)} className="grid min-w-0 gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>{choice.title}</AlertDialogTitle>
              <AlertDialogDescription>{choice.effect}</AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>Not recorded</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <fieldset disabled={busy} className="grid min-w-0 gap-4">
              <legend className="sr-only">Optional details</legend>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-date`}>When did this happen? (optional)</Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  max={today()}
                  className="min-h-11 text-base md:text-sm"
                  value={date}
                  aria-invalid={dateError ? true : undefined}
                  aria-describedby={dateError ? `${id}-date-error` : `${id}-date-hint`}
                  onChange={(e) => setDate(e.target.value)}
                />
                {dateError ? (
                  <p id={`${id}-date-error`} className="text-sm text-destructive" role="alert">
                    {dateError}
                  </p>
                ) : (
                  <p id={`${id}-date-hint`} className="text-sm text-muted-foreground">
                    Leave empty to use today.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-note`}>Note (optional, private)</Label>
                <Textarea
                  id={`${id}-note`}
                  maxLength={2000}
                  className="min-h-20 text-base md:text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </fieldset>
            <AlertDialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={busy || !online}>
                {busy ? 'Saving…' : choice.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}

export type DeleteOutcome = { kind: 'deleted' } | { kind: 'failed'; error: ItemRequestError };

/** Strong confirmation: the owner types the item name. Revision-guarded, single submission. */
export function DeleteItemSection({
  item,
  online,
  photoCount,
  documentCount,
  onDelete,
  onDeleted,
  onStale,
}: {
  item: ItemResponse;
  online: boolean;
  photoCount: number | undefined;
  documentCount: number | undefined;
  onDelete: (revision: number) => Promise<void>;
  onDeleted: () => void;
  onStale: () => Promise<void>;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; text: string } | undefined>();
  const inFlight = useRef(false);
  const deleted = useRef(false);
  const matches = typed.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase();
  const attachments = [
    photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'photos',
    documentCount
      ? `${documentCount} receipt or warranty document${documentCount === 1 ? '' : 's'}`
      : 'receipts and warranties',
  ];

  async function confirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!matches || inFlight.current || deleted.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(item.revision);
      // Navigation follows; the record is gone, so this dialog never submits again.
      deleted.current = true;
      onDeleted();
    } catch (caught) {
      const failed = asItemError(caught);
      if (failed.stale) {
        await onStale();
        setError({
          title: 'Not deleted — this item changed',
          text: 'It was updated since you opened it. Review the latest details on the page, then confirm again if you still want to delete it.',
        });
      } else if (
        failed.code === 'ITEM_MEDIA_PENDING' ||
        failed.code === 'MEDIA_STORAGE_UNAVAILABLE' ||
        failed.status === 503
      ) {
        await onStale();
        setError({
          title: 'Not fully deleted yet',
          text: 'Some attached files are still being processed or could not be removed right now, so the item record was kept. Files already removed stay removed. Try again in a few minutes.',
        });
      } else if (failed.status === 404) {
        onDeleted();
      } else {
        setError({ title: 'Not deleted', text: failed.message });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3 rounded-xl border p-4 sm:p-6">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Delete this item
      </h2>
      <p className="text-sm text-muted-foreground">
        Permanently removes the item, its history and all of its private photos, receipts and
        warranties from Havefolio. If you sold, donated or lost it, you can record that instead and
        keep its history.
      </p>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={!online}
        onClick={() => {
          setTyped('');
          setError(undefined);
          setOpen(true);
        }}
      >
        <Trash2Icon aria-hidden="true" />
        Delete item…
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => (!busy ? setOpen(next) : undefined)}>
        <AlertDialogContent className="max-h-[92svh] overflow-y-auto motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
          <form noValidate onSubmit={(e) => void confirm(e)} className="grid min-w-0 gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{item.name}” permanently?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>This cannot be undone. It removes:</p>
                  <ul className="list-disc space-y-1 pl-5 text-left">
                    <li>the item and every detail you recorded</li>
                    <li>its lifecycle history</li>
                    <li>its {attachments[0]}</li>
                    <li>its {attachments[1]}</li>
                    <li>any refunds you recorded for it</li>
                  </ul>
                  <p>Private files are removed from storage first; this can take a moment.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{error.title}</AlertTitle>
                <AlertDescription>{error.text}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor={`${id}-confirm`}>Type the item name to confirm</Label>
              <Input
                id={`${id}-confirm`}
                autoComplete="off"
                className="min-h-11 text-base md:text-sm"
                value={typed}
                disabled={busy}
                aria-describedby={`${id}-confirm-hint`}
                onChange={(e) => setTyped(e.target.value)}
              />
              <p id={`${id}-confirm-hint`} className="text-sm break-words text-muted-foreground">
                Type “{item.name}”.
              </p>
            </div>
            <AlertDialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Keep item
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="min-h-11"
                disabled={!matches || busy || !online}
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
