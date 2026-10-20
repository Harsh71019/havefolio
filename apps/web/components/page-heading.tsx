import type { ReactElement, ReactNode } from 'react';
import { cn } from '@havefolio/ui/lib/utils';

/** PER-75: the single page-title style, also used by flows that render their own h1. */
export const pageTitleClassName = 'text-2xl font-semibold tracking-tight text-balance sm:text-3xl';

/**
 * PER-75: compact page heading. Actions sit beside the title when they fit and wrap below it
 * otherwise, so a short title keeps its action on one line even on a phone.
 */
export function PageHeading({
  action,
  description,
  eyebrow,
  title,
}: Readonly<{
  action?: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}>): ReactElement {
  return (
    <header
      className={cn(
        'flex flex-wrap justify-between gap-x-6 gap-y-4',
        description ? 'items-end' : 'items-center',
      )}
    >
      <div className="max-w-2xl min-w-0 grow">
        {eyebrow ? <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h1 className={cn(pageTitleClassName, eyebrow && 'mt-1')}>{title}</h1>
        {description ? (
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}
