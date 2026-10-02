'use client';

import { ImageOffIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '#components/button';
import { Skeleton } from '#components/skeleton';
import { cn } from '#lib/utils';

export type PrivatePhotoSource = {
  /** Same-origin authenticated application URL; never a provider URL. */
  src: string;
  srcSet?: string;
  sizes?: string;
  /** Small variant shown until `src` loads (for large views only). */
  placeholderSrc?: string;
  alt: string;
  width: number;
  height: number;
};

export type PrivatePhotoProps = PrivatePhotoSource & {
  className?: string;
  fit?: 'contain' | 'cover';
  loading?: 'eager' | 'lazy';
  /** Visible, owner-facing description of what failed to load. */
  failedLabel?: string;
  onRetry?: () => void;
  onFailure?: () => void;
  /** Set false in dense grids so many failures do not each interrupt assistive technology. */
  announceFailure?: boolean;
};

/**
 * Fills its positioned parent. Explicit dimensions preserve aspect ratio, so loading never shifts
 * layout. A failed load is replaced by readable text and an optional retry action.
 */
export function PrivatePhoto({
  alt,
  announceFailure = true,
  className,
  failedLabel = 'Photo could not load.',
  fit = 'contain',
  height,
  loading = 'lazy',
  onFailure,
  onRetry,
  placeholderSrc,
  sizes,
  src,
  srcSet,
  width,
}: PrivatePhotoProps): ReactNode {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const current = image.current;
    setStatus(current?.complete && current.naturalWidth > 0 ? 'loaded' : 'loading');
  }, [src, srcSet]);
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain';
  if (status === 'failed')
    return (
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-3 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        <ImageOffIcon aria-hidden="true" className="size-6" />
        <p {...(announceFailure ? { role: 'alert' } : {})}>{failedLabel}</p>
        {onRetry ? (
          <Button className="min-h-11" onClick={onRetry} size="sm" type="button" variant="outline">
            <RotateCcwIcon aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </div>
    );
  return (
    <div className={cn('absolute inset-0 bg-muted', className)}>
      {status === 'loading' && placeholderSrc ? (
        <img
          alt=""
          aria-hidden="true"
          className={cn('absolute inset-0 h-full w-full blur-sm', objectFit)}
          decoding="async"
          height={height}
          src={placeholderSrc}
          width={width}
        />
      ) : null}
      {status === 'loading' && !placeholderSrc ? (
        <Skeleton
          aria-hidden="true"
          className="absolute inset-0 rounded-none motion-reduce:animate-none"
        />
      ) : null}
      {/* Plain img: private bytes must never enter the shared Next.js optimizer cache. */}
      <img
        alt={alt}
        className={cn(
          'absolute inset-0 h-full w-full transition-opacity motion-reduce:transition-none',
          objectFit,
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
        )}
        decoding="async"
        height={height}
        loading={loading}
        onError={() => {
          setStatus('failed');
          onFailure?.();
        }}
        onLoad={() => setStatus('loaded')}
        ref={image}
        referrerPolicy="no-referrer"
        src={src}
        width={width}
        {...(srcSet ? { srcSet } : {})}
        {...(sizes ? { sizes } : {})}
      />
    </div>
  );
}
