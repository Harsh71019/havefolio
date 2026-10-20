'use client';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import type {
  AllocationContribution,
  AllocationGoal,
  ConfirmDesireAllocationRequest,
  CorrectAllocationRequest,
  DesireAllocationState,
} from '@havefolio/contracts';
import {
  assertCurrency,
  estimatedGoalPercentage,
  formatMoney,
  parseDecimalAmount,
  parseMinorUnits,
  toDecimalString,
} from '@havefolio/domain';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { Label } from '@havefolio/ui/components/label';
import { Input } from '@havefolio/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@havefolio/ui/components/alert-dialog';
import {
  allocationGoals,
  allocationHistory,
  allocationState,
  confirmAllocation,
  correctAllocation,
} from './allocations-client';
import { DesireRequestError } from './desires-client';
import { randomId } from './random-id';
import { pageTitleClassName } from './page-heading';

const display = (minor: string, currency: string): string =>
  formatMoney({ minor: BigInt(minor), currency: assertCurrency(currency) });
const message = (e: unknown): string =>
  e instanceof DesireRequestError ? e.message : 'Could not load or save the allocation. Try again.';
type Pending =
  | { kind: 'allocate'; body: ConfirmDesireAllocationRequest }
  | { kind: 'correct'; goalId: string; body: CorrectAllocationRequest };
export function DesireAllocationFlow({ desireId }: { desireId: string }): ReactElement {
  const [state, setState] = useState<DesireAllocationState | null>(null);
  const [goals, setGoals] = useState<AllocationGoal[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dialog, setDialog] = useState<'allocate' | 'correction' | 'reversal' | null>(null);
  const [replacement, setReplacement] = useState('');
  const [history, setHistory] = useState<AllocationContribution[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const pending = useRef<Pending | null>(null);
  const sending = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const openDialog = (kind: 'allocate' | 'correction' | 'reversal'): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(kind);
  };
  const notice = useRef<HTMLParagraphElement>(null);
  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const [s, g] = await Promise.all([
        allocationState(desireId, signal),
        allocationGoals(undefined, signal),
      ]);
      if (signal?.aborted) return;
      setState(s);
      setGoals(g.items);
      setAfter(g.nextAfter);
      setSelected('');
    },
    [desireId],
  );
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([allocationState(desireId, c.signal), allocationGoals(undefined, c.signal)])
      .then(([s, g]) => {
        if (!c.signal.aborted) {
          setState(s);
          setGoals(g.items);
          setAfter(g.nextAfter);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [desireId]);
  useEffect(() => {
    if (error || success) notice.current?.focus();
  }, [error, success]);
  const chosen = goals.find((g) => g.id === selected);
  const linked = state?.allocation;
  const goal = linked?.goal;
  const leaf = linked?.currentContribution;
  const estimate =
    state?.estimatedNotSpentMinor != null && state.currency
      ? parseMinorUnits(state.estimatedNotSpentMinor, state.currency)
      : null;
  const percentage = chosen
    ? estimatedGoalPercentage(estimate, parseMinorUnits(chosen.targetMinor, chosen.currency))
    : null;
  const loadHistory = async (cursor?: number): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const page = await allocationHistory(desireId, cursor);
      setHistory((old) => (cursor ? [...old, ...page.items] : page.items));
      setBefore(page.nextBefore);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async (): Promise<void> => {
    if (sending.current || !state) return;
    setError('');
    setSuccess('');
    if (!pending.current) {
      if (dialog === 'allocate' && chosen && state.currentReviewEventId) {
        pending.current = {
          kind: 'allocate',
          body: {
            commandId: randomId(),
            reviewEventId: state.currentReviewEventId,
            goalId: chosen.id,
            goalRevision: chosen.revision,
            confirmed: true,
          },
        };
      } else if ((dialog === 'correction' || dialog === 'reversal') && goal && leaf) {
        try {
          const minor =
            dialog === 'reversal'
              ? '0'
              : parseDecimalAmount(replacement, goal.currency).minor.toString();
          if (dialog === 'correction' && minor === '0') {
            setError('Use Reverse allocation to record zero.');
            return;
          }
          pending.current = {
            kind: 'correct',
            goalId: goal.id,
            body: {
              commandId: randomId(),
              revision: goal.revision,
              kind: dialog,
              amountMinor: minor,
              currency: goal.currency,
              supersedesId: leaf.id,
            },
          };
        } catch {
          setError('Enter a positive amount in the goal currency.');
          return;
        }
      } else return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const command = pending.current;
      if (command.kind === 'allocate') setState(await confirmAllocation(desireId, command.body));
      else {
        await correctAllocation(command.goalId, command.body);
        setState(await allocationState(desireId));
      }
      pending.current = null;
      setUncertain(false);
      setDialog(null);
      setHistory([]);
      setBefore(null);
      setSuccess('Confirmation recorded. No money was transferred, deposited or invested.');
    } catch (e) {
      const ambiguous = !(e instanceof DesireRequestError) || e.status === 0 || e.status >= 500;
      setUncertain(ambiguous);
      if (!ambiguous) pending.current = null;
      setError(message(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  if (loading) return <p role="status">Loading allocation…</p>;
  return (
    <div className="space-y-6 break-words">
      <Link
        className="inline-flex min-h-11 items-center underline underline-offset-4"
        href={`/wants/${desireId}/history`}
      >
        Back to decision history
      </Link>
      <h1 className={pageTitleClassName}>Goal allocation</h1>
      <p ref={notice} role={error ? 'alert' : 'status'} tabIndex={-1}>
        {error || success}
      </p>
      {!uncertain ? (
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            void reload().catch((e) => setError(message(e)));
          }}
        >
          Reload latest details
        </Button>
      ) : null}
      {state ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Estimated amount not spent</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                {estimate
                  ? display(estimate.minor.toString(), estimate.currency)
                  : 'No known current declined estimate'}
              </p>
              <p className="text-sm text-muted-foreground">
                Hypothetical, counted once for this desire. Goal progress changes only after your
                explicit confirmation.
              </p>
            </CardContent>
          </Card>
          {linked ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Confirmed allocation</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {goal && leaf ? (
                  <>
                    <p>
                      {display(leaf.amountMinor, leaf.currency)} allocated to {goal.name}
                      {leaf.kind === 'reversal' ? ' (reversed)' : ''}.
                    </p>
                    <p>
                      Goal confirmed progress: {display(goal.progressMinor, goal.currency)}. Target:{' '}
                      {display(goal.targetMinor, goal.currency)}.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      An owner-confirmed record. It does not verify a bank transfer, deposit or
                      investment.
                    </p>
                    {linked.sourceChanged ? (
                      <p>
                        The source decision changed. Your confirmed allocation stays unchanged until
                        you explicitly correct or reverse it.
                      </p>
                    ) : null}
                    {goal.status === 'archived' ? (
                      <p>
                        This goal is archived. Restore it before correcting or reversing an
                        allocation.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <Button
                          className="min-h-11"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setReplacement(
                              toDecimalString(parseMinorUnits(leaf.amountMinor, leaf.currency)),
                            );
                            openDialog('correction');
                          }}
                        >
                          Correct amount
                        </Button>
                        {leaf.kind !== 'reversal' ? (
                          <Button
                            className="min-h-11"
                            variant="outline"
                            disabled={busy}
                            onClick={() => openDialog('reversal')}
                          >
                            Reverse allocation
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </>
                ) : (
                  <p>
                    The allocated goal was explicitly deleted. Its private details and ledger are
                    unavailable. This desire cannot be allocated again.
                  </p>
                )}
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void loadHistory()}
                >
                  View allocation history
                </Button>
                {history.length ? (
                  <ol aria-label="Allocation history" className="space-y-3">
                    {history.map((e) => (
                      <li key={e.id}>
                        <p>
                          {e.kind}: {display(e.amountMinor, e.currency)}
                        </p>
                        <p className="text-sm">
                          {new Date(e.createdAt).toLocaleString('en-IN')}
                          {e.supersedesId
                            ? ' · Corrective entry; earlier record preserved.'
                            : ' · Initial confirmation.'}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {before ? (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void loadHistory(before)}
                  >
                    Load earlier allocations
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Choose a goal</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!estimate ? (
                  <p>Record a declined decision with a known estimate before allocating.</p>
                ) : estimate.minor === 0n ? (
                  <p>The estimate is explicitly zero. There is no positive amount to allocate.</p>
                ) : null}
                {!goals.length ? <p>No goals available. Create a goal before allocating.</p> : null}
                <RadioGroup
                  aria-label="Allocation goal"
                  value={selected}
                  onValueChange={setSelected}
                  disabled={busy || uncertain}
                >
                  {goals.map((g) => (
                    <div key={g.id} className="flex items-start gap-3 py-2">
                      <RadioGroupItem
                        className="mt-1"
                        id={`goal-${g.id}`}
                        value={g.id}
                        disabled={
                          g.status === 'archived' ||
                          g.currency !== state.currency ||
                          !estimate ||
                          estimate.minor === 0n
                        }
                      />
                      <Label
                        htmlFor={`goal-${g.id}`}
                        className="block min-h-11 flex-1 leading-relaxed"
                      >
                        {g.name} · {display(g.targetMinor, g.currency)}
                        <span className="block text-sm text-muted-foreground">
                          {g.status === 'archived'
                            ? 'Archived'
                            : !estimate
                              ? 'Estimate unavailable'
                              : g.currency !== state.currency
                                ? 'Currency mismatch; no conversion'
                                : `Confirmed progress: ${display(g.progressMinor, g.currency)}`}
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                {after ? (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError('');
                      void allocationGoals(after)
                        .then((p) => {
                          setGoals((old) => [...old, ...p.items]);
                          setAfter(p.nextAfter);
                        })
                        .catch((e) => setError(message(e)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    Load more goals
                  </Button>
                ) : null}
                {chosen ? (
                  <p>
                    {percentage !== null
                      ? `This estimate could cover ${percentage}% of ${chosen.name}.`
                      : 'This goal has a zero target. No percentage can be calculated.'}{' '}
                    Confirmed progress remains {display(chosen.progressMinor, chosen.currency)}{' '}
                    until you confirm.
                  </p>
                ) : null}
                <Button
                  className="min-h-11"
                  disabled={!chosen || !estimate || estimate.minor === 0n || busy}
                  onClick={() => openDialog('allocate')}
                >
                  Allocate
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy && !uncertain) setDialog(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else notice.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === 'allocate'
                ? 'Confirm allocation'
                : dialog === 'reversal'
                  ? 'Confirm reversal'
                  : 'Confirm amount correction'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === 'allocate' && chosen && estimate
                ? `Record ${display(estimate.minor.toString(), estimate.currency)} as your allocation to ${chosen.name}?`
                : dialog === 'reversal'
                  ? 'Append a reversal of this allocation. Its effective amount becomes zero; earlier entries remain in history.'
                  : 'Append a replacement confirmed amount. Earlier entries remain in history.'}{' '}
              This records your confirmation only. No bank transfer, deposit or investment occurs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === 'correction' ? (
            <div className="space-y-2">
              <Label htmlFor="allocation-amount">Replacement amount ({goal?.currency})</Label>
              <Input
                id="allocation-amount"
                inputMode="decimal"
                value={replacement}
                disabled={busy || uncertain}
                onChange={(e) => setReplacement(e.target.value)}
              />
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {uncertain ? (
            <p>
              Confirmation may have succeeded. Retry the same command to safely check its result.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy || uncertain}>
              Cancel
            </AlertDialogCancel>
            <Button className="min-h-11" disabled={busy} onClick={() => void send()}>
              {busy
                ? 'Saving…'
                : uncertain
                  ? 'Retry confirmation'
                  : dialog === 'allocate'
                    ? 'Confirm allocation'
                    : dialog === 'reversal'
                      ? 'Confirm reversal'
                      : 'Confirm correction'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
