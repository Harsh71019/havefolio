import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { SettingsView } from '@/components/settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage(): ReactElement {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="text-muted-foreground">
          Manage your defaults, notification channels, sessions and private deployment.
        </p>
      </header>
      <section
        aria-labelledby="merchant-settings-title"
        className="space-y-3 rounded-lg border p-6"
      >
        <h2 id="merchant-settings-title" className="text-lg font-semibold">
          Purchase merchants
        </h2>
        <p className="text-sm text-muted-foreground">
          Add Myntra, a local shop, or any seller you buy from. Saved merchants are available when
          adding or editing items.
        </p>
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/settings/merchants">Manage merchants</Link>
        </Button>
      </section>
      <SettingsView />
    </main>
  );
}
