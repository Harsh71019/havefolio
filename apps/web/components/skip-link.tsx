import type { ReactElement } from 'react';

export const mainContentId = 'main-content';

/** First focusable control on every page; bypasses repeated navigation (WCAG 2.4.1). */
export function SkipLink(): ReactElement {
  return (
    <a
      href={`#${mainContentId}`}
      className="sr-only rounded-md border bg-background px-4 py-3 text-sm font-medium text-foreground shadow-sm focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      Skip to main content
    </a>
  );
}
