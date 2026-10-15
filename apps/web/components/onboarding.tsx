'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OnboardingAction, OnboardingStatus } from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@havefolio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@havefolio/ui/components/dialog';
import { onboardingRequest } from './onboarding-client';

/** Product composition of existing shadcn primitives; no blocking tour or browser persistence. */
export function Onboarding({
  store = false,
  request = onboardingRequest,
}: {
  store?: boolean;
  request?: typeof onboardingRequest;
}): React.JSX.Element {
  const [status, setStatus] = useState<OnboardingStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    request(store ? 'browse_store' : 'read')
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setError('Welcome help could not load. Manual entry is available.');
      });
    return () => {
      active = false;
    };
  }, [request, store]);
  async function run(operation: 'demo' | 'remove' | OnboardingAction | 'read'): Promise<void> {
    setBusy(true);
    setError('');
    try {
      setStatus(await request(operation));
      if (operation === 'demo' || operation === 'remove')
        window.dispatchEvent(new Event('havefolio-inventory-changed'));
      setNotice(
        operation === 'remove'
          ? 'Demo inventory removed. Your genuine items are unchanged.'
          : operation === 'demo'
            ? 'Demo inventory added. All amounts are examples.'
            : 'Welcome checklist updated.',
      );
      setConfirm(false);
    } catch {
      setError('Could not update welcome help. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  const visible = status?.state === 'active' || status?.state === 'not_started';
  return (
    <section aria-label="Welcome help" className="my-6 space-y-3">
      <p role="status" className={notice ? 'text-sm' : 'sr-only'}>
        {notice}
      </p>
      {error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>{error}</p>
          <Button variant="outline" disabled={busy} onClick={() => void run('read')}>
            Retry welcome help
          </Button>
          <Button asChild variant="link">
            <Link href="/items/new">Add an item</Link>
          </Button>
        </div>
      ) : null}
      {visible ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Make yourself at home</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Start with something you own, or explore optional demo inventory. Demo items are
              fictional, read-only examples, excluded from real spending totals. Remove them
              whenever you like.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="min-h-11">
                <Link href="/items/new">
                  {status.genuineItemCount ? 'Add an item' : 'Add my first item'}
                </Link>
              </Button>
              {!status.demoItemCount ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => void run('demo')}
                >
                  Explore optional demo inventory
                </Button>
              ) : (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/store">Browse demo inventory</Link>
                </Button>
              )}
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => void run('skip')}
              >
                Skip for now
              </Button>
            </div>
            <ul aria-label="Welcome checklist" className="space-y-2 text-sm">
              <li>
                {status.genuineItemCount > 0 ? '✓' : '○'} Add a genuine item{' '}
                <span className="text-muted-foreground">
                  — a name is enough; photo and price are optional.
                </span>
              </li>
              <li>
                {status.browsedStore ? '✓' : '○'}{' '}
                <Link className="underline" href="/store">
                  Browse My Store
                </Link>
              </li>
              <li>{status.reviewedItem ? '✓' : '○'} Review a genuine item’s details</li>
              <li>{status.triedDemo ? '✓' : '○'} Optionally explore demo examples</li>
              <li>{status.removedDemo ? '✓' : '○'} Remove demos when finished (optional)</li>
            </ul>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => void run('complete')}
            >
              Dismiss checklist
            </Button>
          </CardContent>
        </Card>
      ) : status ? (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => void run('revisit')}
        >
          Revisit welcome help
        </Button>
      ) : null}
      {status && status.genuineItemCount === 0 && !visible ? (
        <p className="text-sm">
          Ready for your own inventory?{' '}
          <Link className="underline" href="/items/new">
            Add your first genuine item
          </Link>
          . A photo and price are optional.
        </p>
      ) : null}
      {status?.demoItemCount ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <p className="min-w-0 flex-1">
            {status.demoItemCount} demo examples. Sample amounts do not count toward your spending.
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Remove all demo data
          </Button>
        </div>
      ) : null}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove all demo data?</DialogTitle>
            <DialogDescription>
              Only your labelled demo examples will be removed. Your genuine items and categories
              will stay. You can explicitly add demos again from welcome help.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
              Keep demos
            </Button>
            <Button disabled={busy} onClick={() => void run('remove')}>
              {busy ? 'Removing…' : 'Remove demos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
