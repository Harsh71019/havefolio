import { ArrowRight, Archive, Heart, ShieldCheck, Target } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Pill } from '@havefolio/ui/components/kibo-ui/pill';
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
        action={<Pill className="self-start">Private by default</Pill>}
      />

      <section aria-labelledby="collections-title" className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Your collections</p>
            <h2 id="collections-title" className="mt-1 text-2xl font-semibold tracking-tight">
              A shelf, not a sales floor
            </h2>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:block">Foundation preview</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {collections.map((collection) => {
            const Icon = collection.icon;

            return (
              <Card key={collection.href}>
                <CardHeader>
                  <Icon aria-hidden="true" className="size-5" />
                  <CardTitle>{collection.label}</CardTitle>
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-5" />
            No checkout. No urgency tricks.
          </CardTitle>
          <CardDescription>
            This interface is designed for remembering, comparing and deciding—not for pushing a
            purchase.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
