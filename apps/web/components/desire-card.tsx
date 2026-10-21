'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import type { Desire } from '@havefolio/contracts';
import { Card, CardContent } from '@havefolio/ui/components/card';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@havefolio/ui/components/alert-dialog';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
import { Boxes, Clock, ExternalLink, Pencil, Scale, Target, Trash2 } from 'lucide-react';
import {
  deleteDesire,
  desirePhotoSource,
  classificationInfo,
  DesireRequestError,
} from './desires-client';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  getEffectiveStateLabel,
} from './desire-presentation';

export function DesireCard({
  desire,
  onDeleted,
}: {
  desire: Desire;
  onDeleted: (id: string) => void;
}): ReactElement {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const priceFormatted = formatLikelyPrice(desire.likelyPriceMinor, desire.currency);
  const reviewFormatted = formatReviewDateTime(desire.reviewAt);
  const effectiveLabel = getEffectiveStateLabel(desire.effectiveState);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDesire(desire.id, desire.revision);
      setDeleteOpen(false);
      onDeleted(desire.id);
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setDeleteError(err.message);
      } else {
        setDeleteError('Could not delete desire. Try again.');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="overflow-hidden transition-colors hover:border-foreground/20">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
            {/* Optional Thumbnail */}
            {desire.photo ? (
              <div className="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                <PrivatePhoto
                  {...desirePhotoSource(
                    desire.id,
                    desire.photo,
                    desire.name,
                    '(max-width: 640px) 64px, 80px',
                  )}
                  fit="cover"
                />
              </div>
            ) : null}

            {/* Content */}
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="font-semibold text-base sm:text-lg leading-snug wrap-anywhere">
                  {desire.name}
                </h2>
              </div>

              {/* Badges / metadata */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {desire.classification ? (
                  <Badge variant="secondary" className="font-normal">
                    {classificationInfo[desire.classification].label}
                  </Badge>
                ) : null}

                <Badge
                  variant={desire.effectiveState === 'ready_for_review' ? 'default' : 'outline'}
                  className="font-normal"
                >
                  {effectiveLabel}
                </Badge>

                <span className="text-muted-foreground">•</span>

                <span className="font-medium text-foreground">{priceFormatted}</span>
              </div>

              {/* Waiting review info */}
              {desire.effectiveState === 'waiting' && reviewFormatted ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                  <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Review: {reviewFormatted}</span>
                </div>
              ) : null}

              {/* Reason excerpt */}
              {desire.reason ? (
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 pt-1 wrap-anywhere">
                  {desire.reason}
                </p>
              ) : null}

              {/* Product URL */}
              {desire.productUrl ? (
                <div className="pt-1">
                  <a
                    href={desire.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 min-h-11 sm:min-h-0"
                    aria-label={`Visit product link for ${desire.name} (opens in new tab)`}
                  >
                    <ExternalLink className="size-3" aria-hidden="true" />
                    <span>Product link</span>
                  </a>
                </div>
              ) : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1 self-end pt-2 xl:shrink-0 xl:self-start xl:pt-0">
            <Button asChild variant="outline" size="sm" className="min-h-11 px-3">
              <Link href={`/wants/${desire.id}/compare`}>
                <Scale className="mr-1.5 size-3.5" aria-hidden="true" />
                Compare
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11 px-3">
              <Link href={`/wants/${desire.id}/matches`}>
                <Boxes className="mr-1.5 size-3.5" aria-hidden="true" />
                Matches
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11 px-3">
              <Link href={`/wants/${desire.id}/goals`}>
                <Target className="mr-1.5 size-3.5" aria-hidden="true" />
                Goals
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11">
              <Link href={`/wants/${desire.id}/history`}>Decision history</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="min-h-11 px-3">
              <Link href={`/wants/${desire.id}/edit`}>
                <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                Edit
              </Link>
            </Button>

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 px-3 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${desire.name}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete desire?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove “{desire.name}” and its decision history and
                    private photo from your household index. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {deleteError ? <p className="text-xs text-destructive">{deleteError}</p> : null}
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-11" disabled={isDeleting}>
                    Keep desire
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(e) => {
                      e.preventDefault();
                      void handleDelete();
                    }}
                    disabled={isDeleting}
                  >
                    {isDeleting ? 'Deleting...' : 'Delete desire'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
