import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#lib/utils';
import { PrivatePhoto, type PrivatePhotoSource } from '#components/havefolio/private-photo';

export type ItemCoverProps = {
  /** The item's current cover, or null when the item has no ready photo. */
  cover: PrivatePhotoSource | null;
  className?: string;
  fit?: 'contain' | 'cover';
  loading?: 'eager' | 'lazy';
  emptyLabel?: string;
  onRetry?: () => void;
};

/**
 * One cover representation for My Store cards, item details and the photo manager. Defaults to a
 * 4:3 box; pass sizing classes (for example `h-full`) to fill an existing media slot instead.
 */
export function ItemCover({
  className,
  cover,
  emptyLabel = 'No cover photo yet',
  fit = 'cover',
  loading = 'lazy',
  onRetry,
}: ItemCoverProps): ReactNode {
  return (
    <div className={cn('relative aspect-[4/3] w-full overflow-hidden bg-muted', className)}>
      {cover ? (
        <PrivatePhoto
          {...cover}
          failedLabel="Cover photo could not load."
          fit={fit}
          loading={loading}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <ImageIcon aria-hidden="true" className="size-7" />
          <span>{emptyLabel}</span>
        </div>
      )}
    </div>
  );
}
