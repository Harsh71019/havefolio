'use client';
import { useEffect, useState, type ReactElement, type FormEvent } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@havefolio/ui/components/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@havefolio/ui/components/alert-dialog';

interface DeletionStatus {
  state: string;
  remainingFiles: number;
  awaitingFinality: number;
  completedAt: string | null;
}
const storageKey = 'havefolio.deletion-receipt.v1';
async function send(path: string, body: object): Promise<DeletionStatus> {
  const response = await fetch(`/api/v1/privacy/${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? 'Your password or session could not be verified. Sign in again if needed.'
        : response.status === 404
          ? 'No deletion was found for this receipt. If the request was interrupted, sign in and try again.'
          : response.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : 'The request could not be completed. Check your connection and try again.',
    );
  }
  return response.json() as Promise<DeletionStatus>;
}
export function PrivacyControls(): ReactElement {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [receipt, setReceipt] = useState('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) queueMicrotask(() => setReceipt(saved));
    } catch {
      /* Deletion admission fails safely if its receipt cannot be saved. */
    }
  }, []);
  async function refresh(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      setStatus(await send('deletion-status', { receipt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to check deletion.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Persist before submission so a lost response cannot lose access after session revocation.
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const next = /^[a-f0-9]{64}$/.test(receipt)
        ? receipt
        : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(storageKey, next);
      setReceipt(next);
      const result = await send('deletion', { password, confirmation, receipt: next });
      setStatus(result);
      setOpen(false);
      setConfirmation('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to request deletion.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  async function download(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/privacy/export', {
        signal: AbortSignal.timeout(30_000),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(
          response.status === 413
            ? 'Your data exceeds the export limit. Contact your deployment operator for a complete private export.'
            : 'Unable to export your data. Check your session and connection, then try again.',
        );
      const url = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'havefolio-private-export.json';
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to export your data.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Download your private records or permanently delete your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The JSON export includes your records, histories and attachment metadata. Photo and
          document files are downloaded separately from their items. Keep your download private.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={busy || !!status} onClick={() => void download()}>
            Download private data
          </Button>
          <Button variant="destructive" disabled={busy || !!status} onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </div>
        {busy ? <p role="status">Working…</p> : null}
        {status ? (
          <div role="status" className="space-y-2 text-sm">
            <p>
              {status.state === 'completed'
                ? 'Your account and active application data have been deleted.'
                : status.state === 'awaiting_finality'
                  ? 'Deletion is pending provider finality. Exact cleanup keys are retained and cleanup retries continue.'
                  : status.state === 'retrying'
                    ? 'Private-file cleanup is retrying after a temporary failure. Your normal sessions have been revoked.'
                    : 'Deletion is pending. Your normal sessions have been revoked.'}
            </p>
            <p>
              {status.remainingFiles} files awaiting successful cleanup; {status.awaitingFinality}{' '}
              awaiting provider finality.
            </p>
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Deletion cannot retract previous downloads or notifications already being sent. Existing
          backups follow the deployment backup policy; this operation does not claim immediate
          backup erasure.
        </p>
        <details>
          <summary className="cursor-pointer text-sm">
            Check deletion status or recover with a saved receipt
          </summary>
          <div className="mt-3 space-y-3">
            <Label htmlFor="deletion-receipt">Status receipt (keep private)</Label>
            <Input
              id="deletion-receipt"
              type="password"
              value={receipt}
              autoComplete="off"
              onChange={(e) => setReceipt(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Saved on this browser before submission. Copy it somewhere private before clearing
              browser data. It grants status access only and expires 30 days after completion.
            </p>
            <Button
              variant="outline"
              disabled={busy || !/^[a-f0-9]{64}$/.test(receipt)}
              onClick={() => void refresh()}
            >
              Check deletion status
            </Button>
          </div>
        </details>
        {error && !open ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialog
          open={open}
          onOpenChange={(v) => {
            if (!busy) {
              setOpen(v);
              setPassword('');
              setConfirmation('');
              setError('');
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. All sessions will be revoked. Private-file cleanup runs
                asynchronously and deletion stays pending until provider finality is established.
                Download your records and attachments first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form onSubmit={(e) => void remove(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="delete-password">Current password</Label>
                <Input
                  id="delete-password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delete-confirmation">Type DELETE MY ACCOUNT to confirm</Label>
                <Input
                  id="delete-confirmation"
                  autoComplete="off"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  disabled={busy}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Keep account</AlertDialogCancel>
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={busy || !password || confirmation !== 'DELETE MY ACCOUNT'}
                >
                  {busy ? 'Requesting deletion…' : 'Confirm permanent deletion'}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
