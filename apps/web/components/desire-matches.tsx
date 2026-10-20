'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import Link from 'next/link';
import type {
  Desire,
  DesireMatch,
  DesireSuggestionItem,
  MatchCandidateItem,
  MatchRelevance,
} from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Checkbox } from '@havefolio/ui/components/checkbox';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { ItemCover } from '@havefolio/ui/components/havefolio/item-cover';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Textarea } from '@havefolio/ui/components/textarea';
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
import {
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  addDesireMatch,
  classificationInfo,
  deleteDesireMatch,
  deleteSuggestionFeedback,
  DesireRequestError,
  getDesire,
  getDesireMatches,
  getDesireSuggestions,
  getMatchCandidates,
  recordSuggestionFeedback,
  updateDesireMatch,
} from './desires-client';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  getEffectiveStateLabel,
} from './desire-presentation';
import { photoSource } from './photos-client';

export function DesireMatches({ desireId }: { desireId: string }): ReactElement {
  const componentId = useId();
  const searchSectionRef = useRef<HTMLDivElement>(null);

  // Desire state
  const [desire, setDesire] = useState<Desire | null>(null);
  const [isLoadingDesire, setIsLoadingDesire] = useState(true);
  const [desireError, setDesireError] = useState<string | null>(null);

  // Matches state
  const [matches, setMatches] = useState<DesireMatch[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  // Edit match reason state
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editReasonText, setEditReasonText] = useState('');
  const [isSavingReason, setIsSavingReason] = useState(false);
  const [editReasonError, setEditReasonError] = useState<string | null>(null);

  // Updating relevance state
  const [updatingRelevanceId, setUpdatingRelevanceId] = useState<string | null>(null);

  // Deleting match state
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [isDeletingMatch, setIsDeletingMatch] = useState(false);
  const [deleteMatchError, setDeleteMatchError] = useState<string | null>(null);

  // Candidates / Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [candidates, setCandidates] = useState<MatchCandidateItem[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(true);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // Suggestions state (PER-46)
  const [suggestions, setSuggestions] = useState<DesireSuggestionItem[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<DesireSuggestionItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [feedbackInProgressId, setFeedbackInProgressId] = useState<string | null>(null);
  const [undoInProgressId, setUndoInProgressId] = useState<string | null>(null);

  // Add match form state (per candidate itemId -> reason text)
  const [candidateReasons, setCandidateReasons] = useState<Record<string, string>>({});
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load Desire
  const loadDesireData = useCallback(
    (signal?: AbortSignal): void => {
      getDesire(desireId, signal)
        .then((d) => {
          setDesire(d);
          setDesireError(null);
          setIsLoadingDesire(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          if (err instanceof DesireRequestError) {
            setDesireError(err.message);
          } else {
            setDesireError('Could not load desire details.');
          }
          setIsLoadingDesire(false);
        });
    },
    [desireId],
  );

  // Load Matches
  const loadMatchesData = useCallback(
    (signal?: AbortSignal): void => {
      getDesireMatches(desireId, { limit: 50, signal })
        .then((res) => {
          setMatches(res.items);
          setMatchesError(null);
          setIsLoadingMatches(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          if (err instanceof DesireRequestError) {
            setMatchesError(err.message);
          } else {
            setMatchesError('Could not load connected possessions.');
          }
          setIsLoadingMatches(false);
        });
    },
    [desireId],
  );

  // Search Candidates debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load Candidates
  const loadCandidatesData = useCallback(
    (signal?: AbortSignal): void => {
      const qTrim = debouncedQuery.trim();
      getMatchCandidates(desireId, {
        ...(qTrim ? { q: qTrim } : {}),
        includeUnavailable,
        limit: 25,
        signal,
      })
        .then((res) => {
          setCandidates(res.items);
          setCandidatesError(null);
          setIsLoadingCandidates(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          if (err instanceof DesireRequestError) {
            setCandidatesError(err.message);
          } else {
            setCandidatesError('Could not load inventory possessions.');
          }
          setIsLoadingCandidates(false);
        });
    },
    [desireId, debouncedQuery, includeUnavailable],
  );

  // Load Suggestions (PER-46)
  const loadSuggestionsData = useCallback(
    (signal?: AbortSignal): void => {
      getDesireSuggestions(desireId, { limit: 20, signal })
        .then((res) => {
          setSuggestions(res.items);
          setSuggestionsError(null);
          setIsLoadingSuggestions(false);
        })
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          if (err instanceof DesireRequestError) {
            setSuggestionsError(err.message);
          } else {
            setSuggestionsError('Could not load suggestions.');
          }
          setIsLoadingSuggestions(false);
        });
    },
    [desireId],
  );

  const loadDismissedSuggestionsData = useCallback(
    (signal?: AbortSignal): void => {
      getDesireSuggestions(desireId, { limit: 20, includeDismissed: true, signal })
        .then((res) => {
          setDismissedSuggestions(
            res.items.filter((item) => item.feedback?.feedbackType === 'dismissed'),
          );
        })
        .catch(() => {
          // Keep quiet on background dismissed fetch
        });
    },
    [desireId],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadDesireData(controller.signal);
    loadMatchesData(controller.signal);
    loadSuggestionsData(controller.signal);
    loadDismissedSuggestionsData(controller.signal);
    return () => controller.abort();
  }, [loadDesireData, loadMatchesData, loadSuggestionsData, loadDismissedSuggestionsData]);

  useEffect(() => {
    const controller = new AbortController();
    loadCandidatesData(controller.signal);
    return () => controller.abort();
  }, [loadCandidatesData]);

  // Handle Add Match
  const handleAddMatch = async (candidate: MatchCandidateItem): Promise<void> => {
    setAddingItemId(candidate.id);
    setAddError(null);
    setStatusMessage(null);
    try {
      const customReason = candidateReasons[candidate.id]?.trim();
      const newMatch = await addDesireMatch(desireId, {
        itemId: candidate.id,
        ...(customReason ? { reason: customReason } : {}),
      });

      setMatches((prev) => [newMatch, ...prev.filter((m) => m.id !== newMatch.id)]);
      setCandidates((prev) =>
        prev.map((c) => (c.id === candidate.id ? { ...c, isAlreadyMatched: true } : c)),
      );
      setStatusMessage(`Connected “${candidate.name}” to this want.`);
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setAddError(err.message);
      } else {
        setAddError('Could not connect this possession. Try again.');
      }
    } finally {
      setAddingItemId(null);
    }
  };

  // Handle Add Suggestion Match (PER-46)
  const handleAddSuggestionMatch = async (suggestion: DesireSuggestionItem): Promise<void> => {
    setAddingItemId(suggestion.item.id);
    setAddError(null);
    setStatusMessage(null);
    try {
      const newMatch = await addDesireMatch(desireId, {
        itemId: suggestion.item.id,
        reason: suggestion.explanation,
      });

      setMatches((prev) => [newMatch, ...prev.filter((m) => m.id !== newMatch.id)]);
      setSuggestions((prev) => prev.filter((s) => s.item.id !== suggestion.item.id));
      setCandidates((prev) =>
        prev.map((c) => (c.id === suggestion.item.id ? { ...c, isAlreadyMatched: true } : c)),
      );
      setStatusMessage(`Connected “${suggestion.item.name}” to this want.`);
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setAddError(err.message);
      } else {
        setAddError('Could not connect this possession. Try again.');
      }
    } finally {
      setAddingItemId(null);
    }
  };

  // Handle Dismiss Suggestion (PER-46)
  const handleDismissSuggestion = async (suggestion: DesireSuggestionItem): Promise<void> => {
    setFeedbackInProgressId(suggestion.item.id);
    setStatusMessage(null);
    try {
      const fb = await recordSuggestionFeedback(desireId, {
        itemId: suggestion.item.id,
        feedbackType: 'dismissed',
        scope: 'desire',
      });
      setSuggestions((prev) => prev.filter((s) => s.item.id !== suggestion.item.id));
      setDismissedSuggestions((prev) => [
        { ...suggestion, feedback: fb },
        ...prev.filter((s) => s.item.id !== suggestion.item.id),
      ]);
      setStatusMessage(`Dismissed “${suggestion.item.name}” for this want.`);
    } catch {
      setStatusMessage('Could not dismiss suggestion. Try again.');
    } finally {
      setFeedbackInProgressId(null);
    }
  };

  // Handle Undo Dismissal (PER-46)
  const handleUndoDismissal = async (suggestion: DesireSuggestionItem): Promise<void> => {
    if (!suggestion.feedback) return;
    setUndoInProgressId(suggestion.feedback.id);
    setStatusMessage(null);
    try {
      await deleteSuggestionFeedback(desireId, suggestion.feedback.id);
      setDismissedSuggestions((prev) => prev.filter((s) => s.item.id !== suggestion.item.id));
      setSuggestions((prev) => [{ ...suggestion, feedback: null }, ...prev]);
      setStatusMessage(`Restored “${suggestion.item.name}” to suggestions.`);
    } catch {
      setStatusMessage('Could not undo dismissal. Try again.');
    } finally {
      setUndoInProgressId(null);
    }
  };

  // Handle Update Relevance
  const handleUpdateRelevance = async (
    matchId: string,
    newRelevance: MatchRelevance,
  ): Promise<void> => {
    setUpdatingRelevanceId(matchId);
    setStatusMessage(null);
    try {
      const updated = await updateDesireMatch(desireId, matchId, { relevance: newRelevance });
      setMatches((prev) => prev.map((m) => (m.id === matchId ? updated : m)));
      setStatusMessage(
        newRelevance === 'irrelevant'
          ? 'Marked as not an alternative for this want.'
          : 'Marked as a relevant alternative.',
      );
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setStatusMessage(err.message);
      } else {
        setStatusMessage('Could not update relevance feedback. Try again.');
      }
    } finally {
      setUpdatingRelevanceId(null);
    }
  };

  // Handle Start Edit Reason
  const handleStartEditReason = (match: DesireMatch): void => {
    setEditingMatchId(match.id);
    setEditReasonText(match.reason);
    setEditReasonError(null);
  };

  // Handle Save Reason
  const handleSaveReason = async (matchId: string): Promise<void> => {
    setIsSavingReason(true);
    setEditReasonError(null);
    try {
      const updated = await updateDesireMatch(desireId, matchId, {
        reason: editReasonText.trim(),
      });
      setMatches((prev) => prev.map((m) => (m.id === matchId ? updated : m)));
      setEditingMatchId(null);
      setStatusMessage('Explanation updated.');
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setEditReasonError(err.message);
      } else {
        setEditReasonError('Could not save explanation. Try again.');
      }
    } finally {
      setIsSavingReason(false);
    }
  };

  // Handle Delete Match
  const handleDeleteMatch = async (match: DesireMatch): Promise<void> => {
    setIsDeletingMatch(true);
    setDeleteMatchError(null);
    try {
      await deleteDesireMatch(desireId, match.id);
      setMatches((prev) => prev.filter((m) => m.id !== match.id));
      setCandidates((prev) =>
        prev.map((c) => (c.id === match.itemId ? { ...c, isAlreadyMatched: false } : c)),
      );
      setDeletingMatchId(null);
      setStatusMessage(`Removed connection with “${match.item.name}”.`);
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setDeleteMatchError(err.message);
      } else {
        setDeleteMatchError('Could not remove connection. Try again.');
      }
    } finally {
      setIsDeletingMatch(false);
    }
  };

  if (isLoadingDesire) {
    return (
      <div className="space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (desireError || !desire) {
    return (
      <Card className="border-destructive/30 shadow-sm" role="alert">
        <CardHeader>
          <CardTitle className="text-destructive font-semibold">Unable to load want</CardTitle>
          <CardDescription>{desireError || 'Want not found.'}</CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setIsLoadingDesire(true);
              loadDesireData();
            }}
          >
            <RotateCcw className="mr-2 size-4" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="ghost" className="min-h-11">
            <Link href="/wants">Back to wants</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const priceFormatted = formatLikelyPrice(desire.likelyPriceMinor, desire.currency);
  const reviewFormatted = formatReviewDateTime(desire.reviewAt);
  const effectiveLabel = getEffectiveStateLabel(desire.effectiveState);

  return (
    <div className="space-y-8">
      {/* Navigation & Context Card */}
      <Card className="border-muted bg-card shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" className="min-h-11 px-2.5">
                <Link href="/wants" aria-label="Back to wants list">
                  <ArrowLeft className="mr-1.5 size-4" aria-hidden="true" />
                  Wants
                </Link>
              </Button>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-medium text-muted-foreground">Possession matching</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="min-h-11">
                <Link href={`/wants/${desire.id}/edit`}>
                  <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                  Edit want
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="min-h-11">
                <Link href={`/wants/${desire.id}/compare`}>Compare before buying</Link>
              </Button>
              <Button asChild variant="default" size="sm" className="min-h-11">
                <Link href="/wants">Done / Continue</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-t pt-4">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{desire.name}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs">
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
                {desire.effectiveState === 'waiting' && reviewFormatted ? (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" aria-hidden="true" />
                      Review: {reviewFormatted}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground pt-1">
            Consider what you already own before purchasing something new. Connecting possessions
            lets you reflect on usable alternatives without assuming any item is equivalent or
            identical. Having no match never blocks your decision.
          </p>
        </CardContent>
      </Card>

      {/* Global Status Banner if present */}
      {statusMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary"
        >
          <span>{statusMessage}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setStatusMessage(null)}
            aria-label="Dismiss message"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {/* Section 1: Connected Possessions */}
      <section aria-labelledby={`${componentId}-matches-heading`} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3
              id={`${componentId}-matches-heading`}
              className="text-lg font-semibold tracking-tight"
            >
              Connected possessions
            </h3>
            <p className="text-sm text-muted-foreground">
              {matches.length === 1
                ? '1 possession connected as a potential alternative.'
                : `${matches.length} possessions connected as potential alternatives.`}
            </p>
          </div>
          {matches.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => {
                searchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              Connect another possession
            </Button>
          ) : null}
        </div>

        {matchesError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
          >
            <p>{matchesError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => {
                setIsLoadingMatches(true);
                loadMatchesData();
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              Retry loading matches
            </Button>
          </div>
        ) : null}

        {isLoadingMatches ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ) : matches.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Boxes className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No possessions connected yet</EmptyTitle>
                <EmptyDescription>
                  Search your inventory below to link possessions that might fulfill this need, or
                  proceed without connecting any.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="flex flex-wrap gap-2 justify-center">
                <Button
                  variant="default"
                  className="min-h-11"
                  onClick={() => {
                    searchSectionRef.current?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                >
                  <Search className="mr-1.5 size-4" aria-hidden="true" />
                  Search your inventory
                </Button>
                <Button asChild variant="outline" className="min-h-11">
                  <Link href={`/wants/${desire.id}/compare`}>Compare before buying</Link>
                </Button>
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/wants">Continue without matching</Link>
                </Button>
              </EmptyContent>
            </Empty>
          </Card>
        ) : (
          <div className="space-y-4">
            {matches.map((match) => {
              const isEditingThis = editingMatchId === match.id;
              const isUpdatingThis = updatingRelevanceId === match.id;

              return (
                <Card
                  key={match.id}
                  className={`overflow-hidden transition-all ${
                    match.relevance === 'irrelevant'
                      ? 'border-muted bg-muted/30 opacity-80'
                      : 'border-border bg-card'
                  }`}
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col md:flex-row gap-4 items-start justify-between">
                      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
                        {/* Cover thumbnail */}
                        <div className="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                          <ItemCover
                            cover={
                              match.item.cover
                                ? photoSource(
                                    match.item.id,
                                    {
                                      id: match.item.cover.photoId,
                                      width: match.item.cover.width,
                                      height: match.item.cover.height,
                                    },
                                    match.item.cover.decorative
                                      ? ''
                                      : (match.item.cover.altText ?? match.item.name),
                                    '(max-width: 640px) 64px, 80px',
                                  )
                                : null
                            }
                            emptyLabel="No photo"
                            className="size-full aspect-square"
                          />
                        </div>

                        {/* Item and Match Details */}
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-base sm:text-lg leading-tight break-words">
                              {match.item.name}
                            </h4>
                            {match.item.brand || match.item.model ? (
                              <span className="text-xs text-muted-foreground">
                                {[match.item.brand, match.item.model].filter(Boolean).join(' • ')}
                              </span>
                            ) : null}
                          </div>

                          {/* Usability & Hints Badges */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {match.item.isUsableAlternative ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400 font-medium"
                              >
                                Usable alternative
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-muted-foreground font-normal"
                              >
                                {match.item.ownershipStatus === 'owned' &&
                                match.item.condition === 'worn_out'
                                  ? 'Worn out · still owned'
                                  : `Unavailable (${match.item.ownershipStatus})`}
                              </Badge>
                            )}

                            {match.relevance === 'irrelevant' ? (
                              <Badge
                                variant="outline"
                                className="text-muted-foreground font-normal"
                              >
                                Marked irrelevant
                              </Badge>
                            ) : null}

                            {match.hints.categoryHint ? (
                              <Badge variant="secondary" className="font-normal">
                                {match.hints.categoryHint}
                              </Badge>
                            ) : null}

                            {match.hints.conditionHint ? (
                              <Badge variant="secondary" className="font-normal">
                                {match.hints.conditionHint}
                              </Badge>
                            ) : null}

                            {match.hints.usageHint ? (
                              <Badge variant="secondary" className="font-normal">
                                {match.hints.usageHint}
                              </Badge>
                            ) : null}

                            {match.hints.traitHints.map((trait) => (
                              <Badge key={trait} variant="outline" className="font-normal">
                                #{trait}
                              </Badge>
                            ))}
                          </div>

                          {/* Plain-language Reason / Explanation */}
                          <div className="pt-1">
                            {isEditingThis ? (
                              <div className="space-y-2 rounded-md border p-3 bg-background">
                                <Label
                                  htmlFor={`edit-reason-${match.id}`}
                                  className="text-xs font-medium"
                                >
                                  Explain why this possession may serve the same purpose:
                                </Label>
                                <Textarea
                                  id={`edit-reason-${match.id}`}
                                  value={editReasonText}
                                  onChange={(e) => setEditReasonText(e.target.value)}
                                  maxLength={1000}
                                  rows={3}
                                  className="text-sm"
                                  placeholder="E.g., Can brew pourover coffee instead of buying an espresso machine."
                                />
                                {editReasonError ? (
                                  <p className="text-xs text-destructive">{editReasonError}</p>
                                ) : null}
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{editReasonText.length} / 1000 characters</span>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="min-h-11"
                                      onClick={() => setEditingMatchId(null)}
                                      disabled={isSavingReason}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="min-h-11"
                                      onClick={() => void handleSaveReason(match.id)}
                                      disabled={isSavingReason}
                                    >
                                      {isSavingReason ? 'Saving...' : 'Save reason'}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-2 group">
                                <p className="text-sm text-foreground/90 leading-relaxed italic bg-muted/40 rounded px-2.5 py-1.5 flex-1">
                                  “{match.reason}”
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="min-h-11 min-w-11 px-2 text-muted-foreground hover:text-foreground shrink-0"
                                  onClick={() => handleStartEditReason(match)}
                                  aria-label={`Edit explanation for ${match.item.name}`}
                                >
                                  <Pencil className="size-3.5 mr-1" aria-hidden="true" />
                                  Edit
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Relevance Feedback & Remove Controls */}
                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-2 border-t md:border-t-0 pt-2 md:pt-0 shrink-0">
                        {/* Relevance toggle */}
                        <div className="flex items-center gap-1.5">
                          {match.relevance === 'relevant' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 text-xs text-muted-foreground hover:text-foreground"
                              disabled={isUpdatingThis}
                              onClick={() => void handleUpdateRelevance(match.id, 'irrelevant')}
                              aria-label={`Mark ${match.item.name} as irrelevant alternative`}
                            >
                              <XCircle className="size-3.5 mr-1.5" aria-hidden="true" />
                              Mark irrelevant
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 text-xs font-medium"
                              disabled={isUpdatingThis}
                              onClick={() => void handleUpdateRelevance(match.id, 'relevant')}
                              aria-label={`Mark ${match.item.name} as relevant alternative`}
                            >
                              <CheckCircle2
                                className="size-3.5 mr-1.5 text-emerald-600"
                                aria-hidden="true"
                              />
                              Mark relevant
                            </Button>
                          )}
                        </div>

                        {/* Remove connection dialog */}
                        <AlertDialog
                          open={deletingMatchId === match.id}
                          onOpenChange={(open) => {
                            if (!open) setDeletingMatchId(null);
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11 px-2.5 text-muted-foreground hover:text-destructive text-xs"
                              onClick={() => setDeletingMatchId(match.id)}
                              aria-label={`Remove match with ${match.item.name}`}
                            >
                              <Trash2 className="size-3.5 mr-1" aria-hidden="true" />
                              Remove
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove connected possession?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will disconnect “{match.item.name}” from “{desire.name}”. Your
                                inventory item will remain unchanged in your household possessions.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            {deleteMatchError ? (
                              <p className="text-xs text-destructive">{deleteMatchError}</p>
                            ) : null}
                            <AlertDialogFooter>
                              <AlertDialogCancel className="min-h-11" disabled={isDeletingMatch}>
                                Keep connected
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={(e) => {
                                  e.preventDefault();
                                  void handleDeleteMatch(match);
                                }}
                                disabled={isDeletingMatch}
                              >
                                {isDeletingMatch ? 'Removing...' : 'Remove connection'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Suggested Possessions (PER-46) */}
      <section
        aria-labelledby={`${componentId}-suggestions-heading`}
        className="space-y-4 pt-4 border-t"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              <h3
                id={`${componentId}-suggestions-heading`}
                className="text-lg font-semibold tracking-tight"
              >
                Suggested possessions
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Explainable suggestions based on your recorded possessions, categories, and purposes.
            </p>
          </div>
          {dismissedSuggestions.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowDismissed(!showDismissed)}
              aria-expanded={showDismissed}
            >
              {showDismissed
                ? 'Hide dismissed suggestions'
                : `View dismissed (${dismissedSuggestions.length})`}
            </Button>
          ) : null}
        </div>

        {suggestionsError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
          >
            <p>{suggestionsError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => {
                setIsLoadingSuggestions(true);
                loadSuggestionsData();
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              Retry loading suggestions
            </Button>
          </div>
        ) : null}

        {isLoadingSuggestions ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ) : suggestions.length === 0 ? (
          <Card className="border-dashed bg-muted/10">
            <Empty className="py-6">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-medium">No automatic suggestions</EmptyTitle>
                <EmptyDescription className="text-xs">
                  We didn&apos;t find any automatic suggestions based on recorded categories or
                  purpose. Search your inventory below to link an alternative manually.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          <div className="space-y-3">
            {suggestions.map((suggestion) => {
              const isConnecting = addingItemId === suggestion.id;
              const isDismissing = feedbackInProgressId === suggestion.id;

              return (
                <Card
                  key={suggestion.id}
                  className="border-border bg-card shadow-sm hover:border-foreground/20 transition-colors"
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
                      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
                        {/* Cover thumbnail */}
                        <div className="relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                          <ItemCover
                            cover={
                              suggestion.item.cover
                                ? photoSource(
                                    suggestion.item.id,
                                    {
                                      id: suggestion.item.cover.photoId,
                                      width: suggestion.item.cover.width,
                                      height: suggestion.item.cover.height,
                                    },
                                    suggestion.item.cover.decorative
                                      ? ''
                                      : (suggestion.item.cover.altText ?? suggestion.item.name),
                                    '(max-width: 640px) 64px, 80px',
                                  )
                                : null
                            }
                            emptyLabel="No photo"
                            className="size-full aspect-square"
                          />
                        </div>

                        {/* Details */}
                        <div className="space-y-2 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-base sm:text-lg leading-tight break-words">
                              {suggestion.item.name}
                            </h4>
                            {suggestion.item.brand || suggestion.item.model ? (
                              <span className="text-xs text-muted-foreground">
                                {[suggestion.item.brand, suggestion.item.model]
                                  .filter(Boolean)
                                  .join(' • ')}
                              </span>
                            ) : null}
                          </div>

                          {/* Badges */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {suggestion.isUsableAlternative ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400 font-medium"
                              >
                                Usable alternative
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-muted-foreground font-normal"
                              >
                                Unavailable ({suggestion.item.ownershipStatus})
                              </Badge>
                            )}

                            {suggestion.workingRarelyUsed ? (
                              <Badge
                                variant="secondary"
                                className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium"
                              >
                                Working condition · Rarely used
                              </Badge>
                            ) : null}

                            {suggestion.factors?.map((factor) => (
                              <Badge key={factor.kind} variant="secondary" className="font-normal">
                                {factor.label}
                              </Badge>
                            ))}
                          </div>

                          {/* Plain-language explanation */}
                          <p className="text-xs sm:text-sm text-muted-foreground pt-1">
                            {suggestion.explanation}
                          </p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-row sm:flex-col gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0">
                        <Button
                          size="sm"
                          className="min-h-11 flex-1 sm:flex-initial"
                          onClick={() => void handleAddSuggestionMatch(suggestion)}
                          disabled={isConnecting || isDismissing}
                        >
                          <Plus className="mr-1.5 size-4" aria-hidden="true" />
                          {isConnecting ? 'Connecting...' : 'Connect as alternative'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 text-xs text-muted-foreground hover:text-foreground flex-1 sm:flex-initial"
                          onClick={() => void handleDismissSuggestion(suggestion)}
                          disabled={isConnecting || isDismissing}
                          title="Dismiss this suggestion for this want"
                        >
                          <X className="mr-1 size-3.5" aria-hidden="true" />
                          {isDismissing ? 'Dismissing...' : 'Dismiss for this want'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Dismissed Suggestions Sub-section */}
        {showDismissed && dismissedSuggestions.length > 0 ? (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dismissed for this want ({dismissedSuggestions.length})
            </h4>
            <div className="space-y-2">
              {dismissedSuggestions.map((item) => {
                const isUndoing = undoInProgressId === item.feedback?.id;

                return (
                  <Card key={item.id} className="border-dashed bg-muted/20">
                    <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{item.item.name}</span>
                          <Badge
                            variant="outline"
                            className="text-xs text-muted-foreground font-normal"
                          >
                            Dismissed
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.explanation}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11 text-xs shrink-0"
                        onClick={() => void handleUndoDismissal(item)}
                        disabled={isUndoing}
                      >
                        <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                        {isUndoing ? 'Restoring...' : 'Undo dismissal'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* Section 3: Search Inventory & Connect */}
      <section
        ref={searchSectionRef}
        aria-labelledby={`${componentId}-search-heading`}
        className="space-y-4 pt-4 border-t"
      >
        <div>
          <h3 id={`${componentId}-search-heading`} className="text-lg font-semibold tracking-tight">
            Search your inventory
          </h3>
          <p className="text-sm text-muted-foreground">
            Search your possessions to connect items that may serve a similar purpose.
          </p>
        </div>

        {/* Search Bar & Unavailable filter */}
        <Card className="shadow-sm">
          <CardContent className="p-4 space-y-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by possession name, brand, or model..."
                className="pl-9 h-11 text-base sm:text-sm"
                aria-label="Search possessions"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id={`${componentId}-include-unavailable`}
                checked={includeUnavailable}
                onCheckedChange={(checked) => setIncludeUnavailable(Boolean(checked))}
              />
              <Label
                htmlFor={`${componentId}-include-unavailable`}
                className="min-h-11 flex-1 text-xs sm:text-sm font-normal text-muted-foreground cursor-pointer"
              >
                Include unavailable or worn-out possessions (sold, donated, disposed, lost,
                returned, worn out)
              </Label>
            </div>
          </CardContent>
        </Card>

        {addError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
          >
            {addError}
          </div>
        ) : null}

        {candidatesError ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-card p-4 text-sm text-destructive"
          >
            <p>{candidatesError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => {
                setIsLoadingCandidates(true);
                loadCandidatesData();
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              Retry search
            </Button>
          </div>
        ) : null}

        {/* Candidates List */}
        {isLoadingCandidates ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : candidates.length === 0 ? (
          <Card className="border-dashed bg-muted/10">
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyTitle>No possessions found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery.trim()
                    ? `No possessions matched “${searchQuery}”. Try a different search term or check unavailable items.`
                    : 'No active possessions in your household inventory yet.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          <div className="space-y-3">
            {candidates.map((candidate) => {
              const isMatched =
                candidate.isAlreadyMatched || matches.some((m) => m.itemId === candidate.id);
              const isAddingThis = addingItemId === candidate.id;
              const defaultReason = candidate.suggestedReason;
              const currentReasonValue =
                candidateReasons[candidate.id] !== undefined
                  ? candidateReasons[candidate.id]
                  : defaultReason;

              return (
                <Card
                  key={candidate.id}
                  className={`border transition-colors ${
                    isMatched ? 'bg-muted/30 border-muted' : 'bg-card hover:border-foreground/20'
                  }`}
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row gap-4 items-start justify-between">
                      <div className="flex gap-3 sm:gap-4 flex-1 min-w-0">
                        {/* Cover thumbnail */}
                        <div className="relative size-14 sm:size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                          <ItemCover
                            cover={
                              candidate.cover
                                ? photoSource(
                                    candidate.id,
                                    {
                                      id: candidate.cover.photoId,
                                      width: candidate.cover.width,
                                      height: candidate.cover.height,
                                    },
                                    candidate.cover.decorative
                                      ? ''
                                      : (candidate.cover.altText ?? candidate.name),
                                    '(max-width: 640px) 56px, 64px',
                                  )
                                : null
                            }
                            emptyLabel="No photo"
                            className="size-full aspect-square"
                          />
                        </div>

                        {/* Candidate info */}
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-base leading-snug break-words">
                              {candidate.name}
                            </h4>
                            {candidate.brand || candidate.model ? (
                              <span className="text-xs text-muted-foreground">
                                {[candidate.brand, candidate.model].filter(Boolean).join(' • ')}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {candidate.categoryName ? (
                              <Badge variant="secondary" className="font-normal">
                                {candidate.categoryName}
                              </Badge>
                            ) : null}
                            {candidate.ownershipStatus !== 'owned' ? (
                              <Badge
                                variant="outline"
                                className="font-normal text-muted-foreground"
                              >
                                Status: {candidate.ownershipStatus}
                              </Badge>
                            ) : null}
                            {candidate.condition && candidate.condition !== 'unknown' ? (
                              <Badge variant="secondary" className="font-normal">
                                Condition: {candidate.condition.replace(/_/g, ' ')}
                              </Badge>
                            ) : null}
                          </div>

                          {/* Custom reason input for un-matched candidates */}
                          {!isMatched ? (
                            <div className="pt-2">
                              <Label
                                htmlFor={`candidate-reason-${candidate.id}`}
                                className="text-xs text-muted-foreground"
                              >
                                Explanation / why it may serve this purpose:
                              </Label>
                              <Input
                                id={`candidate-reason-${candidate.id}`}
                                value={currentReasonValue}
                                onChange={(e) =>
                                  setCandidateReasons((prev) => ({
                                    ...prev,
                                    [candidate.id]: e.target.value,
                                  }))
                                }
                                placeholder="Why might this possession serve a similar purpose?"
                                maxLength={1000}
                                className="mt-1 h-9 text-xs"
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Connect Button or Connected Status */}
                      <div className="shrink-0 self-end sm:self-start pt-2 sm:pt-0">
                        {isMatched ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2 px-3 bg-muted rounded-md font-medium">
                            <Check className="size-3.5 text-primary" aria-hidden="true" />
                            Connected
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            className="min-h-11 px-3"
                            disabled={isAddingThis}
                            onClick={() => void handleAddMatch(candidate)}
                            aria-label={`Connect ${candidate.name} as a potential alternative`}
                          >
                            <Sparkles className="size-3.5 mr-1.5" aria-hidden="true" />
                            {isAddingThis ? 'Connecting...' : 'Connect'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Decision Continuation Footer */}
      <Card className="border-muted bg-muted/10">
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-0.5 text-center sm:text-left">
            <p className="font-medium text-sm">Ready to return to your wants?</p>
            <p className="text-xs text-muted-foreground">
              Your connected possessions are saved automatically. You can revisit or adjust them at
              any time.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="default" className="min-h-11">
              <Link href="/wants">Back to wants</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
