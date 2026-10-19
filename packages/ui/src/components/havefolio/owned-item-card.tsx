import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Pill } from '#components/kibo-ui/pill';
import { cn } from '#lib/utils';

export type OwnedItemCardProps = {
  /** Prefix for element ids so a wrapping link can reference the name and status. */
  idPrefix: string;
  name: string;
  status: string;
  statusIcon?: ReactNode;
  /** Extra screen-reader wording for the status, for example ", no longer owned". */
  statusNote?: string;
  /** Show the status as a badge over the photo; otherwise it is only announced. */
  showStatus?: boolean;
  /** No longer owned: the badge uses the outline style. */
  inactive?: boolean;
  media?: ReactNode;
  className?: string;
};

/**
 * PER-67: a catalog tile — a large square photo with the item name beneath it. Prices, dates and
 * other facts belong on the item page, so the grid stays easy to scan.
 */
export function OwnedItemCard({
  className,
  idPrefix,
  inactive = false,
  media,
  name,
  showStatus = false,
  status,
  statusIcon,
  statusNote,
}: OwnedItemCardProps): ReactNode {
  return (
    <div data-slot="owned-item-card" className={cn('group/card flex h-full flex-col', className)}>
      <div
        data-slot="owned-item-media"
        className="relative aspect-square overflow-hidden rounded-lg bg-muted text-muted-foreground"
      >
        {media ?? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
            <ImageIcon aria-hidden="true" className="size-7" />
            <span className="text-foreground">No photo yet</span>
          </div>
        )}
        <Pill
          id={`${idPrefix}-status`}
          className={cn(
            'absolute bottom-2 left-2 bg-background/90 shadow-sm backdrop-blur-sm [&_svg]:size-3.5',
            !showStatus && 'sr-only',
          )}
          variant={inactive ? 'outline' : 'secondary'}
        >
          {statusIcon}
          {status}
          {statusNote ? <span className="sr-only">{statusNote}</span> : null}
        </Pill>
      </div>
      <p
        id={`${idPrefix}-name`}
        data-slot="owned-item-name"
        className="mt-2.5 line-clamp-2 px-0.5 text-sm leading-snug font-medium break-words group-hover/card:underline group-hover/card:underline-offset-2"
      >
        {name}
      </p>
    </div>
  );
}
