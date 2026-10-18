import { Onboarding } from '@/components/onboarding';
import type { ReactElement } from 'react';
import { Pill } from '@havefolio/ui/components/kibo-ui/pill';
import { HomeDashboard } from '@/components/home-dashboard';
import { PageHeading } from '@/components/page-heading';

// Private data is requested only through the authenticated same-origin API, never in shared RSC data.
export default function HomePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="Home"
        title="Remember what your home already holds."
        description="A quiet summary of what you own, what you have recorded spending on, and what you are still deciding about."
        action={<Pill className="self-start">Private by default</Pill>}
      />

      <Onboarding />

      <HomeDashboard />
    </main>
  );
}
