'use client';

import {
  Archive,
  ArrowRight,
  Bell,
  CheckCircle2,
  Coins,
  Laptop,
  Lock,
  LogOut,
  RefreshCw,
  Shield,
  Smartphone,
  Tag,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { currencyCodes } from '@havefolio/domain';
import type {
  AuthSessionSummary,
  OwnerPreferences,
  PrivacyExplanation,
  SettingsDemoStatus,
  SettingsOverview,
} from '@havefolio/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@havefolio/ui/components/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Label } from '@havefolio/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Switch } from '@havefolio/ui/components/switch';
import { onboardingRequest } from './onboarding-client';
import {
  fetchSettingsOverview,
  revokeActiveSession,
  revokeOtherSessions,
  updateOwnerPreferences,
  SettingsRequestError,
} from './settings-client';

const popularCurrencies = [
  'INR',
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'SGD',
  'JPY',
  'CHF',
  'AED',
] as const;

export function SettingsView(): ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Loaded state
  const [preferences, setPreferences] = useState<OwnerPreferences | null>(null);
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyExplanation | null>(null);
  const [demoStatus, setDemoStatus] = useState<SettingsDemoStatus | null>(null);

  // Form edit state
  const [selectedCurrency, setSelectedCurrency] = useState('INR');
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [ntfyEnabled, setNtfyEnabled] = useState(true);

  // Demo action state
  const [demoActionLoading, setDemoActionLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  // Session action state
  const [sessionActionLoading, setSessionActionLoading] = useState<string | null>(null);
  const [revokeAllLoading, setRevokeAllLoading] = useState(false);

  function applyOverview(data: SettingsOverview): void {
    setPreferences(data.preferences);
    setSelectedCurrency(data.preferences.defaultCurrency);
    setInAppEnabled(data.preferences.notifyInApp);
    setNtfyEnabled(data.preferences.notifyNtfy);
    setSessions(data.sessions);
    setPrivacy(data.privacy);
    setDemoStatus(data.demoStatus);
  }

  const handleReload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSettingsOverview();
      applyOverview(data);
    } catch (err) {
      setError(
        err instanceof SettingsRequestError
          ? err.message
          : 'Could not load settings. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchSettingsOverview()
      .then((data) => {
        if (active) {
          applyOverview(data);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof SettingsRequestError
              ? err.message
              : 'Could not load settings. Please try again.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const hasPreferenceChanges =
    preferences !== null &&
    (selectedCurrency !== preferences.defaultCurrency ||
      inAppEnabled !== preferences.notifyInApp ||
      ntfyEnabled !== preferences.notifyNtfy);

  async function handleSavePreferences(): Promise<void> {
    if (!preferences || saving) return;
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      const updated = await updateOwnerPreferences({
        revision: preferences.revision,
        defaultCurrency: selectedCurrency,
        notifyInApp: inAppEnabled,
        notifyNtfy: ntfyEnabled,
      });
      setPreferences(updated);
      setSelectedCurrency(updated.defaultCurrency);
      setInAppEnabled(updated.notifyInApp);
      setNtfyEnabled(updated.notifyNtfy);
      setSaveSuccess('Preferences saved successfully.');
      setTimeout(() => setSaveSuccess(null), 4000);
    } catch (err) {
      if (err instanceof SettingsRequestError && err.isStale()) {
        setSaveError(err.message);
        // Stale revision: reload fresh settings
        void handleReload();
      } else {
        setSaveError(
          err instanceof SettingsRequestError
            ? err.message
            : 'Could not save preferences. Please try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string): Promise<void> {
    try {
      setSessionActionLoading(sessionId);
      await revokeActiveSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setSaveError(
        err instanceof SettingsRequestError ? err.message : 'Could not revoke session. Try again.',
      );
    } finally {
      setSessionActionLoading(null);
    }
  }

  async function handleRevokeOtherSessions(): Promise<void> {
    try {
      setRevokeAllLoading(true);
      await revokeOtherSessions();
      setSessions((prev) => prev.filter((s) => s.isCurrent));
    } catch (err) {
      setSaveError(
        err instanceof SettingsRequestError
          ? err.message
          : 'Could not revoke other sessions. Try again.',
      );
    } finally {
      setRevokeAllLoading(false);
    }
  }

  async function handleSeedDemo(): Promise<void> {
    try {
      setDemoActionLoading(true);
      setDemoMessage(null);
      const result = await onboardingRequest('demo');
      setDemoStatus((prev) =>
        prev
          ? {
              ...prev,
              demoItemCount: result.demoItemCount,
              genuineItemCount: result.genuineItemCount,
              triedDemo: true,
              removedDemo: false,
            }
          : null,
      );
      setDemoMessage('Sample inventory added. You can explore or remove it anytime.');
      setTimeout(() => setDemoMessage(null), 4000);
    } catch {
      setSaveError('Could not add demo items. Please try again.');
    } finally {
      setDemoActionLoading(false);
    }
  }

  async function handleRemoveDemo(): Promise<void> {
    try {
      setDemoActionLoading(true);
      setDemoMessage(null);
      const result = await onboardingRequest('remove');
      setDemoStatus((prev) =>
        prev
          ? {
              ...prev,
              demoItemCount: result.demoItemCount,
              genuineItemCount: result.genuineItemCount,
              removedDemo: true,
            }
          : null,
      );
      setDemoMessage('Demo inventory removed. Genuine items and taxonomy are unchanged.');
      setTimeout(() => setDemoMessage(null), 4000);
    } catch {
      setSaveError('Could not remove demo items. Please try again.');
    } finally {
      setDemoActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div
        className="space-y-6"
        data-testid="settings-loading"
        role="status"
        aria-label="Loading settings"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4" data-testid="settings-error">
        <Alert variant="destructive">
          <AlertTitle>Unable to load settings</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={() => void handleReload()} variant="outline">
          <RefreshCw aria-hidden="true" className="mr-2 size-4" />
          Try again
        </Button>
      </div>
    );
  }

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-8" data-testid="settings-view">
      {saveSuccess && (
        <Alert className="border-green-600/40 bg-green-500/10 text-green-900 dark:text-green-200">
          <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
          <AlertTitle>Updated</AlertTitle>
          <AlertDescription>{saveSuccess}</AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {demoMessage && (
        <Alert className="border-blue-600/40 bg-blue-500/10 text-blue-900 dark:text-blue-200">
          <CheckCircle2 className="size-4 text-blue-600 dark:text-blue-400" />
          <AlertTitle>Demo Inventory</AlertTitle>
          <AlertDescription>{demoMessage}</AlertDescription>
        </Alert>
      )}

      {/* 1. PREFERENCES */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coins className="size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle>Defaults & Reminders</CardTitle>
          </div>
          <CardDescription>
            Configure your preferred currency and waiting-period notification channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Currency */}
          <div className="space-y-2">
            <Label htmlFor="currency-select">Default currency</Label>
            <p className="text-xs text-muted-foreground">
              Applied to new item and desire entries. Historical purchases and existing goal
              allocations retain their original recorded currencies and are never converted.
            </p>
            <div className="max-w-xs">
              <Select value={selectedCurrency} onValueChange={(val) => setSelectedCurrency(val)}>
                <SelectTrigger id="currency-select" aria-label="Default entry and display currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    Popular
                  </div>
                  {popularCurrencies.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    All ISO Currencies
                  </div>
                  {currencyCodes
                    .filter(
                      (c) => !popularCurrencies.includes(c as (typeof popularCurrencies)[number]),
                    )
                    .map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-medium">Waiting-period notification channels</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              When a waiting period ends, Havefolio notifies you for review. Turning off channels
              safely suppresses pending deliveries and cancels queued jobs.
            </p>

            {/* In-app Notifications */}
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="in-app-switch" className="text-sm font-medium cursor-pointer">
                  In-app review reminders
                </Label>
                <p className="text-xs text-muted-foreground">
                  Show notifications in the Havefolio notification inbox when a waiting period ends.
                </p>
              </div>
              <Switch
                id="in-app-switch"
                checked={inAppEnabled}
                onCheckedChange={setInAppEnabled}
                aria-label="Toggle in-app review reminders"
              />
            </div>

            {/* External Push (ntfy) */}
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="ntfy-switch" className="text-sm font-medium cursor-pointer">
                  Push notifications (ntfy)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Send privacy-preserving review reminders to your configured ntfy server without
                  item names, prices, or private details.
                </p>
              </div>
              <Switch
                id="ntfy-switch"
                checked={ntfyEnabled}
                onCheckedChange={setNtfyEnabled}
                aria-label="Toggle push notifications"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between border-t py-4">
          <p className="text-xs text-muted-foreground">
            Revision {preferences?.revision ?? 1} &bull; Concurrency protected
          </p>
          <Button
            onClick={() => void handleSavePreferences()}
            disabled={!hasPreferenceChanges || saving}
          >
            {saving ? 'Saving...' : 'Save preferences'}
          </Button>
        </CardFooter>
      </Card>

      {/* 2. ACTIVE SESSIONS */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Laptop className="size-5 text-muted-foreground" aria-hidden="true" />
              <CardTitle>Active Sessions</CardTitle>
            </div>
            {otherSessionsCount > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={revokeAllLoading}>
                    <LogOut aria-hidden="true" className="mr-1.5 size-3.5" />
                    Sign out other sessions ({otherSessionsCount})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out of other devices?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will revoke all active sessions except your current device. You will
                      remain signed in here.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleRevokeOtherSessions()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Sign out other devices
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <CardDescription>
            Manage devices currently signed into your private Havefolio installation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border p-3.5"
            >
              <div className="flex items-start gap-3">
                {session.isCurrent ? (
                  <Laptop className="mt-0.5 size-5 text-primary" aria-hidden="true" />
                ) : (
                  <Smartphone className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {session.isCurrent ? 'Current device' : 'Active session'}
                    </span>
                    {session.isCurrent && (
                      <Badge variant="secondary" className="text-xs">
                        This session
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last active: {new Date(session.lastUsedAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created: {new Date(session.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {!session.isCurrent && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={sessionActionLoading === session.id}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      <span className="sr-only">Revoke session</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This device will immediately be signed out and required to enter credentials
                        again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleRevokeSession(session.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Revoke session
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
          {sessions.length === 1 && (
            <p className="text-xs text-muted-foreground pt-1">
              Only this device is currently signed into Havefolio.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 3. DEMO INVENTORY */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Archive className="size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle>Demo Inventory</CardTitle>
          </div>
          <CardDescription>
            Explore sample fictional items or clean them up anytime. Genuine items are never
            affected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">
                {demoStatus && demoStatus.demoItemCount > 0
                  ? `${demoStatus.demoItemCount} sample item${demoStatus.demoItemCount === 1 ? '' : 's'} in inventory`
                  : 'No sample items in inventory'}
              </p>
              <p className="text-xs text-muted-foreground">
                {demoStatus?.genuineItemCount ?? 0} genuine item
                {(demoStatus?.genuineItemCount ?? 0) === 1 ? '' : 's'} recorded.
              </p>
            </div>
            {demoStatus && demoStatus.demoItemCount > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={demoActionLoading}>
                    <Trash2 aria-hidden="true" className="mr-1.5 size-3.5 text-destructive" />
                    Remove demo items
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove all sample items?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove only the marked demo items. Your genuine inventory,
                      categories, and tags remain completely unchanged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleRemoveDemo()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove demo items
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSeedDemo()}
                disabled={demoActionLoading}
              >
                Add demo items
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. PRIVACY & SECURITY */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle>Privacy & Security</CardTitle>
          </div>
          <CardDescription>
            How Havefolio isolates your data, media storage, and deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Registration Lock */}
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-primary" aria-hidden="true" />
                <h4 className="text-sm font-medium">Registration lock</h4>
              </div>
              <Badge
                variant="outline"
                className="border-green-600 text-green-700 dark:text-green-300"
              >
                Locked &bull; Single owner
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {privacy?.registrationLock.reason ??
                'Single owner configured. Additional registrations are blocked.'}
            </p>
          </div>

          {/* Media Storage Explanation */}
          <div className="rounded-lg border p-4 space-y-1.5">
            <h4 className="text-sm font-medium">Private media storage</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {privacy?.storageDescription ??
                'Item photos, receipts, and warranties are securely stored in private authenticated storage folders. Files are not accessible through public Cloudinary URLs or public CDN links.'}
            </p>
          </div>

          {/* Authenticated Proxy Access */}
          <div className="rounded-lg border p-4 space-y-1.5">
            <h4 className="text-sm font-medium">Authenticated session delivery</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {privacy?.accessDescription ??
                'Media is served only through authenticated Havefolio API proxy routes with short-lived session access. Uploads are stripped of unneeded metadata and restricted to your authenticated owner session.'}
            </p>
          </div>

          {/* Zero Public Sharing */}
          <div className="rounded-lg border p-4 space-y-1.5">
            <h4 className="text-sm font-medium">Zero public sharing & no trackers</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {privacy?.sharingDescription ??
                'Havefolio is a personal inventory and decision aid. It has no marketplace, public storefront, public links, discovery feeds, or third-party tracking.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 5. TAXONOMY LINK */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="size-5 text-muted-foreground" aria-hidden="true" />
              <CardTitle>Categories & Tags</CardTitle>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings/taxonomy" className="flex items-center gap-1">
                Manage
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <CardDescription>
            Organise your possessions into categories, subcategories, and tags.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
