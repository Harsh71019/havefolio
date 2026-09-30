import type { ReactElement, ReactNode } from 'react';

export function PageHeading({
  action,
  description,
  eyebrow,
  title,
}: Readonly<{
  action?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}>): ReactElement {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
