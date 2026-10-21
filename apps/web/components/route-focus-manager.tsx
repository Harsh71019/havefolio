'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { usePathname } from 'next/navigation';
import { mainContentId } from './skip-link';
import {
  peekReturnFocusItem,
  takeReturnFocusDesire,
  takeReturnFocusGoal,
  takeReturnFocusItem,
} from './navigation-context';

/**
 * PER-90: Manages accessible focus and starting scroll position on route transitions.
 * - On forward route changes: resets window scroll to (0, 0) and moves focus to #main-content
 *   so screen readers announce the new page and keyboard users begin at page content.
 * - On history navigation (popstate) or when a pending return focus is present: preserves
 *   scroll position and allows history / component-level focus recovery without forced focus.
 * - Only runs on actual route (pathname) changes, never on re-renders or in-page query changes.
 */
export function RouteFocusManager(): ReactElement | null {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);
  const isPopstate = useRef(false);

  useEffect(() => {
    const onPopstate = (): void => {
      isPopstate.current = true;
    };
    window.addEventListener('popstate', onPopstate);
    return () => window.removeEventListener('popstate', onPopstate);
  }, []);

  useEffect(() => {
    if (!pathname) return;

    // Do not run on initial mount (allow SSR / browser initial paint)
    if (previousPathname.current === null) {
      previousPathname.current = pathname;
      return;
    }

    const pathChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;

    if (!pathChanged) return;

    const wasHistoryNav = isPopstate.current;
    isPopstate.current = false;

    // Ephemeral focus recovery keys are scoped to returning from details to list.
    // If navigating to an unrelated section, discard stale keys.
    if (!pathname.startsWith('/items/') && pathname !== '/store') {
      takeReturnFocusItem();
    }
    if (!pathname.startsWith('/goals/') && pathname !== '/goals') {
      takeReturnFocusGoal();
    }
    if (!pathname.startsWith('/wants/') && pathname !== '/wants') {
      takeReturnFocusDesire();
    }

    // If returning via browser back/forward, do not override scroll/focus
    if (wasHistoryNav) return;

    // If returning to My Store with a pending item focus recovery, do not force focus to top
    if (pathname === '/store' && peekReturnFocusItem()) return;

    // Forward route navigation:
    // 1. Reset window scroll to (0, 0) so the owner is not stranded mid-page
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    // 2. Set accessible focus to the main content container (#main-content)
    const mainContent = document.getElementById(mainContentId);
    if (mainContent) {
      mainContent.focus({ preventScroll: true });
    }
  }, [pathname]);

  return null;
}
