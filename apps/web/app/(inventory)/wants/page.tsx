import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';
import { DesiresList } from '@/components/desires-list';

export const metadata: Metadata = {
  title: 'Wants',
  description: 'Make room between wanting and buying. Reflect on what you are considering.',
};

export default function WantsPage(): ReactElement {
  return (
    <PageShell width="wide">
      <PageHeading
        eyebrow="Wants"
        title="Make room between wanting and buying."
        description="Capture what you are considering and give yourself breathing room to reflect before deciding."
      />
      <section aria-label="Desires list">
        <DesiresList />
      </section>
    </PageShell>
  );
}
