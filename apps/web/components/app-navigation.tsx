'use client';

import { Archive, Heart, House, LockKeyhole, Target } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';
import { cn } from '@havefolio/ui/lib/utils';

const navigationItems = [
  { href: '/', icon: House, label: 'Home' },
  { href: '/store', icon: Archive, label: 'My Store' },
  { href: '/wants', icon: Heart, label: 'Wants' },
  { href: '/goals', icon: Target, label: 'Goals' },
] as const;

export function AppNavigation(): ReactElement {
  const pathname = usePathname();

  return (
    <>
      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-card/90 px-5 py-6 backdrop-blur md:flex">
        <Link className="flex min-h-12 items-center gap-3 rounded-lg px-2" href="/">
          <span className="grid size-10 place-items-center rounded-xl bg-primary font-display text-xl text-primary-foreground">
            H
          </span>
          <span>
            <span className="block font-display text-2xl leading-none">Havefolio</span>
            <span className="mt-1 block text-xs text-muted-foreground">Your household index</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="mt-10 grid gap-2">
          {navigationItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;

            return (
              <Button
                key={item.href}
                asChild
                className="h-12 justify-start gap-3 px-3 text-base"
                variant={active ? 'secondary' : 'ghost'}
              >
                <Link aria-current={active ? 'page' : undefined} href={item.href}>
                  <Icon aria-hidden="true" className="size-5" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>

        <div className="mt-auto flex items-start gap-2 rounded-xl border bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>Your inventory stays private. Havefolio has no marketplace or public storefront.</p>
        </div>
      </aside>

      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 rounded-2xl border bg-card/95 p-1.5 shadow-lg backdrop-blur md:hidden"
      >
        {navigationItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[0.6875rem] font-semibold text-muted-foreground transition-colors',
                active && 'bg-secondary text-secondary-foreground',
              )}
              href={item.href}
            >
              <Icon aria-hidden="true" className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
