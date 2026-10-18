'use client';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  CreateGoalContributionRequest,
  Goal,
  GoalContribution,
  GoalStatus,
} from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Progress } from '@havefolio/ui/components/progress';
import { Textarea } from '@havefolio/ui/components/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@havefolio/ui/components/alert-dialog';
import { DesireRequestError } from './desires-client';
import {
  deleteGoal,
  getGoal,
  goalContributions,
  recordContribution,
  updateGoal,
} from './goals-client';
import {
  contributionKindLabels,
  effectiveEntryIds,
  goalMoney,
  goalProgressSummary,
  goalStatusLabels,
} from './goal-presentation';
import { goalMessage } from './goals-list';
import { calendarDay } from './home-presentation';
import { amountEntryToMinor, minorToAmountEntry } from './money-entry';

type Ledger = 'contribution' | 'correction' | 'reversal' | 'reinstate';
type Dialog =
  | { kind: Ledger; entry?: GoalContribution }
  | { kind: 'status'; status: GoalStatus }
  | { kind: 'delete' };
const ambiguous = (e: unknown): boolean =>
  !(e instanceof DesireRequestError) || e.status === 0 || e.status >= 500;
const code = (e: unknown): string => (e instanceof DesireRequestError ? e.code : '');
const statusCopy: Record<GoalStatus, { action: string; title: string; body: string }> = {
  active: {
    action: 'Make active again',
    title: 'Make this goal active?',
    body: 'Its history stays as it is. You can record and correct contributions while it is active.',
  },
  completed: {
    action: 'Mark completed',
    title: 'Mark this goal completed?',
    body: 'Completion is your choice and is never inferred from progress. You can still record or correct contributions.',
  },
  archived: {
    action: 'Archive',
    title: 'Archive this goal?',
    body: 'Archived goals and their full history stay readable, including in decision history. New contributions and corrections are paused until you restore it.',
  },
};

export function GoalDetail({ goalId }: Readonly<{ goalId: string }>): ReactElement {
  const router = useRouter();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [entries, setEntries] = useState<GoalContribution[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<CreateGoalContributionRequest | null>(null);
  const sending = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const [g, page] = await Promise.all([
        getGoal(goalId, signal),
        goalContributions(goalId, {}, signal),
      ]);
      if (signal?.aborted) return;
      setGoal(g);
      setEntries(page.items);
      setBefore(page.nextBefore);
    },
    [goalId],
  );
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([getGoal(goalId, c.signal), goalContributions(goalId, {}, c.signal)])
      .then(([g, page]) => {
        if (c.signal.aborted) return;
        setGoal(g);
        setEntries(page.items);
        setBefore(page.nextBefore);
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted) setLoadError(goalMessage(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [goalId]);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const open = (next: Dialog): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pending.current = null;
    setUncertain(false);
    setDialogError('');
    setNote('');
    setAmount(
      next.kind === 'correction' && 'entry' in next && next.entry
        ? minorToAmountEntry(next.entry.amountMinor, next.entry.currency)
        : '',
    );
    setDialog(next);
  };
  const close = (): void => {
    if (busy || uncertain) return;
    setDialog(null);
  };
  const refresh = async (text: string, tone: 'ok' | 'error'): Promise<void> => {
    try {
      await reload();
      setNotice({ tone, text });
    } catch (e) {
      setNotice({ tone: 'error', text: goalMessage(e) });
    }
  };

  const confirmLedger = async (d: { kind: Ledger; entry?: GoalContribution }): Promise<void> => {
    if (!goal) return;
    if (!pending.current) {
      let minor = '0';
      if (d.kind !== 'reversal') {
        try {
          minor = amountEntryToMinor(amount, goal.currency);
        } catch (e) {
          setDialogError(e instanceof Error ? e.message : 'Enter a valid amount.');
          return;
        }
        if (minor === '0') {
          setDialogError(
            d.kind === 'contribution'
              ? 'Enter an amount greater than zero.'
              : 'Enter an amount greater than zero. Use Reverse to record zero.',
          );
          return;
        }
      }
      const trimmed = note.trim();
      if (trimmed.length > 2000) {
        setDialogError('Use 2,000 characters or fewer for the note.');
        return;
      }
      pending.current = {
        commandId: crypto.randomUUID(),
        revision: goal.revision,
        kind: d.kind === 'reinstate' ? 'correction' : d.kind,
        amountMinor: minor,
        currency: goal.currency,
        ...(d.entry ? { supersedesId: d.entry.id } : {}),
        ...(trimmed ? { note: trimmed } : {}),
      };
    }
    try {
      await recordContribution(goal.id, pending.current);
      pending.current = null;
      setUncertain(false);
      setDialog(null);
      await refresh('Recorded. This is your confirmation only; no money was moved.', 'ok');
    } catch (e) {
      if (ambiguous(e)) {
        // Keep the identical command: a retry returns the original entry if it was committed.
        setUncertain(true);
        setDialogError(goalMessage(e));
        return;
      }
      pending.current = null;
      setUncertain(false);
      if (code(e) === 'STALE_GOAL_REVISION') {
        // Fresh revision loaded; the typed amount and note stay so the owner can confirm again.
        await reload().catch(() => undefined);
        setDialogError('The goal changed. Latest details are loaded; review and confirm again.');
      } else if (code(e) === 'CONTRIBUTION_ALREADY_CORRECTED' || code(e) === 'GOAL_ARCHIVED') {
        setDialog(null);
        await refresh(goalMessage(e), 'error');
      } else setDialogError(goalMessage(e));
    }
  };
  const confirmStatus = async (status: GoalStatus): Promise<void> => {
    if (!goal) return;
    try {
      setGoal(await updateGoal(goal.id, { revision: goal.revision, status }));
      setDialog(null);
      setNotice({ tone: 'ok', text: `Goal is now ${goalStatusLabels[status].toLowerCase()}.` });
    } catch (e) {
      setDialog(null);
      await refresh(goalMessage(e), 'error');
    }
  };
  const confirmDelete = async (): Promise<void> => {
    if (!goal) return;
    try {
      await deleteGoal(goal.id, goal.revision);
      router.push('/goals');
    } catch (e) {
      // A retried delete that already succeeded reports the goal as not found.
      if (uncertain && code(e) === 'GOAL_NOT_FOUND') return router.push('/goals');
      if (ambiguous(e)) {
        setUncertain(true);
        setDialogError(goalMessage(e));
        return;
      }
      setUncertain(false);
      setDialog(null);
      await refresh(goalMessage(e), 'error');
    }
  };
  const confirm = async (): Promise<void> => {
    if (!dialog || sending.current) return;
    sending.current = true;
    setBusy(true);
    setDialogError('');
    try {
      if (dialog.kind === 'status') await confirmStatus(dialog.status);
      else if (dialog.kind === 'delete') await confirmDelete();
      else await confirmLedger(dialog);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const loadEarlier = async (): Promise<void> => {
    if (!before) return;
    setBusy(true);
    try {
      const page = await goalContributions(goalId, { before });
      setEntries((old) => [...old, ...page.items]);
      setBefore(page.nextBefore);
    } catch (e) {
      setNotice({ tone: 'error', text: goalMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p role="status">Loading goal…</p>;
  if (loadError || !goal)
    return (
      <div role="alert" className="space-y-3">
        <p>{loadError || 'This goal is unavailable.'}</p>
        <Link className="underline" href="/goals">
          Back to Goals
        </Link>
      </div>
    );

  const view = goalProgressSummary(goal);
  const archived = goal.status === 'archived';
  const effective = effectiveEntryIds(entries);
  const successor = new Map(entries.flatMap((e) => (e.supersedesId ? [[e.supersedesId, e]] : [])));
  const transitions: GoalStatus[] =
    goal.status === 'active'
      ? ['completed', 'archived']
      : goal.status === 'completed'
        ? ['active', 'archived']
        : ['active'];
  const ledgerDialog =
    dialog && dialog.kind !== 'status' && dialog.kind !== 'delete' ? dialog : null;

  return (
    <div className="space-y-6 break-words">
      <Link className="text-sm underline underline-offset-4" href="/goals">
        Back to Goals
      </Link>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Goal</p>
          <h1 className="text-3xl font-semibold tracking-tight">{goal.name}</h1>
          <Badge variant={archived ? 'outline' : 'secondary'}>
            {goalStatusLabels[goal.status]}
          </Badge>
        </div>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/goals/${goal.id}/edit`}>Edit goal</Link>
        </Button>
      </header>
      <div ref={noticeRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {notice ? (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className="rounded-lg border p-4 text-sm"
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirmed progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.bar === null ? null : (
            <Progress value={view.bar} aria-labelledby="goal-progress-text" />
          )}
          <p id="goal-progress-text" className="text-lg font-medium tabular-nums">
            {view.text}
          </p>
          {view.remaining ? <p className="tabular-nums">{view.remaining}</p> : null}
          <p className="text-sm text-muted-foreground">
            Counts only contributions you have confirmed, after corrections and reversals. Estimates
            from wants you decided against are not included unless you explicitly allocated them.
            Havefolio records your confirmation; it does not move or verify money.
          </p>
          {archived ? (
            <p className="text-sm">
              Archived. Restore this goal to record or correct contributions.
            </p>
          ) : (
            <Button className="min-h-11" onClick={() => open({ kind: 'contribution' })}>
              Record a contribution
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm text-muted-foreground">Target amount</dt>
            <dd className="tabular-nums">
              {goal.targetMinor === '0'
                ? 'No target amount set'
                : goalMoney(goal.targetMinor, goal.currency)}
            </dd>
            <dt className="text-sm text-muted-foreground">Currency</dt>
            <dd>{goal.currency}</dd>
            <dt className="text-sm text-muted-foreground">Target date</dt>
            <dd>{goal.targetDate ? calendarDay(goal.targetDate) : 'None'}</dd>
            <dt className="text-sm text-muted-foreground">Private notes</dt>
            <dd className="whitespace-pre-wrap">{goal.notes ?? 'None'}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contribution history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Newest first. Corrections and reversals are added as new entries; earlier entries are
            never rewritten.
          </p>
          {entries.length === 0 ? (
            <p>No contributions confirmed yet.</p>
          ) : (
            <ol aria-label="Contribution history" className="divide-y">
              {entries.map((e) => {
                const isEffective = effective.has(e.id);
                const replacedBy = successor.get(e.id);
                return (
                  <li key={e.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium tabular-nums">
                        {contributionKindLabels[e.kind] ?? e.kind}:{' '}
                        {e.kind === 'reversal'
                          ? 'effective amount set to zero'
                          : goalMoney(e.amountMinor, e.currency)}
                      </p>
                      <Badge variant={isEffective ? 'secondary' : 'outline'}>
                        {isEffective
                          ? 'Counts toward progress'
                          : replacedBy?.kind === 'reversal'
                            ? 'Reversed'
                            : 'Replaced'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(e.createdAt))}
                      {e.supersedesId ? ' · Replaces an earlier entry, which is kept below.' : ''}
                    </p>
                    {e.note ? <p className="text-sm whitespace-pre-wrap">{e.note}</p> : null}
                    {isEffective && !archived ? (
                      <div className="flex flex-wrap gap-2">
                        {e.kind === 'reversal' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11"
                            onClick={() => open({ kind: 'reinstate', entry: e })}
                          >
                            Reinstate with an amount
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11"
                              onClick={() => open({ kind: 'correction', entry: e })}
                            >
                              Correct amount
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-11"
                              onClick={() => open({ kind: 'reversal', entry: e })}
                            >
                              Reverse
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {before ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => void loadEarlier()}
            >
              Load earlier entries
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage goal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {transitions.map((s) => (
            <Button
              key={s}
              variant="outline"
              className="min-h-11"
              onClick={() => open({ kind: 'status', status: s })}
            >
              {archived && s === 'active' ? 'Restore' : statusCopy[s].action}
            </Button>
          ))}
          <Button
            variant="outline"
            className="min-h-11 text-destructive"
            onClick={() => open({ kind: 'delete' })}
          >
            Delete goal
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={dialog !== null} onOpenChange={(o) => (o ? undefined : close())}>
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else noticeRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === 'status'
                ? archived && dialog.status === 'active'
                  ? 'Restore this goal?'
                  : statusCopy[dialog.status].title
                : dialog?.kind === 'delete'
                  ? 'Delete this goal permanently?'
                  : dialog?.kind === 'reversal'
                    ? 'Confirm reversal'
                    : dialog?.kind === 'correction'
                      ? 'Confirm corrected amount'
                      : dialog?.kind === 'reinstate'
                        ? 'Reinstate this contribution'
                        : 'Record a contribution'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === 'status'
                ? statusCopy[dialog.status].body
                : dialog?.kind === 'delete'
                  ? `This permanently deletes ${goal.name} and its whole contribution history. A want already allocated to it will show that allocation as unavailable. To keep the history, archive the goal instead.`
                  : dialog?.kind === 'reversal'
                    ? 'Adds a reversal so this entry no longer counts toward progress. The original stays in history.'
                    : dialog?.kind === 'correction' || dialog?.kind === 'reinstate'
                      ? 'Adds a replacement amount for this entry. The earlier entries stay in history.'
                      : `Record an amount you have set aside for this goal, in ${goal.currency}.`}
              {ledgerDialog
                ? ' This records your confirmation only. No transfer, deposit or investment happens.'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {ledgerDialog && ledgerDialog.kind !== 'reversal' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="goal-ledger-amount">Amount ({goal.currency})</Label>
                <Input
                  id="goal-ledger-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  className="min-h-11 tabular-nums"
                  value={amount}
                  disabled={busy || uncertain}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-ledger-note">Note (optional)</Label>
                <Textarea
                  id="goal-ledger-note"
                  rows={2}
                  maxLength={2000}
                  value={note}
                  disabled={busy || uncertain}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          ) : null}
          {dialogError ? (
            <p role="alert" className="text-sm">
              {dialogError}
            </p>
          ) : null}
          {uncertain ? (
            <p className="text-sm">
              This may already have been saved. Retrying sends the same request, so it cannot be
              recorded twice.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy || uncertain}>
              Cancel
            </AlertDialogCancel>
            <Button
              className="min-h-11"
              variant={dialog?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? 'Saving…'
                : uncertain
                  ? 'Retry'
                  : dialog?.kind === 'delete'
                    ? 'Delete permanently'
                    : dialog?.kind === 'status'
                      ? archived && dialog.status === 'active'
                        ? 'Restore'
                        : statusCopy[dialog.status].action
                      : 'Confirm'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
