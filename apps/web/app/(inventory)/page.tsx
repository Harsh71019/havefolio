import { Onboarding } from '@/components/onboarding';
import type { ReactElement } from 'react';
import { Pill } from '@havefolio/ui/components/kibo-ui/pill';
import { HomeDashboard } from '@/components/home-dashboard';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

// Private data is requested only through the authenticated same-origin API, never in shared RSC data.
export default function HomePage(): ReactElement {
  return (
    <PageShell width="wide">
      <PageHeading
        eyebrow="Home"
        title="Remember what your home already holds."
        description="A quiet summary of what you own, what you have recorded spending on, and what you are still deciding about."
        action={<Pill>Private by default</Pill>}
      />

      <Onboarding />

      <HomeDashboard />
    </PageShell>
  );
}
