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
import { useRouter } from 'next/navigation';
import {
  popularCurrencies,
  type Desire,
  type DesireClassification,
  type PatchDesireRequest,
  type WaitingPeriodInput,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Textarea } from '@havefolio/ui/components/textarea';
import { Badge } from '@havefolio/ui/components/badge';
import { Progress } from '@havefolio/ui/components/progress';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
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
import { Boxes, Camera, Clock, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { amountEntryToMinor, minorToAmountEntry } from './money-entry';
import {
  deleteDesire,
  deleteDesirePhoto,
  desirePhotoSource,
  getDesire,
  selectionError,
  updateDesire,
  uploadDesirePhoto,
  waitingPresets,
  classificationInfo,
  type WaitingPresetKey,
  DesireRequestError,
} from './desires-client';
import { formatReviewDateTime, validateProductUrlString } from './desire-presentation';

export function EditDesireForm({ desireId }: { desireId: string }): ReactElement {
  const router = useRouter();
  const formId = useId();
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Loading initial desire
  const [desire, setDesire] = useState<Desire | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [classification, setClassification] = useState<DesireClassification | null>(null);
  const [priceDisplay, setPriceDisplay] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [productUrl, setProductUrl] = useState('');
  const [reason, setReason] = useState('');

  // Waiting period edit state
  // 'preserve' means no change to current waiting period;
  // 'cancel' means send null;
  // 'preset' / 'custom' means send new waiting period.
  const [waitingAction, setWaitingAction] = useState<'preserve' | 'cancel' | 'update'>('preserve');
  const [waitingPreset, setWaitingPreset] = useState<WaitingPresetKey>('24h');
  const [customDateTime, setCustomDateTime] = useState('');

  // Photo management state
  const [isPhotoStaged, setIsPhotoStaged] = useState(false);
  const [stagedPhoto, setStagedPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);

  // Conflict / stale state
  const [staleError, setStaleError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch desire on mount
  const loadDesire = useCallback((id: string): void => {
    getDesire(id)
      .then((data) => {
        setDesire(data);
        setName(data.name);
        setClassification(data.classification);
        setCurrency(data.currency || 'INR');
        setPriceDisplay(
          data.likelyPriceMinor && data.currency
            ? minorToAmountEntry(data.likelyPriceMinor, data.currency)
            : '',
        );
        setProductUrl(data.productUrl || '');
        setReason(data.reason || '');
        setWaitingAction('preserve');
        setStaleError(null);
        setLoadError(null);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DesireRequestError) {
          setLoadError(err.message);
        } else {
          setLoadError('Could not load this desire. Try again.');
        }
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    loadDesire(desireId);
  }, [desireId, loadDesire]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const handlePhotoSelect = (file: File | null): void => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
      setPhotoPreviewUrl(null);
    }
    setPhotoError(null);
    if (!file) {
      setStagedPhoto(null);
      setIsPhotoStaged(false);
      return;
    }
    const err = selectionError(file);
    if (err) {
      setValidationErrors((prev) => ({ ...prev, photo: err }));
      setStagedPhoto(null);
      setIsPhotoStaged(false);
      return;
    }
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next.photo;
      return next;
    });
    setStagedPhoto(file);
    setIsPhotoStaged(true);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const handleCancelStagedPhoto = (): void => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setStagedPhoto(null);
    setIsPhotoStaged(false);
    setPhotoPreviewUrl(null);
    setPhotoError(null);
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next.photo;
      return next;
    });
  };

  const handleRemoveExistingPhoto = async (): Promise<void> => {
    if (!desire) return;
    setIsRemovingPhoto(true);
    setPhotoError(null);
    try {
      const res = await deleteDesirePhoto(desire.id, desire.revision);
      setDesire((prev) =>
        prev
          ? {
              ...prev,
              photo: null,
              revision: res.revision,
            }
          : null,
      );
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setPhotoError(err.message);
      } else {
        setPhotoError('Could not remove photo. Try again.');
      }
    } finally {
      setIsRemovingPhoto(false);
    }
  };

  const calculateReviewAt = (): string | null => {
    if (waitingAction !== 'update') return null;
    if (waitingPreset === 'custom') {
      if (!customDateTime) return null;
      const parsed = new Date(customDateTime);
      if (!Number.isFinite(parsed.getTime())) return null;
      return parsed.toISOString();
    }
    const preset = waitingPresets.find((p) => p.key === waitingPreset);
    return preset ? preset.deriveReviewAt() : null;
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = 'Enter a name for what you are considering.';
    } else if (trimmedName.length > 300) {
      errors.name = 'Name must be 300 characters or fewer.';
    }

    if (priceDisplay.trim()) {
      try {
        amountEntryToMinor(priceDisplay, currency);
      } catch (err) {
        errors.price = err instanceof Error ? err.message : 'Invalid price.';
      }
    }

    if (productUrl.trim()) {
      const urlCheck = validateProductUrlString(productUrl);
      if (!urlCheck.ok) {
        errors.productUrl = urlCheck.error;
      }
    }

    if (reason.length > 2000) {
      errors.reason = 'Reason must be 2000 characters or fewer.';
    }

    if (waitingAction === 'update' && waitingPreset === 'custom') {
      if (!customDateTime) {
        errors.waiting = 'Select a custom date and time for review.';
      } else {
        const customDate = new Date(customDateTime);
        if (!Number.isFinite(customDate.getTime())) {
          errors.waiting = 'Choose a valid review date and time.';
        } else if (customDate.getTime() <= Date.now()) {
          errors.waiting = 'Review date and time must be in the future.';
        }
      }
    }

    if (stagedPhoto) {
      const pErr = selectionError(stagedPhoto);
      if (pErr) errors.photo = pErr;
    }

    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 50);
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!desire) return;

    setServerError(null);
    setStaleError(null);
    setPhotoError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const trimmedName = name.trim();
      let likelyPriceMinor: string | null = null;
      let targetCurrency: string | null = null;

      if (priceDisplay.trim()) {
        likelyPriceMinor = amountEntryToMinor(priceDisplay, currency);
        targetCurrency = currency;
      }

      let cleanUrl: string | null = null;
      if (productUrl.trim()) {
        const urlCheck = validateProductUrlString(productUrl);
        if (urlCheck.ok) cleanUrl = urlCheck.clean;
      }

      const patchPayload: PatchDesireRequest = {
        revision: desire.revision,
        name: trimmedName,
        classification: classification,
        likelyPriceMinor: likelyPriceMinor,
        currency: targetCurrency,
        productUrl: cleanUrl,
        reason: reason.trim() ? reason.trim() : null,
      };

      if (waitingAction === 'cancel') {
        patchPayload.waitingPeriod = null;
      } else if (waitingAction === 'update') {
        const reviewAtIso = calculateReviewAt();
        if (reviewAtIso) {
          const waitingInput: WaitingPeriodInput = { reviewAt: reviewAtIso };
          // If desire was already waiting, the API preserves startedAt when not supplied
          patchPayload.waitingPeriod = waitingInput;
        }
      }

      let updated = await updateDesire(desire.id, patchPayload);

      // If photo was staged, upload it
      if (stagedPhoto) {
        setPhotoProgress(0);
        const uploadResult = await uploadDesirePhoto(
          desire.id,
          stagedPhoto,
          crypto.randomUUID(),
          (pct) => setPhotoProgress(pct),
        );

        if (uploadResult.ok) {
          updated = { ...updated, photo: uploadResult.photo };
          handleCancelStagedPhoto();
        } else {
          setPhotoError(uploadResult.message);
        }
      }

      setDesire(updated);
      router.push('/wants');
    } catch (err) {
      if (err instanceof DesireRequestError) {
        if (err.stale) {
          setStaleError(
            'This desire was modified elsewhere. Your unsaved edits are preserved below. Review the changes or reload the latest record.',
          );
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError('Could not update desire. Try again.');
      }
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 50);
    } finally {
      setIsSubmitting(false);
      setPhotoProgress(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!desire) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDesire(desire.id, desire.revision);
      setDeleteDialogOpen(false);
      router.push('/wants');
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

  if (isLoading) {
    return (
      <Card className="mx-auto w-full max-w-xl shadow-sm">
        <CardHeader className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (loadError || !desire) {
    return (
      <Card className="mx-auto w-full max-w-xl border-destructive/30 shadow-sm" role="alert">
        <CardHeader>
          <CardTitle className="text-destructive font-semibold">Unable to load desire</CardTitle>
          <CardDescription>{loadError || 'Desire not found.'}</CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              loadDesire(desireId);
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

  const hasErrors =
    Object.keys(validationErrors).length > 0 || Boolean(serverError) || Boolean(staleError);

  return (
    <Card className="mx-auto w-full max-w-xl shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-xl sm:text-2xl font-semibold">Edit desire</CardTitle>
            <CardDescription className="text-sm">
              Reflect on your current thoughts and adjust this record as needed.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="min-h-9 text-xs">
              <Link href={`/wants/${desire.id}/matches`}>
                <Boxes className="mr-1.5 size-3.5" aria-hidden="true" />
                Matches
              </Link>
            </Button>
            <Badge variant="outline" className="text-xs">
              Rev {desire.revision}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form
          id={`${formId}-form`}
          noValidate
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-6"
        >
          {/* Accessible Validation / Conflict Summary */}
          {hasErrors ? (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              aria-live="polite"
              className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <h2 className="font-semibold leading-none">
                Please check the following before saving:
              </h2>
              <ul className="mt-2 ml-4 list-disc space-y-1">
                {staleError ? (
                  <li className="space-y-2">
                    <span>{staleError}</span>
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 border-destructive/30"
                        onClick={() => {
                          setIsLoading(true);
                          loadDesire(desireId);
                        }}
                      >
                        <RotateCcw className="mr-1 size-3" aria-hidden="true" />
                        Reload latest version
                      </Button>
                    </div>
                  </li>
                ) : null}
                {serverError ? <li>{serverError}</li> : null}
                {Object.entries(validationErrors).map(([key, err]) => (
                  <li key={key}>
                    <a
                      href={`#${formId}-${key}`}
                      className="underline underline-offset-2 hover:opacity-80"
                      onClick={(ev) => {
                        ev.preventDefault();
                        const el = document.getElementById(`${formId}-${key}`);
                        el?.focus();
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >
                      {err}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 1. Name */}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`} className="text-sm font-medium">
              What are you considering? <span className="text-destructive">*</span>
            </Label>
            <Input
              id={`${formId}-name`}
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (validationErrors.name) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.name;
                    return next;
                  });
                }
              }}
              className="h-11 text-base sm:text-sm"
              aria-invalid={Boolean(validationErrors.name)}
              aria-describedby={validationErrors.name ? `${formId}-name-error` : undefined}
            />
            {validationErrors.name ? (
              <p id={`${formId}-name-error`} className="text-xs text-destructive">
                {validationErrors.name}
              </p>
            ) : null}
          </div>

          {/* 2. Classification */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Need / Want / Greed classification</Label>
              {classification ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setClassification(null)}
                >
                  <X className="mr-1 size-3" aria-hidden="true" />
                  Clear
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional reflection. You can change or clear this classification at any time.
            </p>
            <div
              className="grid gap-2"
              role="radiogroup"
              aria-label="Need, Want or Greed classification"
            >
              {(['need', 'want', 'greed'] as const).map((key) => {
                const info = classificationInfo[key];
                const isSelected = classification === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-colors min-h-11 ${
                      isSelected
                        ? 'border-primary bg-accent/50 text-accent-foreground ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-muted/50'
                    }`}
                    onClick={() => setClassification(key)}
                  >
                    <span className="text-sm font-semibold">{info.label}</span>
                    <span className="text-xs text-muted-foreground">{info.explanation}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Likely Price */}
          <div className="space-y-3 rounded-lg border p-4">
            <Label className="text-sm font-medium">Likely price — optional (estimate)</Label>
            <p className="text-xs text-muted-foreground">
              This is an estimate for reflection, not an amount paid or saved. Clear both to remove
              the price.
            </p>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${formId}-price`} className="text-xs font-medium">
                  Estimated amount
                </Label>
                <Input
                  id={`${formId}-price`}
                  type="text"
                  inputMode="decimal"
                  value={priceDisplay}
                  onChange={(e) => {
                    setPriceDisplay(e.target.value);
                    if (validationErrors.price) {
                      setValidationErrors((prev) => {
                        const next = { ...prev };
                        delete next.price;
                        return next;
                      });
                    }
                  }}
                  placeholder="e.g. 14,999"
                  className="h-11 text-base sm:text-sm"
                  aria-invalid={Boolean(validationErrors.price)}
                  aria-describedby={validationErrors.price ? `${formId}-price-error` : undefined}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-currency`} className="text-xs font-medium">
                  Currency
                </Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id={`${formId}-currency`} className="h-11 text-sm">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {popularCurrencies.map((c) => (
                      <SelectItem key={c.code} value={c.code} className="min-h-11">
                        {c.code} ({c.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {priceDisplay ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setPriceDisplay('')}
              >
                <X className="mr-1 size-3" aria-hidden="true" />
                Clear price
              </Button>
            ) : null}
            {validationErrors.price ? (
              <p id={`${formId}-price-error`} className="text-xs text-destructive">
                {validationErrors.price}
              </p>
            ) : null}
          </div>

          {/* 4. Waiting Period */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Waiting period</Label>
              <Badge variant="outline" className="text-xs">
                {desire.effectiveState === 'waiting'
                  ? 'Currently waiting'
                  : desire.effectiveState === 'ready_for_review'
                    ? 'Ready for review'
                    : 'Considering'}
              </Badge>
            </div>

            {desire.reviewAt ? (
              <div className="rounded bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  Current review scheduled for:{' '}
                  <strong>{formatReviewDateTime(desire.reviewAt)}</strong>
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No waiting period is currently set for this desire.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant={waitingAction === 'preserve' ? 'secondary' : 'outline'}
                className="min-h-11 text-xs"
                onClick={() => setWaitingAction('preserve')}
              >
                Keep current
              </Button>
              {desire.reviewAt ? (
                <Button
                  type="button"
                  variant={waitingAction === 'cancel' ? 'secondary' : 'outline'}
                  className="min-h-11 text-xs"
                  onClick={() => setWaitingAction('cancel')}
                >
                  Cancel waiting period
                </Button>
              ) : null}
              <Button
                type="button"
                variant={waitingAction === 'update' ? 'secondary' : 'outline'}
                className="min-h-11 text-xs"
                onClick={() => setWaitingAction('update')}
              >
                {desire.reviewAt ? 'Change review time' : 'Start waiting period'}
              </Button>
            </div>

            {waitingAction === 'update' ? (
              <div className="space-y-3 pt-2 border-t">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['24h', '7d', '30d', 'custom'] as const).map((key) => {
                    const preset = waitingPresets.find((p) => p.key === key);
                    if (!preset) return null;
                    const isSelected = waitingPreset === key;
                    return (
                      <Button
                        key={key}
                        type="button"
                        variant={isSelected ? 'secondary' : 'outline'}
                        className={`min-h-11 text-xs ${
                          isSelected ? 'font-semibold border-primary' : ''
                        }`}
                        onClick={() => {
                          setWaitingPreset(key);
                          if (validationErrors.waiting) {
                            setValidationErrors((prev) => {
                              const next = { ...prev };
                              delete next.waiting;
                              return next;
                            });
                          }
                        }}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>

                {waitingPreset === 'custom' ? (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor={`${formId}-custom-date`} className="text-xs font-medium">
                      Review date & time (local time)
                    </Label>
                    <Input
                      id={`${formId}-custom-date`}
                      type="datetime-local"
                      value={customDateTime}
                      onChange={(e) => {
                        setCustomDateTime(e.target.value);
                        if (validationErrors.waiting) {
                          setValidationErrors((prev) => {
                            const next = { ...prev };
                            delete next.waiting;
                            return next;
                          });
                        }
                      }}
                      className="h-11 text-base sm:text-sm"
                      aria-invalid={Boolean(validationErrors.waiting)}
                      aria-describedby={
                        validationErrors.waiting ? `${formId}-waiting-error` : undefined
                      }
                    />
                  </div>
                ) : null}

                {calculateReviewAt() ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded">
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    <span>
                      New review on: <strong>{formatReviewDateTime(calculateReviewAt())}</strong>
                    </span>
                  </div>
                ) : null}

                {validationErrors.waiting ? (
                  <p id={`${formId}-waiting-error`} className="text-xs text-destructive">
                    {validationErrors.waiting}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 5. Product Link */}
          <div className="space-y-2 rounded-lg border p-4">
            <Label htmlFor={`${formId}-productUrl`} className="text-sm font-medium">
              Product link{' '}
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id={`${formId}-productUrl`}
              type="url"
              value={productUrl}
              onChange={(e) => {
                setProductUrl(e.target.value);
                if (validationErrors.productUrl) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.productUrl;
                    return next;
                  });
                }
              }}
              placeholder="https://example.com/item"
              className="h-11 text-base sm:text-sm"
              aria-invalid={Boolean(validationErrors.productUrl)}
              aria-describedby={
                validationErrors.productUrl ? `${formId}-productUrl-error` : undefined
              }
            />
            {validationErrors.productUrl ? (
              <p id={`${formId}-productUrl-error`} className="text-xs text-destructive">
                {validationErrors.productUrl}
              </p>
            ) : null}
          </div>

          {/* 6. Reason */}
          <div className="space-y-2 rounded-lg border p-4">
            <Label htmlFor={`${formId}-reason`} className="text-sm font-medium">
              Private reason{' '}
              <span className="text-xs text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id={`${formId}-reason`}
              value={reason}
              maxLength={2000}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationErrors.reason) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.reason;
                    return next;
                  });
                }
              }}
              placeholder="What purpose will this serve? What problem does it solve?"
              className="min-h-24 text-base sm:text-sm"
              aria-invalid={Boolean(validationErrors.reason)}
              aria-describedby={validationErrors.reason ? `${formId}-reason-error` : undefined}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{2000 - reason.length} characters remaining</span>
            </div>
            {validationErrors.reason ? (
              <p id={`${formId}-reason-error`} className="text-xs text-destructive">
                {validationErrors.reason}
              </p>
            ) : null}
          </div>

          {/* 7. Private Photo */}
          <div className="space-y-3 rounded-lg border p-4">
            <Label className="text-sm font-medium">Private photo</Label>
            <p className="text-xs text-muted-foreground">
              Stored privately and authenticated with your session.
            </p>

            {desire.photo && !isPhotoStaged ? (
              <div className="space-y-3">
                <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
                  <PrivatePhoto
                    {...desirePhotoSource(
                      desire.id,
                      desire.photo,
                      desire.name,
                      '(max-width: 640px) 100vw, 320px',
                    )}
                    fit="contain"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Label
                    htmlFor={`${formId}-replace-photo`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  >
                    <Upload className="size-4" aria-hidden="true" />
                    Replace photo
                    <input
                      id={`${formId}-replace-photo`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => handlePhotoSelect(e.target.files?.[0] ?? null)}
                    />
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => void handleRemoveExistingPhoto()}
                    disabled={isRemovingPhoto}
                  >
                    <Trash2 className="mr-1 size-3.5" aria-hidden="true" />
                    {isRemovingPhoto ? 'Removing photo...' : 'Remove photo'}
                  </Button>
                </div>
              </div>
            ) : photoPreviewUrl ? (
              <div className="space-y-2">
                <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoPreviewUrl}
                    alt="Staged photo preview"
                    className="h-full w-full object-contain"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute right-2 top-2 size-8 rounded-full shadow"
                    onClick={handleCancelStagedPhoto}
                    aria-label="Remove staged photo"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  New photo staged. It will be uploaded when you save changes.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Label
                  htmlFor={`${formId}-add-photo`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                  <Upload className="size-4" aria-hidden="true" />
                  Choose photo
                  <input
                    id={`${formId}-add-photo`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => handlePhotoSelect(e.target.files?.[0] ?? null)}
                  />
                </Label>
                <Label
                  htmlFor={`${formId}-camera-photo`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
                >
                  <Camera className="size-4" aria-hidden="true" />
                  Take photo
                  <input
                    id={`${formId}-camera-photo`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    onChange={(e) => handlePhotoSelect(e.target.files?.[0] ?? null)}
                  />
                </Label>
              </div>
            )}

            {photoProgress !== null ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Uploading photo...</span>
                  <span>{photoProgress}%</span>
                </div>
                <Progress value={photoProgress} className="h-2" />
              </div>
            ) : null}

            {photoError ? <p className="text-xs text-destructive">{photoError}</p> : null}
            {validationErrors.photo ? (
              <p id={`${formId}-photo-error`} className="text-xs text-destructive">
                {validationErrors.photo}
              </p>
            ) : null}
          </div>

          {/* Form Actions: Save, Cancel, and Delete */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t">
            {/* Delete Trigger */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-destructive hover:bg-destructive/10 justify-start sm:justify-center"
                >
                  <Trash2 className="mr-2 size-4" aria-hidden="true" />
                  Delete desire
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete desire?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove “{desire.name}” and its private photo from your
                    household index. This action cannot be undone.
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

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => router.push('/wants')}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11 font-medium" disabled={isSubmitting}>
                {isSubmitting ? 'Saving changes...' : 'Save changes'}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
