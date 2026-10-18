'use client';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Archive, Heart, PlusCircle, Sparkles, Target, Wallet } from 'lucide-react';
import type { HomeSummary } from '@havefolio/contracts';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@havefolio/ui/components/card';
import { Progress } from '@havefolio/ui/components/progress';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { effectiveStateInfo } from './desires-client';
import { HomeRequestError, readHome } from './home-client';
import { calendarDay, goalProgress, plural, spendingByCurrency } from './home-presentation';
import { conditionLabels, eventDay } from './item-detail-presentation';
import { photoSource } from './photos-client';
import { formatAggregate } from './spending-presentation';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; summary: HomeSummary }
  | { state: 'error'; error: HomeRequestError };

function Section({
  id,
  icon: Icon,
  title,
  description,
  children,
  footer,
}: Readonly<{
  id: string;
  icon: typeof Archive;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}>): ReactElement {
  return (
    <Card aria-labelledby={id} role="region" className="min-w-0">
      <CardHeader>
        <h2 id={id} className="flex items-center gap-2 leading-none font-semibold">
          <Icon aria-hidden="true" className="size-5" />
          {title}
        </h2>
        {description ? (
          <CardDescription className="leading-6">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      {footer ? <CardFooter className="mt-auto flex-wrap gap-2">{footer}</CardFooter> : null}
    </Card>
  );
}
function Action({
  href,
  children,
  primary = false,
}: Readonly<{ href: string; children: ReactNode; primary?: boolean }>): ReactElement {
  return (
    <Button asChild variant={primary ? 'default' : 'outline'} className="min-h-11">
      <Link href={href}>
        {children}
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}
function EmptyNote({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return <p className="text-sm leading-6 text-muted-foreground">{children}</p>;
}

function AtAGlance({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  const stats = [
    {
      label: 'Items you own',
      value: s.inventory.ownedCount,
      note: s.inventory.sampleOwnedCount
        ? `Plus ${plural(s.inventory.sampleOwnedCount, 'sample item')}, not counted`
        : 'Currently owned records',
      href: '/store',
    },
    {
      label: 'Active wants',
      value: s.desires.activeCount,
      note: s.desires.readyForReviewCount
        ? `${s.desires.readyForReviewCount.toLocaleString('en-IN')} ready to review`
        : 'Considering or waiting',
      href: '/wants',
    },
    {
      label: 'Active goals',
      value: s.goals.activeCount,
      note: 'Confirmed progress only',
      href: '/goals',
    },
  ];
  return (
    <section aria-labelledby="home-glance-title">
      <h2 id="home-glance-title" className="sr-only">
        At a glance
      </h2>
      <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="relative rounded-xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">
              <Link
                href={stat.href}
                className="after:absolute after:inset-0 focus-visible:outline-none after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
              >
                {stat.label}
              </Link>
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {stat.value.toLocaleString('en-IN')}
            </dd>
            <dd className="mt-1 text-xs leading-5 text-muted-foreground">{stat.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Rediscovery({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  const item = s.rediscovery.item;
  if (!item)
    return (
      <Section
        id="home-rediscover-title"
        icon={Sparkles}
        title="Rediscover something you own"
        footer={
          s.inventory.ownedCount ? (
            <Action href="/store">Open My Store</Action>
          ) : (
            <Action href="/items/new" primary>
              Add your first item
            </Action>
          )
        }
      >
        <EmptyNote>
          {s.inventory.ownedCount
            ? 'Nothing to suggest yet. When you mark an owned item as rarely or not used, one will appear here. Broken and worn-out items are never suggested.'
            : 'Add the things you already own. Items you mark as rarely used will be suggested here.'}
        </EmptyNote>
      </Section>
    );
  return (
    <Section
      id="home-rediscover-title"
      icon={Sparkles}
      title="Rediscover something you own"
      description="An item you told Havefolio you rarely use. Maybe it fits something you need right now."
      footer={
        <>
          <Action href={`/items/${item.id}`} primary>
            Open this item
          </Action>
          {s.rediscovery.eligibleCount > 1 ? (
            <Action href={`/store?useFrequency=${item.useFrequency}`}>
              See {item.useFrequency === 'never' ? 'unused' : 'rarely used'} items
            </Action>
          ) : null}
        </>
      }
    >
      <div className="flex gap-4">
        <ItemCover
          className="w-24 shrink-0 rounded-lg sm:w-32"
          cover={
            item.cover
              ? photoSource(
                  item.id,
                  { id: item.cover.photoId, width: item.cover.width, height: item.cover.height },
                  item.cover.decorative ? '' : (item.cover.altText ?? `Photo of ${item.name}`),
                  '128px',
                )
              : null
          }
          emptyLabel="No photo"
        />
        <div className="min-w-0 space-y-2">
          <p className="text-lg font-medium break-words">{item.name}</p>
          <dl className="space-y-1 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">How often you use it:</dt>
              <dd>{item.useFrequency === 'never' ? 'Not used' : 'Rarely'}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Last recorded use:</dt>
              <dd>{item.lastUsedAt ? eventDay(item.lastUsedAt) : 'None recorded'}</dd>
            </div>
            {item.condition !== 'working' ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Condition:</dt>
                <dd>{conditionLabels[item.condition]}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </Section>
  );
}

function Spending({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  const rows = spendingByCurrency(s.spending);
  return (
    <Section
      id="home-spending-title"
      icon={Wallet}
      title="Recorded spending"
      description="What you paid for items you currently own, net of confirmed refunds. Each currency is shown separately; this is not a current or resale value."
      footer={
        rows.length ? (
          <Action href="/insights">See spending insights</Action>
        ) : (
          <Action href="/items/new" primary>
            Record a purchase
          </Action>
        )
      }
    >
      {rows.length ? (
        <dl className="space-y-4">
          {rows.map((row) => (
            <div key={row.currency} className="space-y-1 border-t pt-3 first:border-t-0 first:pt-0">
              <dt className="text-sm text-muted-foreground">
                {row.currency} · purchases with a date
              </dt>
              <dd className="text-2xl font-semibold break-words tabular-nums">
                {formatAggregate(row.dated?.netMinor ?? '0', row.currency)}
              </dd>
              {row.unknownDate ? (
                <dd className="text-sm text-muted-foreground">
                  Separately, purchase date unknown:{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatAggregate(row.unknownDate.netMinor, row.currency)}
                  </span>
                </dd>
              ) : null}
              {row.unknownPriceCount ? (
                <dd className="text-sm text-muted-foreground">
                  {plural(row.unknownPriceCount, 'item')} with no price recorded{' '}
                  {row.unknownPriceCount === 1 ? 'is' : 'are'} not included.
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : (
        <EmptyNote>
          No purchases recorded for items you own yet. Sample items never count toward spending.
        </EmptyNote>
      )}
    </Section>
  );
}

function RecentItems({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  return (
    <Section
      id="home-recent-title"
      icon={Archive}
      title="Recently added"
      footer={
        s.recentItems.length ? (
          <Action href="/store">Open My Store</Action>
        ) : (
          <Action href="/items/new" primary>
            Add an item
          </Action>
        )
      }
    >
      {s.recentItems.length ? (
        <ul className="grid grid-cols-2 gap-3">
          {s.recentItems.map((item) => (
            <li key={item.id} className="min-w-0">
              <Link
                href={`/items/${item.id}`}
                className="group block rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ItemCover
                  className="rounded-lg"
                  cover={
                    item.cover
                      ? photoSource(
                          item.id,
                          {
                            id: item.cover.photoId,
                            width: item.cover.width,
                            height: item.cover.height,
                          },
                          item.cover.decorative
                            ? ''
                            : (item.cover.altText ?? `Photo of ${item.name}`),
                          '(min-width: 1024px) 160px, 45vw',
                        )
                      : null
                  }
                  emptyLabel="No photo"
                  announceFailure={false}
                />
                <span className="mt-2 line-clamp-2 text-sm font-medium break-words group-hover:underline">
                  {item.name}
                </span>
                {item.isDemo ? (
                  <Badge variant="secondary" className="mt-1">
                    Sample
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>Nothing here yet. Start with one thing you use every day.</EmptyNote>
      )}
    </Section>
  );
}

function Wants({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  return (
    <Section
      id="home-wants-title"
      icon={Heart}
      title="Active wants"
      footer={
        s.desires.items.length ? (
          <Action href="/wants">View all wants</Action>
        ) : (
          <Action href="/wants/new" primary>
            Add a want
          </Action>
        )
      }
    >
      {s.desires.items.length ? (
        <ul className="divide-y">
          {s.desires.items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link
                href={`/wants/${d.id}/compare`}
                className="inline-flex min-h-11 min-w-0 items-center font-medium break-words hover:underline"
              >
                {d.name}
              </Link>
              <Badge variant={d.effectiveState === 'ready_for_review' ? 'default' : 'outline'}>
                {effectiveStateInfo[d.effectiveState].label}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>
          No active wants. Writing one down gives a possible purchase some time before you decide.
        </EmptyNote>
      )}
    </Section>
  );
}

function Goals({ summary: s }: Readonly<{ summary: HomeSummary }>): ReactElement {
  return (
    <Section
      id="home-goals-title"
      icon={Target}
      title="Goals"
      description="Progress counts only contributions you have confirmed."
      footer={<Action href="/goals">Open Goals</Action>}
    >
      {s.goals.items.length ? (
        <ul className="space-y-4">
          {s.goals.items.map((g) => {
            const view = goalProgress(g.progressMinor, g.targetMinor, g.currency);
            const textId = `home-goal-${g.id}`;
            return (
              <li key={g.id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium break-words">{g.name}</span>
                  {g.targetDate ? (
                    <span className="text-xs text-muted-foreground">
                      Target {calendarDay(g.targetDate)}
                    </span>
                  ) : null}
                </div>
                {view.percent === null ? null : (
                  <Progress value={view.percent} aria-labelledby={textId} />
                )}
                <p id={textId} className="text-sm text-muted-foreground tabular-nums">
                  {g.name}: {view.text}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyNote>No active goals yet. A goal keeps another possibility in view.</EmptyNote>
      )}
    </Section>
  );
}

/** Product composition of existing shadcn primitives; one bounded owner-scoped request. */
export function HomeDashboard({
  request = readHome,
}: Readonly<{ request?: typeof readHome }>): ReactElement {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    request(abort.signal)
      .then((summary) => setLoad({ state: 'ready', summary }))
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setLoad({
          state: 'error',
          error:
            error instanceof HomeRequestError
              ? error
              : new HomeRequestError(503, 'Your Home summary is temporarily unavailable.'),
        });
      });
    const refresh = (): void => setAttempt((n) => n + 1);
    window.addEventListener('havefolio-inventory-changed', refresh);
    window.addEventListener('online', refresh);
    return () => {
      abort.abort();
      window.removeEventListener('havefolio-inventory-changed', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [request, attempt]);

  if (load.state === 'loading')
    return (
      <div className="mt-8">
        <p role="status" className="sr-only">
          Loading your Home summary…
        </p>
        <div aria-hidden="true" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-28 motion-reduce:animate-none" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-56 motion-reduce:animate-none" />
            ))}
          </div>
        </div>
      </div>
    );
  if (load.state === 'error')
    return (
      <Alert role="alert" className="mt-8">
        <AlertTitle>
          {load.error.status === 401 ? 'Sign in to continue' : 'Your Home summary could not load'}
        </AlertTitle>
        <AlertDescription>
          <p>{load.error.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {load.error.status === 401 ? (
              <Button asChild className="min-h-11">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : (
              <Button
                className="min-h-11"
                onClick={() => {
                  setLoad({ state: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                Retry Home summary
              </Button>
            )}
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/items/new">
                <PlusCircle aria-hidden="true" />
                Add an item
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  const s = load.summary;
  return (
    <div className="mt-8 space-y-4">
      <AtAGlance summary={s} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Rediscovery summary={s} />
        <Spending summary={s} />
        <RecentItems summary={s} />
        <Wants summary={s} />
        <Goals summary={s} />
      </div>
    </div>
  );
}
