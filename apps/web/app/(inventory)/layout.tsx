import type { ReactElement, ReactNode } from 'react';
import { AppNavigation } from '@/components/app-navigation';
import { ThemeToggle } from '@/components/theme-toggle';

export default function InventoryLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <div className="min-h-svh md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      <AppNavigation />
      <div className="min-w-0">
        <div className="flex h-14 items-center justify-end border-b px-4 sm:px-6">
          <ThemeToggle />
        </div>
        <div className="pb-24 md:pb-0">{children}</div>
      </div>
    </div>
  );
}
