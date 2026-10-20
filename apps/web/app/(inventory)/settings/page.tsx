import { PrivacyControls } from '@/components/privacy-controls';
import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@havefolio/ui/components/button';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { SettingsView } from '@/components/settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage(): ReactElement {
  return (
    <PageShell width="content">
      <PageHeading
        title="Settings"
        description="Manage your defaults, notification channels, sessions and private deployment."
      />
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
      <PrivacyControls />
    </PageShell>
  );
}
