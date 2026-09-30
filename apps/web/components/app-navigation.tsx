'use client';

import { Archive, Heart, House, LockKeyhole, Target } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement } from 'react';
import { Button } from '@havefolio/ui/components/button';

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
      <aside className="sticky top-0 hidden h-svh flex-col border-r bg-background px-5 py-6 md:flex">
        <Link className="flex min-h-12 items-center gap-3 px-2" href="/">
          <House aria-hidden="true" className="size-5" />
          <span>
            <span className="block text-lg font-semibold leading-none">Havefolio</span>
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

        <div className="mt-auto flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>Your inventory stays private. Havefolio has no marketplace or public storefront.</p>
        </div>
      </aside>

      <nav
        aria-label="Primary"
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 rounded-lg border bg-background p-1.5 shadow-sm md:hidden"
      >
        {navigationItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Button
              key={item.href}
              asChild
              className="h-14 flex-col gap-1 px-1 text-xs"
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
    </>
  );
}
