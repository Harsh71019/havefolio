import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MerchantManagement } from '@/components/merchant-management';

export const metadata: Metadata = { title: 'Purchase merchants' };

export default function MerchantsPage(): ReactElement {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <Link href="/settings" className="inline-flex min-h-11 items-center text-sm underline">
          Back to Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Purchase merchants</h1>
        <p className="text-muted-foreground">
          Save any online or offline seller. Your merchants stay private and are available when
          adding or editing items.
        </p>
      </header>
      <MerchantManagement />
    </main>
  );
}
