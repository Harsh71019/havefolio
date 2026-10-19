import type { Metadata } from 'next';
import { MerchantSpending } from '@/components/merchant-spending';
import { PageHeading } from '@/components/page-heading';
import { SpendingInsights } from '@/components/spending-insights';
export const metadata: Metadata = { title: 'Spending insights' };

// Private data is requested only through the authenticated same-origin API, never in shared RSC data.
export default function InsightsPage(): React.JSX.Element {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="Insights"
        title="Recorded spending"
        description="Understand the purchases you have recorded, in their original currencies."
      />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Figures represent recorded purchase spending, not current or resale values. Confirmed
        refunds reduce net recorded spending. Currencies remain separate. Unknown amounts are
        excluded from money totals. Demo items are excluded.
      </p>
      <MerchantSpending />
      <SpendingInsights />
    </main>
  );
}
