'use client';
import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import type { Desire, Goal } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { getDesire } from './desires-client';
import { listGoals } from './goals-client';
import { comparePriceWithGoal, goalMoney, type PriceComparison } from './goal-presentation';
import { goalMessage } from './goals-list';

function comparisonText(desire: Desire, goal: Goal, c: PriceComparison): string {
  const price =
    desire.likelyPriceMinor && desire.currency
      ? goalMoney(desire.likelyPriceMinor, desire.currency)
      : '';
  switch (c.kind) {
    case 'percent': {
      const target = goalMoney(goal.targetMinor, goal.currency);
      const lead = c.coversTarget
        ? `${price} is enough to cover the whole ${target} target for ${goal.name} (${c.ofTarget}%).`
        : `${price} could cover ${c.ofTarget}% of the ${target} target for ${goal.name}.`;
      return c.ofRemaining && c.remaining
        ? `${lead} That is ${c.ofRemaining}% of the ${c.remaining} still to go.`
        : lead;
    }
    case 'zero-target':
      return `${goal.name} has no target amount, so no percentage is shown.`;
    case 'zero-price':
      return 'The likely price is zero, so there is nothing to compare.';
    case 'mismatch':
      return `This want is priced in ${c.priceCurrency} and ${goal.name} uses ${c.goalCurrency}. Havefolio does not convert currencies.`;
    case 'unknown':
      return 'No likely price is recorded, so no comparison is shown.';
  }
}

/**
 * A hypothetical side-by-side view only. It never writes to the ledger; turning an estimate into
 * confirmed progress stays in the PER-31 allocation flow, behind its explicit confirmation.
 */
export function DesireGoalComparison({ desireId }: Readonly<{ desireId: string }>): ReactElement {
  const [desire, setDesire] = useState<Desire | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const c = new AbortController();
    void Promise.all([getDesire(desireId, c.signal), listGoals({}, c.signal)])
      .then(([d, page]) => {
        if (c.signal.aborted) return;
        setDesire(d);
        setGoals(page.items);
        setAfter(page.nextAfter);
      })
      .catch((e: unknown) => {
        if (!c.signal.aborted) setError(goalMessage(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [desireId, attempt]);

  if (loading) return <p role="status">Loading comparison…</p>;
  if (error || !desire)
    return (
      <div role="alert" className="space-y-3">
        <p>{error || 'This want is unavailable.'}</p>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setLoading(true);
            setError('');
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );

  const chosen = goals.find((g) => g.id === selected);
  const price = { minor: desire.likelyPriceMinor, currency: desire.currency };
  const known = price.minor !== null && price.currency !== null;
  const result = chosen ? comparePriceWithGoal(price, chosen) : null;

  return (
    <div className="space-y-6 break-words">
      <Card>
        <CardHeader>
          <CardTitle>{desire.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-lg tabular-nums">
            {known ? (
              <>Likely price: {goalMoney(price.minor!, price.currency!)}</>
            ) : (
              'No likely price recorded'
            )}
          </p>
          {!known ? (
            <Link className="text-sm underline" href={`/wants/${desire.id}/edit`}>
              Add a likely price to compare
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Choose a goal to compare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {goals.length === 0 ? (
            <p>
              No goals yet.{' '}
              <Link className="underline" href="/goals/new">
                Create a goal
              </Link>{' '}
              to compare against.
            </p>
          ) : (
            <RadioGroup aria-label="Goal to compare" value={selected} onValueChange={setSelected}>
              {goals.map((g) => {
                const mismatch = known && g.currency !== price.currency;
                const disabled = g.status === 'archived' || mismatch;
                return (
                  <div key={g.id} className="flex items-start gap-3 py-2">
                    <RadioGroupItem
                      className="mt-1"
                      id={`compare-goal-${g.id}`}
                      value={g.id}
                      disabled={disabled}
                    />
                    <Label htmlFor={`compare-goal-${g.id}`} className="block leading-relaxed">
                      {g.name} ·{' '}
                      {g.targetMinor === '0'
                        ? 'no target amount'
                        : goalMoney(g.targetMinor, g.currency)}
                      <span className="block text-sm font-normal text-muted-foreground">
                        {g.status === 'archived'
                          ? 'Archived'
                          : mismatch
                            ? `Uses ${g.currency}; no conversion`
                            : `Confirmed progress: ${goalMoney(g.progressMinor, g.currency)}`}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          )}
          {after ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void listGoals({ after })
                  .then((p) => {
                    setGoals((old) => [...old, ...p.items]);
                    setAfter(p.nextAfter);
                  })
                  .catch((e: unknown) => setError(goalMessage(e)))
                  .finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? 'Loading…' : 'Load more goals'}
            </Button>
          ) : null}
          <div aria-live="polite" className="space-y-2">
            {chosen && result ? (
              <>
                <p className="font-medium">
                  If you don’t buy it: {comparisonText(desire, chosen, result)}
                </p>
                <p className="text-sm text-muted-foreground">
                  This is a possibility, not a saving. Nothing is transferred, deposited or
                  invested, and the confirmed progress for {chosen.name} stays at{' '}
                  {goalMoney(chosen.progressMinor, chosen.currency)}.
                </p>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Counting it toward a goal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {desire.effectiveState === 'declined' ? (
            <>
              <p>
                You decided against this want. Its estimate counts toward a goal only if you
                explicitly confirm an allocation, which uses the estimate recorded with your
                decision.
              </p>
              <Button asChild variant="outline" className="min-h-11">
                <Link href={`/wants/${desire.id}/allocate`}>Review goal allocation</Link>
              </Button>
            </>
          ) : (
            <p>
              Goal progress changes only if you later decide against this want and then explicitly
              confirm an allocation from its decision history.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
