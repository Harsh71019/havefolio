import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '#components/card';
import { Pill } from '#components/kibo-ui/pill';
import { cn } from '#lib/utils';

export type OwnedItemFact = { label: string; value: string; muted?: boolean };

export type OwnedItemCardProps = {
  /** Prefix for element ids so a wrapping link can reference the name, status, context and facts. */
  idPrefix: string;
  name: string;
  /** Category context, for example "Kitchen › Appliances". */
  context?: string;
  status: string;
  statusIcon?: ReactNode;
  /** Extra screen-reader wording for the status, for example ", no longer owned". */
  statusNote?: string;
  /** No longer owned: shown with text and outline status pill, in full color. */
  inactive?: boolean;
  facts: OwnedItemFact[];
  media?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function OwnedItemCard({
  className,
  context,
  facts,
  footer,
  idPrefix,
  inactive = false,
  media,
  name,
  status,
  statusIcon,
  statusNote,
}: OwnedItemCardProps): ReactNode {
  return (
    <Card className={cn('h-full gap-0 overflow-hidden py-0', className)}>
      <div
        data-slot="owned-item-media"
        className="relative aspect-[4/3] bg-muted text-muted-foreground"
      >
        {media ?? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
            <ImageIcon aria-hidden="true" className="size-7" />
            <span className="text-foreground">No photo yet</span>
          </div>
        )}
      </div>
      <CardHeader className="grid-cols-[minmax(0,1fr)] gap-2 px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {context ? (
            <span
              id={`${idPrefix}-context`}
              className="min-w-0 truncate text-xs font-medium text-muted-foreground"
            >
              {context}
            </span>
          ) : null}
          <Pill
            id={`${idPrefix}-status`}
            className="shrink-0 [&_svg]:size-3.5"
            variant={inactive ? 'outline' : 'secondary'}
          >
            {statusIcon}
            {status}
            {statusNote ? <span className="sr-only">{statusNote}</span> : null}
          </Pill>
        </div>
        <CardTitle id={`${idPrefix}-name`} className="leading-snug break-words">
          {name}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-sm">
        <dl id={`${idPrefix}-facts`} className="divide-y">
          {facts.map((fact) => (
            <div
              key={fact.label}
              data-slot="owned-item-fact"
              className="flex items-baseline justify-between gap-3 py-1.5"
            >
              <dt className="shrink-0 text-xs text-muted-foreground">{fact.label}</dt>
              <dd
                className={cn(
                  'min-w-0 break-words text-right',
                  fact.muted ? 'text-muted-foreground italic' : 'font-medium',
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
      {footer ? (
        <div data-slot="owned-item-footer" className="mt-auto border-t px-4 py-3">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
