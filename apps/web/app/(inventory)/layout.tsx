import type { ReactElement, ReactNode } from 'react';
import { AppNavigation } from '@/components/app-navigation';
import { HeaderSearch } from '@/components/header-search';
import { pageGutterClassName } from '@/components/page-shell';
import { RouteFocusManager } from '@/components/route-focus-manager';
import { mainContentId, SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';

export default function InventoryLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <div className="min-h-svh md:grid md:grid-cols-[auto_minmax(0,1fr)]">
      <SkipLink />
      <RouteFocusManager />
      <AppNavigation />
      {/* PER-85: page overflow is clipped on phones so it cannot widen the layout viewport, which
          zooms out and moves the fixed bottom navigation. */}
      <div className="min-w-0 max-md:overflow-x-clip">
        {/* PER-75: the header shares the page gutter so search starts on the content rail. */}
        <div className={`flex h-14 items-center gap-3 border-b ${pageGutterClassName}`}>
          <HeaderSearch />
          <div className="ml-auto shrink-0">
            <ThemeToggle />
          </div>
        </div>
        <div
          id={mainContentId}
          tabIndex={-1}
          className="pb-(--mobile-nav-clearance) outline-none md:pb-0"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
