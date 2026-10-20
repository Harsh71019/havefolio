import type { ComponentProps, ReactElement } from 'react';
import { cn } from '@havefolio/ui/lib/utils';

/**
 * PER-75: the one horizontal gutter between the content column and the left rail. The inventory
 * header uses it too, so the search field starts on the same rail as each page heading.
 */
export const pageGutterClassName = 'px-4 sm:px-6 lg:px-8';

/**
 * PER-75: rail widths. Every rail is pinned to the left gutter and never centred, so the heading
 * and principal content of every inventory page start at the same x within the content column.
 * - form: readable single-column forms and step flows (672 px)
 * - content: detail, timeline and management pages (896 px)
 * - wide: dashboards, catalogues and multi-column comparisons (1280 px)
 * - full: My Store, whose auto-fill grid adds columns as the sidebar collapses (PER-66)
 */
export const pageWidths = {
  form: 'max-w-2xl',
  content: 'max-w-4xl',
  wide: 'max-w-7xl',
  full: 'max-w-[112rem]',
} as const;

export type PageWidth = keyof typeof pageWidths;

/** Owns the page's <main> landmark; the layout's #main-content wrapper keeps the skip target. */
export function PageShell({
  width,
  className,
  children,
  ...props
}: Readonly<ComponentProps<'main'> & { width: PageWidth }>): ReactElement {
  return (
    <main
      data-page-shell={width}
      className={cn('w-full py-6 sm:py-8', pageGutterClassName)}
      {...props}
    >
      <div data-page-rail="" className={cn('w-full space-y-6', pageWidths[width], className)}>
        {children}
      </div>
    </main>
  );
}
