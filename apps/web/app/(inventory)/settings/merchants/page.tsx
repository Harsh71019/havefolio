import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MerchantManagement } from '@/components/merchant-management';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'Purchase merchants' };

export default function MerchantsPage(): ReactElement {
  return (
    <PageShell width="content">
      <Link href="/settings" className="inline-flex min-h-11 items-center text-sm underline">
        Back to Settings
      </Link>
      <PageHeading
        title="Purchase merchants"
        description="Save any online or offline seller. Your merchants stay private and are available when adding or editing items."
      />
      <MerchantManagement />
    </PageShell>
  );
}
