'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  popularCurrencies,
  type CreateGoalRequest,
  type Goal,
  type PatchGoalRequest,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Textarea } from '@havefolio/ui/components/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { DesireRequestError } from './desires-client';
import { createGoal, getGoal, goalContributions, updateGoal } from './goals-client';
import { goalMoney, isCalendarDate } from './goal-presentation';
import { goalMessage } from './goals-list';
import { amountEntryToMinor, minorToAmountEntry } from './money-entry';
import { fetchOwnerPreferences } from './settings-client';

interface Draft {
  name: string;
  target: string;
  currency: string;
  targetDate: string;
  notes: string;
}
type Errors = Partial<Record<keyof Draft, string>>;
const fromGoal = (g: Goal): Draft => ({
  name: g.name,
  target: minorToAmountEntry(g.targetMinor, g.currency),
  currency: g.currency,
  targetDate: g.targetDate ?? '',
  notes: g.notes ?? '',
});

/** Validated wire values. Amounts stay exact minor-unit strings; nothing is rounded. */
function validate(d: Draft): { errors: Errors; body?: CreateGoalRequest } {
  const errors: Errors = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Enter a goal name.';
  else if (name.length > 200) errors.name = 'Use 200 characters or fewer.';
  let targetMinor = '';
  if (!d.target.trim()) errors.target = 'Enter a target amount, or 0 for no target amount.';
  else
    try {
      targetMinor = amountEntryToMinor(d.target, d.currency);
    } catch (e) {
      errors.target = e instanceof Error ? e.message : 'Enter a valid amount.';
    }
  if (d.targetDate && !isCalendarDate(d.targetDate)) errors.targetDate = 'Choose a real date.';
  if (d.notes.trim().length > 2000) errors.notes = 'Use 2,000 characters or fewer.';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    body: {
      name,
      targetMinor,
      currency: d.currency,
      targetDate: d.targetDate || null,
      notes: d.notes.trim() || null,
    },
  };
}

export function GoalForm({ goalId }: Readonly<{ goalId?: string }>): ReactElement {
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<Draft>({
    name: '',
    target: '',
    currency: 'INR',
    targetDate: '',
    notes: '',
  });
  const [saved, setSaved] = useState<Goal | null>(null);
  const [currencyLocked, setCurrencyLocked] = useState(false);
  const [loading, setLoading] = useState(Boolean(goalId));
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [ambiguousCreate, setAmbiguousCreate] = useState(false);
  const [latest, setLatest] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = useRef<HTMLDivElement>(null);
  const touchedCurrency = useRef(false);

  useEffect(() => {
    if (goalId) return;
    let active = true;
    void fetchOwnerPreferences()
      .then((p) => {
        if (active && p?.defaultCurrency && !touchedCurrency.current)
          setDraft((d) => ({ ...d, currency: p.defaultCurrency }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [goalId]);
  useEffect(() => {
    if (!goalId) return;
    const c = new AbortController();
    void Promise.all([getGoal(goalId, c.signal), goalContributions(goalId, { limit: 1 }, c.signal)])
      .then(([g, history]) => {
        if (c.signal.aborted) return;
        setSaved(g);
        setDraft(fromGoal(g));
        setCurrencyLocked(history.items.length > 0);
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
    if (error || latest) notice.current?.focus();
  }, [error, latest]);

  const set = (key: keyof Draft, value: string): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = async (): Promise<void> => {
    const { errors: found, body } = validate(draft);
    // After a stale conflict the owner chose to keep their edits against the latest version.
    const base = latest ?? saved;
    setErrors(found);
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      if (!base) {
        const created = await createGoal(body);
        router.push(`/goals/${created.id}`);
        return;
      }
      const patch: PatchGoalRequest = {
        revision: base.revision,
        name: body.name,
        targetMinor: body.targetMinor,
        targetDate: body.targetDate ?? null,
        notes: body.notes ?? null,
      };
      // Currency is sent only when changed: the API locks it after the first ledger entry.
      if (body.currency !== base.currency) patch.currency = body.currency;
      const updated = await updateGoal(base.id, patch);
      setLatest(null);
      router.push(`/goals/${updated.id}`);
    } catch (e) {
      // Draft input is intentionally kept in memory so nothing typed is lost.
      if (e instanceof DesireRequestError && e.code === 'STALE_GOAL_REVISION' && saved) {
        try {
          setLatest(await getGoal(saved.id));
          setError('');
        } catch (reload) {
          setError(goalMessage(reload));
        }
      } else {
        if (e instanceof DesireRequestError && e.code === 'GOAL_CURRENCY_LOCKED')
          setCurrencyLocked(true);
        setAmbiguousCreate(
          !saved && (!(e instanceof DesireRequestError) || e.status === 0 || e.status >= 500),
        );
        setError(goalMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!busy) void save();
  };

  if (loading) return <p role="status">Loading goal…</p>;
  if (loadError)
    return (
      <div role="alert" className="space-y-3">
        <p>{loadError}</p>
        <Link className="underline" href="/goals">
          Back to Goals
        </Link>
      </div>
    );
  const currencies = popularCurrencies.some((c) => c.code === draft.currency)
    ? popularCurrencies
    : [{ code: draft.currency, symbol: draft.currency }, ...popularCurrencies];
  const field = (key: keyof Draft): Record<string, unknown> => ({
    id: `${id}-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id}-${key}-error` : `${id}-${key}-help`,
  });
  const help = (key: keyof Draft, text: string): ReactElement =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : (
      <p id={`${id}-${key}-help`} className="text-sm text-muted-foreground">
        {text}
      </p>
    );

  return (
    <form className="max-w-xl space-y-6" noValidate onSubmit={submit} aria-busy={busy}>
      <div ref={notice} tabIndex={-1} className="outline-none">
        {latest ? (
          <div role="alert" className="space-y-3 rounded-lg border p-4">
            <p className="font-medium">This goal was changed elsewhere.</p>
            <p className="text-sm break-words">
              Latest saved version: {latest.name} · target{' '}
              {goalMoney(latest.targetMinor, latest.currency)}
              {latest.targetDate ? ` · ${latest.targetDate}` : ''}. Your edits below are kept.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={busy}>
                Save my edits over it
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setSaved(latest);
                  setDraft(fromGoal(latest));
                  setLatest(null);
                  setErrors({});
                }}
              >
                Use the latest saved version
              </Button>
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="space-y-2 rounded-lg border p-4">
            <p>{error}</p>
            {ambiguousCreate ? (
              <p className="text-sm">
                The goal may already have been created. Check{' '}
                <Link className="underline" href="/goals">
                  your goals
                </Link>{' '}
                before saving again, to avoid a duplicate.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>Goal name</Label>
        <Input
          {...field('name')}
          value={draft.name}
          maxLength={200}
          autoComplete="off"
          className="min-h-11"
          onChange={(e) => set('name', e.target.value)}
        />
        {help('name', 'For example, a trip, a course or an emergency fund.')}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-target`}>Target amount</Label>
          <Input
            {...field('target')}
            value={draft.target}
            inputMode="decimal"
            autoComplete="off"
            className="min-h-11 tabular-nums"
            onChange={(e) => set('target', e.target.value)}
          />
          {help('target', 'Enter 0 if you have no amount in mind yet.')}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-currency`}>Currency</Label>
          <Select
            value={draft.currency}
            disabled={currencyLocked}
            onValueChange={(v) => {
              touchedCurrency.current = true;
              set('currency', v);
            }}
          >
            <SelectTrigger
              id={`${id}-currency`}
              className="min-h-11 w-full"
              aria-describedby={`${id}-currency-help`}
            >
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c.code} value={c.code} className="min-h-11">
                  {c.code} ({c.symbol})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${id}-currency-help`} className="text-sm text-muted-foreground">
            {currencyLocked
              ? 'Fixed after the first contribution.'
              : 'Amounts are never converted.'}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-targetDate`}>Target date (optional)</Label>
        <Input
          {...field('targetDate')}
          type="date"
          value={draft.targetDate}
          className="min-h-11 w-full sm:w-56"
          onChange={(e) => set('targetDate', e.target.value)}
        />
        {help('targetDate', 'Leave empty if there is no date.')}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-notes`}>Private notes (optional)</Label>
        <Textarea
          {...field('notes')}
          value={draft.notes}
          maxLength={2000}
          rows={4}
          onChange={(e) => set('notes', e.target.value)}
        />
        {help('notes', 'Only you can see these.')}
      </div>
      {saved ? (
        <p className="text-sm text-muted-foreground">
          Changing the target never changes confirmed contributions or their history.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          New goals start active with no confirmed progress.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="min-h-11" disabled={busy || Boolean(latest)}>
          {busy ? 'Saving…' : saved ? 'Save changes' : 'Create goal'}
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={saved ? `/goals/${saved.id}` : '/goals'}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
