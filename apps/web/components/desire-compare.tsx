'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import Link from 'next/link';
import type {
  CreateReviewRequest,
  Desire,
  DesireMatch,
  ItemListEntry,
  ItemResponse,
  ReviewEvent,
  ReviewHistoryPage,
  ReviewOutcome,
} from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader } from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Textarea } from '@havefolio/ui/components/textarea';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  classificationInfo,
  DesireRequestError,
  desirePhotoSource,
  getDesire,
  getDesireMatches,
  readReviews,
  recordReview,
  reviewItems,
  waitingPresets,
  type WaitingPresetKey,
} from './desires-client';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  getEffectiveStateLabel,
} from './desire-presentation';
import { readItem } from './items-client';
import { photoSource } from './photos-client';
import {
  decisionActions,
  DIFFERENTIATION_HINT,
  DIFFERENTIATION_PROMPT,
  formatMatchedItem,
  NEUTRAL_COMPARISON_GUIDANCE,
  type DecisionActionType,
  type FormattedMatchedItem,
} from './desire-compare-presentation';

const errorMessage = (error: unknown): string => {
  if (error instanceof DesireRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Could not record your decision. Please try again.';
};

export function DesireCompare({ desireId }: { desireId: string }): ReactElement {
  const componentId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const pendingCommandRef = useRef<CreateReviewRequest | null>(null);

  // Core data states
  const [desire, setDesire] = useState<Desire | null>(null);
  const [matches, setMatches] = useState<DesireMatch[]>([]);
  const [itemsMap, setItemsMap] = useState<Map<string, ItemResponse | null>>(new Map());
  const [reviewPage, setReviewPage] = useState<ReviewHistoryPage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form states
  const [selectedAction, setSelectedAction] = useState<DecisionActionType>('use_owned');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [differentNote, setDifferentNote] = useState<string>('');
  const [waitPreset, setWaitPreset] = useState<WaitingPresetKey>('7d');
  const [customReviewDate, setCustomReviewDate] = useState<string>('');

  // Other inventory items state (for fallback or selecting an owned item not yet in matches)
  const [otherItems, setOtherItems] = useState<ItemListEntry[]>([]);
  const [hasLoadedOtherItems, setHasLoadedOtherItems] = useState(false);
  const [isLoadingOtherItems, setIsLoadingOtherItems] = useState(false);

  // Submission & feedback states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recordedEvent, setRecordedEvent] = useState<ReviewEvent | null>(null);
  const [isUncertainRetry, setIsUncertainRetry] = useState(false);
  const [announcement, setAnnouncement] = useState<string>('');

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      const [desireData, matchesData, reviewsData] = await Promise.all([
        getDesire(desireId, signal),
        getDesireMatches(desireId, { limit: 50, signal }),
        readReviews(desireId, undefined, signal),
      ]);

      const itemResults = await Promise.allSettled(
        matchesData.items.map((m) => readItem(m.itemId)),
      );

      const newItemsMap = new Map<string, ItemResponse | null>();
      matchesData.items.forEach((m, idx) => {
        const res = itemResults[idx];
        if (res && res.status === 'fulfilled') {
          newItemsMap.set(m.itemId, res.value);
        } else {
          newItemsMap.set(m.itemId, null);
        }
      });

      setDesire(desireData);
      setMatches(matchesData.items);
      setItemsMap(newItemsMap);
      setReviewPage(reviewsData);

      const firstUsable = matchesData.items.find(
        (m) => m.relevance === 'relevant' && m.item.isUsableAlternative,
      );
      if (firstUsable) {
        setSelectedItemId(firstUsable.itemId);
      } else if (matchesData.items.length > 0) {
        const first = matchesData.items[0];
        if (first) {
          setSelectedItemId(first.itemId);
        }
      }

      const defaultPreset = waitingPresets.find((p) => p.key === '7d');
      const defaultWait = defaultPreset?.deriveReviewAt() ?? '';
      if (defaultWait) {
        const localIso = new Date(defaultWait).toISOString().slice(0, 16);
        setCustomReviewDate(localIso);
      }

      setAnnouncement(`Loaded desire comparison for ${desireData.name}.`);
    },
    [desireId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getDesire(desireId, controller.signal),
      getDesireMatches(desireId, { limit: 50, signal: controller.signal }),
      readReviews(desireId, undefined, controller.signal),
    ])
      .then(async ([desireData, matchesData, reviewsData]) => {
        if (controller.signal.aborted) return;
        const itemResults = await Promise.allSettled(
          matchesData.items.map((m) => readItem(m.itemId)),
        );
        if (controller.signal.aborted) return;

        const newItemsMap = new Map<string, ItemResponse | null>();
        matchesData.items.forEach((m, idx) => {
          const res = itemResults[idx];
          if (res && res.status === 'fulfilled') {
            newItemsMap.set(m.itemId, res.value);
          } else {
            newItemsMap.set(m.itemId, null);
          }
        });

        setDesire(desireData);
        setMatches(matchesData.items);
        setItemsMap(newItemsMap);
        setReviewPage(reviewsData);

        const firstUsable = matchesData.items.find(
          (m) => m.relevance === 'relevant' && m.item.isUsableAlternative,
        );
        if (firstUsable) {
          setSelectedItemId(firstUsable.itemId);
        } else if (matchesData.items.length > 0) {
          const first = matchesData.items[0];
          if (first) {
            setSelectedItemId(first.itemId);
          }
        }

        const defaultPreset = waitingPresets.find((p) => p.key === '7d');
        const defaultWait = defaultPreset?.deriveReviewAt() ?? '';
        if (defaultWait) {
          const localIso = new Date(defaultWait).toISOString().slice(0, 16);
          setCustomReviewDate(localIso);
        }

        setAnnouncement(`Loaded desire comparison for ${desireData.name}.`);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [desireId]);

  // Load other inventory items on demand when user wants to use something from inventory
  const handleLoadOtherItems = async (): Promise<void> => {
    if (hasLoadedOtherItems || isLoadingOtherItems) return;
    setIsLoadingOtherItems(true);
    try {
      const page = await reviewItems();
      setOtherItems(page.items);
      setHasLoadedOtherItems(true);
    } catch {
      // non-blocking
    } finally {
      setIsLoadingOtherItems(false);
    }
  };

  // Format matched items
  const formattedMatches: FormattedMatchedItem[] = matches.map((m) =>
    formatMatchedItem(m, itemsMap.get(m.itemId) ?? null),
  );

  const usableMatches = formattedMatches.filter((m) => m.isUsableAlternative);

  // Handle Action submission
  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!desire || isSubmitting) return;

    setSubmitError(null);
    setRecordedEvent(null);

    // If not retrying an uncertain ambiguous request, build a fresh command with a new UUID
    if (!isUncertainRetry || !pendingCommandRef.current) {
      let outcome: ReviewOutcome;
      let linkedItemId: string | undefined = undefined;
      let reviewAt: string | undefined = undefined;
      let noteContent = differentNote.trim();

      switch (selectedAction) {
        case 'use_owned': {
          outcome = 'used_owned';
          if (!selectedItemId) {
            setSubmitError('Select an owned possession you plan to use.');
            return;
          }
          linkedItemId = selectedItemId;
          break;
        }
        case 'repair': {
          outcome = 'used_owned';
          if (!selectedItemId) {
            setSubmitError('Select the owned item you plan to repair.');
            return;
          }
          linkedItemId = selectedItemId;
          const repairPrefix = 'Repair decision:';
          noteContent = noteContent
            ? `${repairPrefix} ${noteContent}`
            : `${repairPrefix} Chose to repair existing item to keep using it.`;
          break;
        }
        case 'replace': {
          outcome = 'bought';
          if (selectedItemId) {
            linkedItemId = selectedItemId;
          }
          const replacePrefix = 'Replacement decision:';
          noteContent = noteContent
            ? `${replacePrefix} ${noteContent}`
            : `${replacePrefix} Buying to replace an existing possession.`;
          break;
        }
        case 'wait': {
          outcome = 'delayed';
          let targetDate: Date | null = null;
          if (waitPreset === 'custom') {
            if (!customReviewDate) {
              setSubmitError('Choose a future date and time for the review.');
              return;
            }
            targetDate = new Date(customReviewDate);
          } else {
            const preset = waitingPresets.find((p) => p.key === waitPreset);
            const dateStr = preset?.deriveReviewAt();
            if (dateStr) targetDate = new Date(dateStr);
          }

          if (
            !targetDate ||
            !Number.isFinite(targetDate.getTime()) ||
            targetDate.getTime() <= Date.now()
          ) {
            setSubmitError('Review date and time must be set in the future.');
            return;
          }
          reviewAt = targetDate.toISOString();
          break;
        }
        case 'buy': {
          outcome = 'bought';
          if (selectedItemId) {
            linkedItemId = selectedItemId;
          }
          break;
        }
        case 'pass': {
          outcome = 'declined';
          break;
        }
      }

      // Check if desire is in a resolved state and requires superseding the current event
      const isResolved = ['bought', 'declined', 'used_owned'].includes(desire.status);
      const supersedesEventId =
        isResolved && reviewPage?.currentEventId ? reviewPage.currentEventId : undefined;

      pendingCommandRef.current = {
        commandId: crypto.randomUUID(),
        revision: desire.revision,
        outcome,
        ...(noteContent ? { note: noteContent } : {}),
        ...(linkedItemId ? { linkedItemId } : {}),
        ...(reviewAt ? { reviewAt } : {}),
        ...(supersedesEventId ? { supersedesEventId } : {}),
      };
    }

    setIsSubmitting(true);
    try {
      const result = await recordReview(desireId, pendingCommandRef.current);
      setRecordedEvent(result);
      pendingCommandRef.current = null;
      setIsUncertainRetry(false);
      setAnnouncement(`Decision recorded: ${result.outcome}.`);

      // Refresh local desire to reflect updated status and revision
      const updatedDesire = await getDesire(desireId).catch(() => null);
      if (updatedDesire) {
        setDesire(updatedDesire);
      }
    } catch (err) {
      // If network dropped or ambiguous 500 occurred, keep exact same commandId for retry safety
      const isNetworkOr500 =
        !(err instanceof DesireRequestError) || err.status === 0 || err.status >= 500;
      setIsUncertainRetry(isNetworkOr500 && pendingCommandRef.current !== null);
      setSubmitError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
      noticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Reset decision form to record another decision / correction
  const handleResetDecision = (): void => {
    setRecordedEvent(null);
    setSubmitError(null);
    pendingCommandRef.current = null;
    setIsUncertainRetry(false);
  };

  if (isLoading) {
    return (
      <div role="status" aria-label="Loading comparison" className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 w-full rounded-lg" />
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
        <span className="sr-only">Loading compare-before-buying decision screen…</span>
      </div>
    );
  }

  if (loadError || !desire) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium">{loadError ?? 'Desire not found.'}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="default"
            onClick={() => {
              setLoadError(null);
              setIsLoading(true);
              void reload()
                .catch((e) => setLoadError(errorMessage(e)))
                .finally(() => setIsLoading(false));
            }}
          >
            <RotateCcw className="mr-2 size-4" aria-hidden="true" />
            Retry loading
          </Button>
          <Button asChild variant="outline">
            <Link href="/wants">Back to Wants</Link>
          </Button>
        </div>
      </div>
    );
  }

  const priceFormatted = formatLikelyPrice(desire.likelyPriceMinor, desire.currency);
  const reviewFormatted = formatReviewDateTime(desire.reviewAt);
  const effectiveLabel = getEffectiveStateLabel(desire.effectiveState);
  const isResolved = ['bought', 'declined', 'used_owned'].includes(desire.status);

  return (
    <div className="space-y-8">
      {/* Screen Reader Announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Top Navigation & Back Link */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground">
          <Link href="/wants">
            <ArrowLeft className="mr-1.5 size-4" aria-hidden="true" />
            Back to Wants
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={`/wants/${desire.id}/matches`}>
              <Boxes className="mr-1.5 size-4" aria-hidden="true" />
              Manage matches ({matches.length})
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={`/wants/${desire.id}/history`}>
              <History className="mr-1.5 size-4" aria-hidden="true" />
              Decision history
            </Link>
          </Button>
        </div>
      </div>

      {/* Neutral guidance alert */}
      <div className="rounded-lg border border-primary/20 bg-muted/40 p-4 text-xs sm:text-sm text-muted-foreground flex gap-3 items-start">
        <Sparkles className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
        <p>{NEUTRAL_COMPARISON_GUIDANCE}</p>
      </div>

      {/* Existing resolved status notice */}
      {isResolved ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs sm:text-sm text-foreground flex items-center justify-between gap-3"
        >
          <span>
            This want already has a recorded decision ({effectiveLabel}). Submitting a new action
            will record a corrective decision in your history.
          </span>
        </div>
      ) : null}

      {/* Side-by-side or stacked comparison section */}
      <section aria-label="Comparison between desired item and possessions">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Column 1: The Desire Being Considered */}
          <Card className="border-primary/30 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-xs uppercase tracking-wider font-semibold">
                  Desired item
                </Badge>
                <div className="flex items-center gap-1.5 text-xs">
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
                </div>
              </div>
              <h2 className="text-xl sm:text-2xl pt-2 break-words font-semibold leading-tight">
                {desire.name}
              </h2>
              <CardDescription className="text-sm font-medium text-foreground">
                Likely price: {priceFormatted}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {/* Optional Photo */}
              {desire.photo ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted">
                  <PrivatePhoto
                    {...desirePhotoSource(
                      desire.id,
                      desire.photo,
                      desire.name,
                      '(max-width: 1024px) 100vw, 50vw',
                      { large: true },
                    )}
                    fit="cover"
                  />
                </div>
              ) : null}

              {/* Waiting Period Info */}
              {desire.effectiveState === 'waiting' && reviewFormatted ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground rounded-md bg-muted/50 p-2.5">
                  <Clock className="size-4 shrink-0" aria-hidden="true" />
                  <span>Review scheduled for: {reviewFormatted}</span>
                </div>
              ) : null}

              {/* Stated Reason */}
              <div className="space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Why you wanted this
                </h4>
                <p className="text-muted-foreground break-words">
                  {desire.reason ?? 'No reflection reason was recorded.'}
                </p>
              </div>

              {/* Product link */}
              {desire.productUrl ? (
                <div className="pt-1">
                  <a
                    href={desire.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 min-h-11 sm:min-h-0"
                    aria-label={`Visit product link for ${desire.name} (opens in new tab)`}
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span>View product link</span>
                  </a>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Column 2: Connected Possessions */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold tracking-tight">Connected possessions</h3>
              <span className="text-xs text-muted-foreground">
                {formattedMatches.length === 1
                  ? '1 item connected'
                  : `${formattedMatches.length} items connected`}
              </span>
            </div>

            {formattedMatches.length === 0 ? (
              <Card className="border-dashed bg-muted/20 p-6 text-center space-y-3">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
                  <Boxes className="size-6 text-muted-foreground" aria-hidden="true" />
                </div>
                <h4 className="font-semibold text-base">No possessions connected yet</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  You haven’t linked any existing possessions to this desire. You can still make an
                  intentional decision below, or connect items first.
                </p>
                <div className="pt-2">
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <Link href={`/wants/${desire.id}/matches`}>
                      <Boxes className="mr-1.5 size-4" aria-hidden="true" />
                      Search and connect possessions
                    </Link>
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="space-y-4">
                {formattedMatches.map((item) => (
                  <Card
                    key={item.id}
                    className={`overflow-hidden transition-all ${
                      item.relevance === 'irrelevant'
                        ? 'border-muted bg-muted/20 opacity-75'
                        : selectedItemId === item.id && selectedAction === 'use_owned'
                          ? 'border-primary ring-1 ring-primary/20 bg-card'
                          : 'border-border bg-card'
                    }`}
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row gap-4 items-start">
                        {/* Cover thumbnail */}
                        <div className="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                          <ItemCover
                            cover={
                              item.cover
                                ? photoSource(
                                    item.id,
                                    {
                                      id: item.cover.photoId,
                                      width: item.cover.width,
                                      height: item.cover.height,
                                    },
                                    item.cover.decorative ? '' : (item.cover.altText ?? item.name),
                                    '(max-width: 640px) 64px, 80px',
                                  )
                                : null
                            }
                            emptyLabel="No photo"
                            className="size-full aspect-square"
                          />
                        </div>

                        {/* Details */}
                        <div className="space-y-2 flex-1 min-w-0 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <h4 className="font-semibold text-base leading-tight break-words">
                              {item.name}
                            </h4>
                            {item.isUnavailable ? (
                              <Badge variant="destructive" className="text-xs font-normal">
                                Unavailable
                              </Badge>
                            ) : item.isConditionWornOut ? (
                              <Badge variant="secondary" className="text-xs font-normal">
                                Worn out
                              </Badge>
                            ) : null}
                          </div>

                          {item.brand || item.model ? (
                            <p className="text-xs text-muted-foreground">
                              {[item.brand, item.model].filter(Boolean).join(' • ')}
                            </p>
                          ) : null}

                          {/* Honest Facts: Price, Date, Condition, Usage */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">Paid: </span>
                              <span
                                className={`font-medium ${
                                  item.isPriceUnknown ? 'text-muted-foreground italic' : ''
                                }`}
                              >
                                {item.priceText}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Acquired: </span>
                              <span
                                className={`font-medium ${
                                  item.isDateUnknown ? 'text-muted-foreground italic' : ''
                                }`}
                              >
                                {item.acquiredText}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Condition: </span>
                              <span className="font-medium">{item.conditionLabel}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Use: </span>
                              <span className="font-medium">{item.usageLabel}</span>
                            </div>
                          </div>

                          {/* Plain-Language Match Reason & Hints */}
                          <div className="rounded-md bg-muted/40 p-2.5 space-y-1 text-xs">
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Why displayed: </span>
                              {item.reason}
                            </p>
                            {item.relevance === 'irrelevant' ? (
                              <p className="text-amber-600 dark:text-amber-400 font-medium">
                                Marked as not relevant by you.
                              </p>
                            ) : null}
                            {item.categoryHint || item.usageHint || item.conditionHint ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {item.categoryHint ? (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {item.categoryHint}
                                  </Badge>
                                ) : null}
                                {item.usageHint ? (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {item.usageHint}
                                  </Badge>
                                ) : null}
                                {item.conditionHint ? (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {item.conditionHint}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}
                          </div>

                          {/* Selection Shortcut Button */}
                          {item.isUsableAlternative ? (
                            <div className="pt-1 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant={
                                  selectedItemId === item.id && selectedAction === 'use_owned'
                                    ? 'default'
                                    : 'outline'
                                }
                                size="sm"
                                className="min-h-11 text-xs"
                                onClick={() => {
                                  setSelectedAction('use_owned');
                                  setSelectedItemId(item.id);
                                }}
                              >
                                {selectedItemId === item.id && selectedAction === 'use_owned'
                                  ? 'Selected to use'
                                  : 'Use this item'}
                              </Button>

                              {item.isConditionNeedsRepair || item.isConditionBroken ? (
                                <Button
                                  type="button"
                                  variant={
                                    selectedItemId === item.id && selectedAction === 'repair'
                                      ? 'default'
                                      : 'outline'
                                  }
                                  size="sm"
                                  className="min-h-11 text-xs"
                                  onClick={() => {
                                    setSelectedAction('repair');
                                    setSelectedItemId(item.id);
                                  }}
                                >
                                  <Wrench className="mr-1.5 size-3.5" aria-hidden="true" />
                                  Repair this item
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Decision Section */}
      <section
        aria-label="Make an intentional decision"
        className="rounded-xl border bg-card p-6 sm:p-8 space-y-6 shadow-xs"
      >
        <div ref={noticeRef} tabIndex={-1} className="outline-hidden">
          {/* Success Confirmation Card */}
          {recordedEvent ? (
            <div
              role="status"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-emerald-900 dark:text-emerald-100 space-y-3"
            >
              <div className="flex items-center gap-2 font-semibold text-base">
                <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>Decision recorded: {recordedEvent.outcome}</span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {recordedEvent.outcome === 'delayed' && recordedEvent.reviewAt ? (
                  <>
                    Waiting period updated until{' '}
                    <strong>{formatReviewDateTime(recordedEvent.reviewAt)}</strong>. A reminder has
                    been scheduled.
                  </>
                ) : recordedEvent.outcome === 'declined' ? (
                  <>
                    Recorded as declined. Any amount not spent is preserved as an estimate, never
                    assumed as cash saved.
                  </>
                ) : recordedEvent.outcome === 'used_owned' ? (
                  <>
                    Recorded decision to use{' '}
                    <strong>{recordedEvent.linkedItemName ?? 'your owned possession'}</strong>.
                  </>
                ) : (
                  <>Recorded decision to proceed with purchase intentionally.</>
                )}
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                {recordedEvent.outcome === 'declined' ? (
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <Link href={`/wants/${desire.id}/allocate`}>Allocate to a goal (optional)</Link>
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link href={`/wants/${desire.id}/history`}>View decision history</Link>
                </Button>
                <Button asChild variant="default" size="sm" className="min-h-11">
                  <Link href="/wants">Return to Wants</Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  onClick={handleResetDecision}
                >
                  Record another decision
                </Button>
              </div>
            </div>
          ) : null}

          {/* Error Banner */}
          {submitError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive space-y-2 mb-4"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
                <p className="text-sm font-medium">{submitError}</p>
              </div>
              {isUncertainRetry ? (
                <p className="text-xs text-muted-foreground">
                  The previous attempt was interrupted. Clicking retry will safely replay your exact
                  command without duplicating records.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight">Decide how to proceed</h3>
            <p className="text-sm text-muted-foreground">
              Choose an action that fits your current intention. Every decision creates a permanent,
              honest record in your history.
            </p>
          </div>

          {/* Question: What would this product do differently? */}
          <div className="space-y-2 rounded-lg bg-muted/30 p-4 border border-border">
            <Label htmlFor={`${componentId}-different-note`} className="font-semibold text-sm">
              {DIFFERENTIATION_PROMPT}
            </Label>
            <p className="text-xs text-muted-foreground">{DIFFERENTIATION_HINT}</p>
            <Textarea
              id={`${componentId}-different-note`}
              value={differentNote}
              onChange={(e) => setDifferentNote(e.target.value)}
              placeholder="e.g., Offers noise cancellation for noisy flights, which my wired pair lacks."
              maxLength={2000}
              rows={3}
              className="resize-y"
              aria-describedby={`${componentId}-different-note-hint`}
            />
            <span id={`${componentId}-different-note-hint`} className="sr-only">
              Optional reflection note saved with your decision.
            </span>
          </div>

          {/* Decision Actions Radiogroup */}
          <div className="space-y-3">
            <Label className="font-semibold text-base">Select your decision action</Label>
            <RadioGroup
              value={selectedAction}
              onValueChange={(val) => {
                setSelectedAction(val as DecisionActionType);
                setSubmitError(null);
              }}
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {decisionActions.map((action) => {
                const isSelected = selectedAction === action.type;
                return (
                  <label
                    key={action.type}
                    htmlFor={`${componentId}-action-${action.type}`}
                    className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <RadioGroupItem
                      value={action.type}
                      id={`${componentId}-action-${action.type}`}
                      className="mt-1"
                    />
                    <div className="space-y-1">
                      <div className="font-medium text-sm text-foreground">{action.label}</div>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          {/* Conditional Sub-panel: Item selection for use_owned, repair, or replace */}
          {(selectedAction === 'use_owned' ||
            selectedAction === 'repair' ||
            selectedAction === 'replace') && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <Label htmlFor={`${componentId}-item-selector`} className="font-semibold text-sm">
                {selectedAction === 'repair'
                  ? 'Select the owned item to repair'
                  : selectedAction === 'replace'
                    ? 'Select the owned item being replaced (optional)'
                    : 'Select the owned possession you will use'}
              </Label>

              {usableMatches.length > 0 ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {usableMatches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSelectedItemId(m.id)}
                        className={`text-left rounded-md border p-3 min-h-11 text-xs transition-colors ${
                          selectedItemId === m.id
                            ? 'border-primary bg-primary/10 font-medium'
                            : 'border-border bg-card hover:bg-muted/50'
                        }`}
                        aria-pressed={selectedItemId === m.id}
                      >
                        <div className="font-semibold text-foreground">{m.name}</div>
                        <div className="text-muted-foreground">
                          {m.conditionLabel} • {m.usageLabel}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Option to load other inventory items if matched items are empty or different */}
              <div className="pt-2">
                {!hasLoadedOtherItems ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 text-xs"
                    onClick={() => void handleLoadOtherItems()}
                    disabled={isLoadingOtherItems}
                  >
                    {isLoadingOtherItems
                      ? 'Loading inventory…'
                      : 'Choose another item from inventory'}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Label
                      htmlFor={`${componentId}-all-items-select`}
                      className="text-xs text-muted-foreground"
                    >
                      All owned inventory items:
                    </Label>
                    <select
                      id={`${componentId}-all-items-select`}
                      value={selectedItemId}
                      onChange={(e) => setSelectedItemId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs min-h-11"
                    >
                      <option value="">-- Choose an item --</option>
                      {otherItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Conditional Sub-panel: Waiting Period Presets for wait */}
          {selectedAction === 'wait' && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <Label className="font-semibold text-sm">Choose review date</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {waitingPresets
                  .filter((p) => p.key !== 'none')
                  .map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      variant={waitPreset === preset.key ? 'default' : 'outline'}
                      size="sm"
                      className="min-h-11 text-xs"
                      onClick={() => {
                        setWaitPreset(preset.key);
                        if (preset.key !== 'custom') {
                          const dateStr = preset.deriveReviewAt();
                          if (dateStr) {
                            setCustomReviewDate(new Date(dateStr).toISOString().slice(0, 16));
                          }
                        }
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
              </div>

              {waitPreset === 'custom' && (
                <div className="space-y-1.5 pt-2 max-w-xs">
                  <Label
                    htmlFor={`${componentId}-custom-date`}
                    className="text-xs text-muted-foreground"
                  >
                    Custom review date and time:
                  </Label>
                  <Input
                    id={`${componentId}-custom-date`}
                    type="datetime-local"
                    value={customReviewDate}
                    onChange={(e) => setCustomReviewDate(e.target.value)}
                    className="min-h-11"
                  />
                </div>
              )}
            </div>
          )}

          {/* Submit Action Button */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t">
            <Button
              type="submit"
              variant="default"
              size="lg"
              className="min-h-11 px-6 font-semibold"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? 'Recording decision…'
                : isUncertainRetry
                  ? 'Retry recording decision'
                  : 'Record decision'}
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-11">
              <Link href="/wants">Cancel / Back to Wants</Link>
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
