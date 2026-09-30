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
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-[-0.035em] text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
