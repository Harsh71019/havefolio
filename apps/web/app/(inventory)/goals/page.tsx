import { PlusCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { GoalsList } from '@/components/goals-list';
import { PageHeading } from '@/components/page-heading';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = { title: 'Goals' };

export default function GoalsPage(): ReactElement {
  return (
    <PageShell width="wide">
      <PageHeading
        eyebrow="Goals"
        title="Keep the other possibility in view."
        description="Progress counts only the contributions you confirm. Estimates from wants you decide against stay separate until you explicitly allocate them."
        action={
          <Button asChild className="min-h-11">
            <Link href="/goals/new">
              <PlusCircle className="mr-2 size-4" aria-hidden="true" />
              New goal
            </Link>
          </Button>
        }
      />
      <section aria-label="Goals">
        <GoalsList />
      </section>
    </PageShell>
  );
}
