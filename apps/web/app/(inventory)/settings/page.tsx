import { PrivacyControls } from '@/components/privacy-controls';
import type { ReactElement } from 'react';
import type { Metadata } from 'next';
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
      <SettingsView />
      <PrivacyControls />
    </main>
  );
}
