import { ArrowRight, Archive, Heart, ShieldCheck, Target } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Pill, PillIndicator } from '@havefolio/ui/components/kibo-ui/pill';
import { PageHeading } from '@/components/page-heading';

const collections = [
  {
    description: 'A calm, searchable catalogue of the things already under your roof.',
    href: '/store',
    icon: Archive,
    label: 'My Store',
  },
  {
    description: 'Give a possible purchase time, context and an honest reason to exist.',
    href: '/wants',
    icon: Heart,
    label: 'Wants',
  },
  {
    description: 'Keep meaningful alternatives visible without pretending money moved itself.',
    href: '/goals',
    icon: Target,
    label: 'Goals',
  },
] as const;

export default function HomePage(): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <PageHeading
        eyebrow="Household index"
        title="Remember what your home already holds."
        description="Havefolio keeps possessions, spending and future purchases in one private place—so the useful thing you need may already be yours."
        action={
          <Pill className="self-start" variant="outline">
            <PillIndicator variant="success" />
            Private by default
          </Pill>
        }
      />

      <section aria-labelledby="collections-title" className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-primary">Your collections</p>
            <h2 id="collections-title" className="mt-1 font-display text-2xl font-medium">
              A shelf, not a sales floor
            </h2>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:block">Foundation preview</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {collections.map((collection) => {
            const Icon = collection.icon;

            return (
              <Card key={collection.href} className="shadow-none">
                <CardHeader>
                  <div className="mb-2 grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <CardTitle className="font-display text-2xl font-medium">
                    {collection.label}
                  </CardTitle>
                  <CardDescription className="leading-6">{collection.description}</CardDescription>
                </CardHeader>
                <CardFooter className="mt-auto">
                  <Button asChild className="w-full justify-between" variant="outline">
                    <Link href={collection.href}>
                      Open {collection.label}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="mt-6 overflow-hidden border-primary/20 bg-primary text-primary-foreground shadow-none">
        <CardContent className="grid gap-5 px-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary-foreground/10">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-medium">No checkout. No urgency tricks.</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-primary-foreground/75">
              This interface is designed for remembering, comparing and deciding—not for pushing a
              purchase.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
