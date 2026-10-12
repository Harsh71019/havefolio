'use client';
import { useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type {
  CorrectRefundRequest,
  DatePrecision,
  ItemRefund,
  ItemRefundsSnapshot,
  PurchaseDate,
  RecordRefundRequest,
} from '@havefolio/contracts';
import {
  approximateDate,
  formatApproximateDate,
  isFinancialDomainError,
  parseCalendarDay,
  toDateComponents,
} from '@havefolio/domain';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Textarea } from '@havefolio/ui/components/textarea';
import type { Loadable } from './item-attachments';
import { formatMoney, monthOptions, type Shown } from './item-detail-presentation';
import { ItemRequestError } from './items-client';
import { amountEntryToMinor, minorToAmountEntry } from './money-entry';

const asItemError = (error: unknown): ItemRequestError =>
  error instanceof ItemRequestError
    ? error
    : new ItemRequestError(500, 'Something went wrong. Try again.');

/**
 * The three amounts kept distinct: what was paid (unchanged history), what came back, and the
 * difference. None of them is a current, resale or savings value.
 */
export function refundSummary(snapshot: ItemRefundsSnapshot): {
  purchase: Shown;
  refunded: Shown;
  net: Shown;
} {
  const { totals, acquisitionType } = snapshot;
  const giftWithoutAmount = acquisitionType === 'gift' && totals.amountPaidMinor === null;
  return {
    purchase:
      totals.amountPaidMinor === null
        ? giftWithoutAmount
          ? { value: 'Gift — nothing paid recorded', muted: true }
          : { value: 'Not recorded', muted: true }
        : {
            value: formatMoney(totals.amountPaidMinor, totals.currency),
            note: 'As recorded at purchase. Refunds never change it.',
          },
    refunded: {
      value: formatMoney(totals.refundedMinor, totals.currency),
      ...(snapshot.refunds.length ? {} : { muted: true, note: 'No refunds recorded.' }),
    },
    net:
      totals.netMinor === null
        ? {
            value: 'Not available',
            muted: true,
            note: giftWithoutAmount
              ? 'Nothing paid is recorded, so this gift adds nothing to spending.'
              : 'Needs the amount you paid.',
          }
        : {
            value: formatMoney(totals.netMinor, totals.currency),
            note: 'Amount paid minus refunds received. Not a current or resale value.',
          },
  };
}

/** Why a refund cannot be recorded right now, or undefined when it can. */
function refundBlocked(snapshot: ItemRefundsSnapshot): string | undefined {
  const { totals, acquisitionType } = snapshot;
  if (totals.amountPaidMinor === null)
    return acquisitionType === 'gift'
      ? 'No amount paid is recorded for this gift, so there is nothing to refund.'
      : 'Add the amount you paid (Purchase › Edit) to record a refund.';
  if (totals.netMinor === '0')
    return totals.amountPaidMinor === '0'
      ? 'Recorded as nothing paid, so there is nothing to refund.'
      : 'The full amount paid has been refunded.';
  return undefined;
}

export function refundDateText(date: PurchaseDate): string {
  try {
    return formatApproximateDate(date, { unknown: 'Date not recorded' });
  } catch {
    return 'Date not recorded';
  }
}

type Draft = {
  amount: string;
  precision: DatePrecision;
  exactDate: string;
  month: string;
  year: string;
  note: string;
};
const pad = (n: number, width: number): string => String(n).padStart(width, '0');
function draftFrom(refund: ItemRefund | undefined, currency: string): Draft {
  const d = refund?.refundDate ?? { precision: 'unknown' as const };
  return {
    amount: refund ? minorToAmountEntry(refund.amountMinor, currency) : '',
    precision: d.precision,
    exactDate:
      d.precision === 'exact' && d.year && d.month && d.day
        ? `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`
        : '',
    month: d.month ? String(d.month) : '',
    year: d.year ? String(d.year) : '',
    note: refund?.note ?? '',
  };
}

/** Validated request fields, or per-field errors. Nothing is guessed or rounded. */
function readDraft(
  draft: Draft,
  currency: string,
): { errors: Record<string, string>; amountMinor?: string; refundDate?: PurchaseDate } {
  const errors: Record<string, string> = {};
  let amountMinor: string | undefined;
  if (!draft.amount.trim()) errors.amount = 'Enter the amount refunded to you.';
  else
    try {
      amountMinor = amountEntryToMinor(draft.amount, currency);
      if (amountMinor === '0') errors.amount = 'Enter an amount greater than zero.';
    } catch (error) {
      errors.amount = error instanceof Error ? error.message : 'Enter a valid amount.';
    }
  let refundDate: PurchaseDate | undefined;
  try {
    if (draft.precision === 'exact') {
      if (!draft.exactDate)
        errors.exactDate = 'Enter the full date, or choose a less precise option.';
      else refundDate = toDateComponents(parseCalendarDay(draft.exactDate));
    } else if (draft.precision === 'month') {
      if (!draft.month) errors.month = 'Choose the month.';
      if (!/^\d{4}$/.test(draft.year)) errors.year = 'Enter a four-digit year.';
      if (!errors.month && !errors.year)
        refundDate = toDateComponents(
          approximateDate({
            precision: 'month',
            year: Number(draft.year),
            month: Number(draft.month),
          }),
        );
    } else if (draft.precision === 'year') {
      if (!/^\d{4}$/.test(draft.year)) errors.year = 'Enter a four-digit year.';
      else
        refundDate = toDateComponents(
          approximateDate({ precision: 'year', year: Number(draft.year) }),
        );
    } else refundDate = { precision: 'unknown' };
  } catch (error) {
    if (!isFinancialDomainError(error)) throw error;
    errors[draft.precision === 'exact' ? 'exactDate' : 'year'] =
      'That date doesn’t exist. Check the day, month and year.';
  }
  if (draft.note.trim().length > 1000) errors.note = 'Use 1,000 characters or fewer.';
  return { errors, ...(amountMinor ? { amountMinor } : {}), ...(refundDate ? { refundDate } : {}) };
}

export function ItemRefunds({
  state,
  online,
  onRetry,
  onRecord,
  onCorrect,
  onDelete,
}: {
  state: Loadable<ItemRefundsSnapshot>;
  online: boolean;
  onRetry: () => void;
  onRecord: (input: RecordRefundRequest) => Promise<void>;
  onCorrect: (refundId: string, input: CorrectRefundRequest) => Promise<void>;
  onDelete: (refundId: string, revision: number) => Promise<void>;
}): ReactElement {
  const [editing, setEditing] = useState<{ refund?: ItemRefund } | undefined>();
  const [removing, setRemoving] = useState<ItemRefund | undefined>();
  const [removeError, setRemoveError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const body = ((): ReactElement => {
    if (state.kind === 'loading')
      return (
        <div aria-hidden="true" className="space-y-2">
          <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="h-5 w-1/2 motion-reduce:animate-none" />
        </div>
      );
    if (state.kind === 'failed')
      return (
        <div role="alert" className="space-y-2">
          <p className="text-muted-foreground">Refunds could not load. {state.message}</p>
          <Button variant="outline" className="min-h-11" onClick={onRetry}>
            Try again
          </Button>
        </div>
      );
    const snapshot = state.value;
    const summary = refundSummary(snapshot);
    const blocked = refundBlocked(snapshot);
    return (
      <div className="space-y-4">
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          {(
            [
              ['Purchase amount', summary.purchase],
              ['Refunded to you', summary.refunded],
              ['Net recorded spend', summary.net],
            ] as const
          ).map(([label, shown]) => (
            <div key={label} className="contents">
              <dt className="text-sm text-muted-foreground sm:text-base">{label}</dt>
              <dd className="-mt-2 min-w-0 break-words sm:mt-0">
                <span className={shown.muted ? 'text-muted-foreground' : undefined}>
                  {shown.value}
                </span>
                {shown.note ? (
                  <span className="block text-sm text-muted-foreground">{shown.note}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {snapshot.ownershipStatus === 'returned' && !snapshot.refunds.length && !blocked ? (
          <p className="text-sm text-muted-foreground">
            Marked as returned. No refund is recorded yet — add one when it arrives.
          </p>
        ) : null}
        {snapshot.refunds.length ? (
          <ul aria-label="Recorded refunds" className="divide-y rounded-lg border">
            {snapshot.refunds.map((refund) => {
              const amount = formatMoney(refund.amountMinor, refund.currency);
              const when = refundDateText(refund.refundDate);
              return (
                <li key={refund.id} className="flex flex-wrap items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{amount}</p>
                    <p className="text-sm text-muted-foreground">{when}</p>
                    {refund.note ? (
                      <p className="mt-1 text-sm break-words whitespace-pre-line">{refund.note}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      disabled={!online}
                      aria-label={`Correct refund of ${amount}, ${when}`}
                      onClick={(e) => {
                        returnFocus.current = e.currentTarget;
                        setEditing({ refund });
                      }}
                    >
                      <PencilIcon aria-hidden="true" />
                      Correct
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      disabled={!online}
                      aria-label={`Delete refund of ${amount}, ${when}`}
                      onClick={(e) => {
                        returnFocus.current = e.currentTarget;
                        setRemoveError(undefined);
                        setRemoving(refund);
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        {blocked ? (
          <p className="text-sm text-muted-foreground">{blocked}</p>
        ) : (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={!online}
            onClick={(e) => {
              returnFocus.current = e.currentTarget;
              setEditing({});
            }}
          >
            <PlusIcon aria-hidden="true" />
            Record a refund
          </Button>
        )}
      </div>
    );
  })();

  const snapshot = state.kind === 'ready' ? state.value : undefined;
  const restoreFocus = (): void => {
    window.setTimeout(
      () => (returnFocus.current ?? document.getElementById('refunds-heading'))?.focus(),
      0,
    );
  };

  return (
    <section aria-labelledby="refunds-heading">
      <div className="mb-1">
        <h2 id="refunds-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
          Returns and refunds
        </h2>
        <p className="text-sm text-muted-foreground">
          Refunds are recorded separately from what you paid. Marking an item returned doesn’t
          record a refund, and recording a refund doesn’t change ownership.
        </p>
      </div>
      <div className="mt-3">{body}</div>

      {snapshot && editing ? (
        <RefundDialog
          key={editing.refund?.id ?? 'new'}
          refund={editing.refund}
          snapshot={snapshot}
          online={online}
          onClose={() => {
            setEditing(undefined);
            restoreFocus();
          }}
          onSubmit={async (fields) => {
            if (editing.refund)
              await onCorrect(editing.refund.id, { ...fields, revision: snapshot.revision });
            else
              await onRecord({
                amountMinor: fields.amountMinor!,
                currency: snapshot.totals.currency,
                refundDate: fields.refundDate,
                note: fields.note,
                revision: snapshot.revision,
              });
            setEditing(undefined);
            restoreFocus();
          }}
        />
      ) : null}

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (busy || open) return;
          setRemoving(undefined);
          restoreFocus();
        }}
      >
        <AlertDialogContent className="motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this refund record?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && snapshot
                ? `The ${formatMoney(removing.amountMinor, removing.currency)} refund and its note will be removed, and net recorded spend recalculated. The purchase amount stays as recorded, and the item’s history keeps an entry that a refund was deleted.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>The refund was kept</AlertTitle>
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setRemoving(undefined);
                restoreFocus();
              }}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={busy || !online}
              onClick={() => {
                if (!removing || !snapshot) return;
                setBusy(true);
                setRemoveError(undefined);
                onDelete(removing.id, snapshot.revision)
                  .then(() => {
                    setRemoving(undefined);
                    returnFocus.current = null;
                    restoreFocus();
                  })
                  .catch((error: unknown) => setRemoveError(asItemError(error).message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Deleting…' : 'Delete refund'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function RefundDialog({
  refund,
  snapshot,
  online,
  onClose,
  onSubmit,
}: {
  refund: ItemRefund | undefined;
  snapshot: ItemRefundsSnapshot;
  online: boolean;
  onClose: () => void;
  onSubmit: (fields: {
    amountMinor?: string;
    refundDate?: PurchaseDate;
    note?: string | null;
  }) => Promise<void>;
}): ReactElement {
  const id = useId();
  const currency = snapshot.totals.currency;
  const [draft, setDraftState] = useState<Draft>(() => draftFrom(refund, currency));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const setDraft = (patch: Partial<Draft>): void => {
    setDraftState((d) => ({ ...d, ...patch }));
    setErrors((current) => {
      const copy = { ...current };
      for (const key of Object.keys(patch)) delete copy[key];
      return copy;
    });
  };
  const fieldProps = (key: string, hint?: boolean): Record<string, unknown> => ({
    id: `${id}-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby':
      [errors[key] ? `${id}-${key}-error` : '', hint ? `${id}-${key}-hint` : '']
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const fieldError = (key: string): ReactElement | null =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  const remaining =
    snapshot.totals.netMinor === null
      ? undefined
      : formatMoney(
          refund
            ? (BigInt(snapshot.totals.netMinor) + BigInt(refund.amountMinor)).toString()
            : snapshot.totals.netMinor,
          currency,
        );

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const read = readDraft(draft, currency);
    setErrors(read.errors);
    setFailure(undefined);
    if (Object.keys(read.errors).length) {
      window.setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    const note = draft.note.trim() || null;
    // Both are present whenever there are no field errors.
    const amountMinor = read.amountMinor!;
    const refundDate = read.refundDate!;
    const fields = refund
      ? {
          ...(amountMinor !== refund.amountMinor ? { amountMinor } : {}),
          ...(JSON.stringify(refundDate) !==
          JSON.stringify(toDateComponents(approximateDate(refund.refundDate)))
            ? { refundDate }
            : {}),
          ...(note !== refund.note ? { note } : {}),
        }
      : { amountMinor, refundDate, note };
    if (!Object.keys(fields).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSubmit(fields);
    } catch (error) {
      const failed = asItemError(error);
      setFailure(
        failed.stale
          ? 'This item changed since you opened it. The latest refunds are now shown; check them and save again.'
          : `${failed.message} Your entry is still here.`,
      );
      window.setTimeout(() => summaryRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  const errorList = Object.values(errors);
  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <DialogContent className="max-h-[92svh] overflow-y-auto motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
        <form noValidate onSubmit={(e) => void submit(e)} className="grid min-w-0 gap-4">
          <DialogHeader>
            <DialogTitle>{refund ? 'Correct refund' : 'Record a refund'}</DialogTitle>
            <DialogDescription>
              Record money you actually received back. The purchase amount stays as recorded.
            </DialogDescription>
          </DialogHeader>
          <div ref={summaryRef} tabIndex={-1} className="outline-none">
            {failure || errorList.length ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{failure ? 'Not saved' : 'Check these details'}</AlertTitle>
                <AlertDescription>
                  {failure ?? (
                    <ul className="list-disc pl-5">
                      {errorList.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-amount`}>Amount refunded ({currency})</Label>
            <Input
              {...fieldProps('amount', true)}
              className="min-h-11 text-base md:text-sm"
              inputMode="decimal"
              autoComplete="off"
              value={draft.amount}
              onChange={(e) => setDraft({ amount: e.target.value })}
            />
            <p id={`${id}-amount-hint`} className="text-sm text-muted-foreground">
              In {currency}, the purchase currency.
              {remaining ? ` Up to ${remaining} can be recorded.` : ''}
            </p>
            {fieldError('amount')}
          </div>

          <fieldset className="grid min-w-0 gap-3">
            <legend className="mb-2 text-sm font-medium">When you received it</legend>
            <RadioGroup
              value={draft.precision}
              onValueChange={(value) => setDraft({ precision: value as DatePrecision })}
              className="grid gap-1 sm:grid-cols-2"
              aria-label="How precisely do you know the refund date?"
            >
              {(
                [
                  ['exact', 'Exact date'],
                  ['month', 'Month and year'],
                  ['year', 'Year only'],
                  ['unknown', 'Not recorded'],
                ] as const
              ).map(([value, label]) => (
                <Label
                  key={value}
                  htmlFor={`${id}-precision-${value}`}
                  className="flex min-h-11 items-center gap-3 font-normal"
                >
                  <RadioGroupItem id={`${id}-precision-${value}`} value={value} />
                  {label}
                </Label>
              ))}
            </RadioGroup>
            {draft.precision === 'exact' ? (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-exactDate`}>Date</Label>
                <Input
                  {...fieldProps('exactDate')}
                  type="date"
                  className="min-h-11 text-base md:text-sm"
                  value={draft.exactDate}
                  onChange={(e) => setDraft({ exactDate: e.target.value })}
                />
                {fieldError('exactDate')}
              </div>
            ) : null}
            {draft.precision === 'month' || draft.precision === 'year' ? (
              <div className="grid grid-cols-2 gap-3">
                {draft.precision === 'month' ? (
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${id}-month`}>Month</Label>
                    <Select
                      value={draft.month}
                      onValueChange={(value) => setDraft({ month: value })}
                    >
                      <SelectTrigger {...fieldProps('month')} className="min-h-11 w-full">
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {monthOptions.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldError('month')}
                  </div>
                ) : null}
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-year`}>Year</Label>
                  <Input
                    {...fieldProps('year')}
                    className="min-h-11 text-base md:text-sm"
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                    value={draft.year}
                    onChange={(e) => setDraft({ year: e.target.value.trim() })}
                  />
                  {fieldError('year')}
                </div>
              </div>
            ) : null}
            {draft.precision === 'unknown' ? (
              <p className="text-sm text-muted-foreground">
                The date stays unknown — no date is filled in for you.
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <Textarea
              {...fieldProps('note', true)}
              className="min-h-20 text-base md:text-sm"
              maxLength={1000}
              value={draft.note}
              onChange={(e) => setDraft({ note: e.target.value })}
            />
            <p id={`${id}-note-hint`} className="text-sm text-muted-foreground">
              Private to you, for example “Partial refund for a missing part”.
            </p>
            {fieldError('note')}
          </div>

          <DialogFooter>
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
              {busy ? 'Saving…' : refund ? 'Save correction' : 'Record refund'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
