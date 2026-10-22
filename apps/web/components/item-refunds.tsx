'use client';

import { useRef, useState, type ReactElement } from 'react';
import dynamic from 'next/dynamic';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import type {
  CorrectRefundRequest,
  ItemRefund,
  ItemRefundsSnapshot,
  PurchaseDate,
  RecordRefundRequest,
} from '@havefolio/contracts';
import { formatApproximateDate } from '@havefolio/domain';
import { Button } from '@havefolio/ui/components/button';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import type { Loadable } from './item-attachments';
import { formatMoney, type Shown } from './item-detail-presentation';
import { ItemRequestError } from './items-client';

const preloadRefundDialogs = (): void => {
  void import('./item-refund-dialogs');
};

const RefundDialog = dynamic(
  () => import('./item-refund-dialogs').then((mod) => mod.RefundDialog),
  { ssr: false },
);

const DeleteRefundDialog = dynamic(
  () => import('./item-refund-dialogs').then((mod) => mod.DeleteRefundDialog),
  { ssr: false },
);

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
              <dd className="-mt-2 min-w-0 wrap-anywhere sm:mt-0">
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
                      <p className="mt-1 text-sm wrap-anywhere whitespace-pre-line">
                        {refund.note}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      disabled={!online}
                      aria-label={`Correct refund of ${amount}, ${when}`}
                      onPointerEnter={preloadRefundDialogs}
                      onFocus={preloadRefundDialogs}
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
                      onPointerEnter={preloadRefundDialogs}
                      onFocus={preloadRefundDialogs}
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
            onPointerEnter={preloadRefundDialogs}
            onFocus={preloadRefundDialogs}
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

      {snapshot && removing ? (
        <DeleteRefundDialog
          removing={removing}
          snapshot={snapshot}
          busy={busy}
          removeError={removeError}
          online={online}
          onClose={() => {
            if (busy) return;
            setRemoving(undefined);
            restoreFocus();
          }}
          onConfirm={() => {
            if (!removing || !snapshot) return;
            setBusy(true);
            setRemoveError(undefined);
            onDelete(removing.id, snapshot.revision)
              .then(() => {
                setRemoving(undefined);
                returnFocus.current = null;
                restoreFocus();
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof ItemRequestError
                    ? error.message
                    : 'Something went wrong. Try again.';
                setRemoveError(message);
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </section>
  );
}
