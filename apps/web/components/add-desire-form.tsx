'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  popularCurrencies,
  type CreateDesireRequest,
  type Desire,
  type DesireClassification,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  PlusCircle,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { amountEntryToMinor } from './money-entry';
import {
  createDesire,
  uploadDesirePhoto,
  selectionError,
  classificationInfo,
  waitingPresets,
  type WaitingPresetKey,
  type UploadPhotoOutcome,
  DesireRequestError,
} from './desires-client';
import {
  formatLikelyPrice,
  formatReviewDateTime,
  validateProductUrlString,
} from './desire-presentation';

export function AddDesireForm(): ReactElement {
  const router = useRouter();
  const formId = useId();
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Core field
  const [name, setName] = useState('');

  // Progressive disclosure sections
  const [showClassification, setShowClassification] = useState(false);
  const [classification, setClassification] = useState<DesireClassification | null>(null);

  const [showPrice, setShowPrice] = useState(false);
  const [priceDisplay, setPriceDisplay] = useState('');
  const [currency, setCurrency] = useState('INR');

  const [showWaiting, setShowWaiting] = useState(false);
  const [waitingPreset, setWaitingPreset] = useState<WaitingPresetKey>('none');
  const [customDateTime, setCustomDateTime] = useState('');

  const [showProductUrl, setShowProductUrl] = useState(false);
  const [productUrl, setProductUrl] = useState('');

  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');

  const [showPhoto, setShowPhoto] = useState(false);
  const [stagedPhoto, setStagedPhoto] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<number | null>(null);
  const [photoUploadId, setPhotoUploadId] = useState<string>('');
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);

  // Validation & status
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdDesire, setCreatedDesire] = useState<Desire | null>(null);

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
    setPhotoUploadError(null);
    if (!file) {
      setStagedPhoto(null);
      return;
    }
    const err = selectionError(file);
    if (err) {
      setValidationErrors((prev) => ({ ...prev, photo: err }));
      setStagedPhoto(null);
      return;
    }
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next.photo;
      return next;
    });
    setStagedPhoto(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoUploadId(crypto.randomUUID());
  };

  const handleRemovePhoto = (): void => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setStagedPhoto(null);
    setPhotoPreviewUrl(null);
    setPhotoUploadId('');
    setPhotoUploadError(null);
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next.photo;
      return next;
    });
  };

  const calculateReviewAt = (): string | null => {
    if (waitingPreset === 'none') return null;
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

    if (waitingPreset === 'custom') {
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
      const photoErr = selectionError(stagedPhoto);
      if (photoErr) errors.photo = photoErr;
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
    setServerError(null);
    setPhotoUploadError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const trimmedName = name.trim();
      let likelyPriceMinor: string | null = null;
      if (priceDisplay.trim()) {
        likelyPriceMinor = amountEntryToMinor(priceDisplay, currency);
      }

      let cleanUrl: string | null = null;
      if (productUrl.trim()) {
        const urlCheck = validateProductUrlString(productUrl);
        if (urlCheck.ok) cleanUrl = urlCheck.clean;
      }

      const reviewAtIso = calculateReviewAt();
      const waitingPeriod: WaitingPeriodInput | null = reviewAtIso
        ? { reviewAt: reviewAtIso }
        : null;

      const payload: CreateDesireRequest = {
        name: trimmedName,
        classification: classification ?? null,
        likelyPriceMinor: likelyPriceMinor,
        currency: likelyPriceMinor ? currency : null,
        productUrl: cleanUrl,
        reason: reason.trim() ? reason.trim() : null,
        waitingPeriod,
      };

      const desire = await createDesire(payload);
      setCreatedDesire(desire);

      // If there is an attached photo, upload it
      if (stagedPhoto) {
        setPhotoUploadProgress(0);
        const uploadResult: UploadPhotoOutcome = await uploadDesirePhoto(
          desire.id,
          stagedPhoto,
          photoUploadId || crypto.randomUUID(),
          (percent) => setPhotoUploadProgress(percent),
        );

        if (!uploadResult.ok) {
          setPhotoUploadError(uploadResult.message);
        } else {
          setCreatedDesire((prev) => (prev ? { ...prev, photo: uploadResult.photo } : prev));
        }
      }
    } catch (err) {
      if (err instanceof DesireRequestError) {
        setServerError(err.message);
      } else {
        setServerError('Could not save this desire. Check your connection and try again.');
      }
      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 50);
    } finally {
      setIsSubmitting(false);
      setPhotoUploadProgress(null);
    }
  };

  const handleRetryPhotoUpload = async (): Promise<void> => {
    if (!createdDesire || !stagedPhoto) return;
    setPhotoUploadError(null);
    setPhotoUploadProgress(0);

    const result = await uploadDesirePhoto(
      createdDesire.id,
      stagedPhoto,
      photoUploadId,
      (percent) => setPhotoUploadProgress(percent),
    );

    if (result.ok) {
      setCreatedDesire((prev) => (prev ? { ...prev, photo: result.photo } : prev));
      setStagedPhoto(null);
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      setPhotoPreviewUrl(null);
    } else {
      setPhotoUploadError(result.message);
    }
    setPhotoUploadProgress(null);
  };

  const handleResetForNew = (): void => {
    setName('');
    setClassification(null);
    setShowClassification(false);
    setPriceDisplay('');
    setCurrency('INR');
    setShowPrice(false);
    setWaitingPreset('none');
    setCustomDateTime('');
    setShowWaiting(false);
    setProductUrl('');
    setShowProductUrl(false);
    setReason('');
    setShowReason(false);
    handleRemovePhoto();
    setShowPhoto(false);
    setValidationErrors({});
    setServerError(null);
    setCreatedDesire(null);
  };

  // Success view
  if (createdDesire) {
    const formattedPrice = formatLikelyPrice(
      createdDesire.likelyPriceMinor,
      createdDesire.currency,
    );
    const reviewFormatted = formatReviewDateTime(createdDesire.reviewAt);

    return (
      <Card className="mx-auto w-full max-w-xl shadow-sm" role="status">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="size-6 text-foreground" aria-hidden="true" />
          </div>
          <CardTitle role="heading" aria-level={2} className="text-xl sm:text-2xl font-semibold">
            {createdDesire.name} saved to your wants
          </CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Recorded for calm reflection without shame or pressure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            {createdDesire.classification ? (
              <Badge variant="secondary">
                {classificationInfo[createdDesire.classification].label}
              </Badge>
            ) : null}
            <Badge variant="outline">{formattedPrice}</Badge>
            <Badge variant="outline">
              {createdDesire.effectiveState === 'waiting' && reviewFormatted
                ? `Review: ${reviewFormatted}`
                : createdDesire.effectiveState === 'ready_for_review'
                  ? 'Ready to review'
                  : 'Considering'}
            </Badge>
          </div>

          {photoUploadError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-2">
                  <p className="font-medium">
                    Your desire was saved, but the photo could not be uploaded.
                  </p>
                  <p className="text-xs text-muted-foreground">{photoUploadError}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 border-destructive/30"
                    onClick={() => void handleRetryPhotoUpload()}
                    disabled={photoUploadProgress !== null}
                  >
                    <RotateCcw className="mr-2 size-4" aria-hidden="true" />
                    Retry photo upload
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3 pt-2">
            <Button asChild className="h-11 w-full justify-start gap-3 text-base">
              <Link href="/wants">
                <Eye className="size-5" aria-hidden="true" />
                View all wants
              </Link>
            </Button>
          </div>
        </CardContent>
        <CardFooter className="justify-center border-t pt-4">
          <Button
            variant="ghost"
            className="h-11 text-sm text-muted-foreground hover:text-foreground"
            onClick={handleResetForNew}
          >
            <PlusCircle className="mr-2 size-4" aria-hidden="true" />
            Add another desire
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const hasErrors = Object.keys(validationErrors).length > 0 || Boolean(serverError);

  return (
    <Card className="mx-auto w-full max-w-xl shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl sm:text-2xl font-semibold">Record a desire</CardTitle>
        <CardDescription className="text-sm">
          Give yourself time to consider what you want without judgment. Manual entry requires only
          a name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={`${formId}-form`}
          noValidate
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-6"
        >
          {/* Accessible Validation Summary */}
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

          {/* 1. Name (Required) */}
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
              placeholder="e.g. Espresso machine, Noise-cancelling headphones, Camping tent"
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

          {/* Progressive Disclosure Section: Classification */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowClassification((prev) => !prev)}
              aria-expanded={showClassification}
              aria-controls={`${formId}-classification-section`}
            >
              <span>
                Need / Want / Greed classification{' '}
                <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </span>
              {showClassification ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showClassification ? (
              <div
                id={`${formId}-classification-section`}
                className="space-y-3 pt-2"
                role="radiogroup"
                aria-label="Need, Want or Greed classification"
              >
                <p className="text-xs text-muted-foreground">
                  Reflect on where this fits for you right now. None of these choices are wrong.
                </p>
                <div className="grid gap-2">
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
                {classification ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setClassification(null)}
                  >
                    <X className="mr-1 size-3" aria-hidden="true" />
                    Clear classification
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Progressive Disclosure Section: Likely Price */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowPrice((prev) => !prev)}
              aria-expanded={showPrice}
              aria-controls={`${formId}-price-section`}
            >
              <span>
                Likely price — optional{' '}
                <span className="text-xs text-muted-foreground font-normal">(estimate)</span>
              </span>
              {showPrice ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showPrice ? (
              <div id={`${formId}-price-section`} className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  This is an estimate for reflection, not an amount paid or saved.
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
                      aria-describedby={
                        validationErrors.price ? `${formId}-price-error` : undefined
                      }
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
                {validationErrors.price ? (
                  <p id={`${formId}-price-error`} className="text-xs text-destructive">
                    {validationErrors.price}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Progressive Disclosure Section: Waiting Period */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowWaiting((prev) => !prev)}
              aria-expanded={showWaiting}
              aria-controls={`${formId}-waiting-section`}
            >
              <span>
                Waiting period{' '}
                <span className="text-xs text-muted-foreground font-normal">(optional delay)</span>
              </span>
              {showWaiting ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showWaiting ? (
              <div id={`${formId}-waiting-section`} className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Give yourself breathing room before reviewing whether to purchase.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {waitingPresets.map((preset) => {
                    const isSelected = waitingPreset === preset.key;
                    return (
                      <Button
                        key={preset.key}
                        type="button"
                        variant={isSelected ? 'secondary' : 'outline'}
                        className={`min-h-11 text-xs justify-center ${
                          isSelected ? 'font-semibold border-primary' : ''
                        }`}
                        onClick={() => {
                          setWaitingPreset(preset.key);
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

                {waitingPreset !== 'none' && calculateReviewAt() ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded">
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    <span>
                      Review on: <strong>{formatReviewDateTime(calculateReviewAt())}</strong>
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

          {/* Progressive Disclosure Section: Product Link */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowProductUrl((prev) => !prev)}
              aria-expanded={showProductUrl}
              aria-controls={`${formId}-link-section`}
            >
              <span>
                Product link{' '}
                <span className="text-xs text-muted-foreground font-normal">(optional URL)</span>
              </span>
              {showProductUrl ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showProductUrl ? (
              <div id={`${formId}-link-section`} className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  Optional link for reference. Havefolio never scrapes or auto-fills from external
                  sites.
                </p>
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
            ) : null}
          </div>

          {/* Progressive Disclosure Section: Reason */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowReason((prev) => !prev)}
              aria-expanded={showReason}
              aria-controls={`${formId}-reason-section`}
            >
              <span>
                Private reason{' '}
                <span className="text-xs text-muted-foreground font-normal">(why you want it)</span>
              </span>
              {showReason ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showReason ? (
              <div id={`${formId}-reason-section`} className="space-y-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  Private thoughts for yourself. Never logged or sent to telemetry.
                </p>
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
            ) : null}
          </div>

          {/* Progressive Disclosure Section: Photo */}
          <div className="rounded-lg border p-4 space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left font-medium text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-11"
              onClick={() => setShowPhoto((prev) => !prev)}
              aria-expanded={showPhoto}
              aria-controls={`${formId}-photo-section`}
            >
              <span>
                Private photo{' '}
                <span className="text-xs text-muted-foreground font-normal">(optional image)</span>
              </span>
              {showPhoto ? (
                <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </button>

            {showPhoto ? (
              <div id={`${formId}-photo-section`} className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG or WebP, up to 10 MiB. Stored securely and only visible to you.
                </p>

                {photoPreviewUrl ? (
                  <div className="relative aspect-video w-full max-w-xs overflow-hidden rounded-lg border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoPreviewUrl}
                      alt={name ? `Preview for ${name}` : 'Desire preview'}
                      className="h-full w-full object-contain"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute right-2 top-2 size-8 rounded-full shadow"
                      onClick={handleRemovePhoto}
                      aria-label="Remove staged photo"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Label
                      htmlFor={`${formId}-photo-file`}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    >
                      <Upload className="size-4" aria-hidden="true" />
                      Choose photo
                      <input
                        id={`${formId}-photo-file`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(e) => handlePhotoSelect(e.target.files?.[0] ?? null)}
                      />
                    </Label>
                    <Label
                      htmlFor={`${formId}-photo-camera`}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    >
                      <Camera className="size-4" aria-hidden="true" />
                      Take photo
                      <input
                        id={`${formId}-photo-camera`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        className="sr-only"
                        onChange={(e) => handlePhotoSelect(e.target.files?.[0] ?? null)}
                      />
                    </Label>
                  </div>
                )}

                {photoUploadProgress !== null ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Uploading photo...</span>
                      <span>{photoUploadProgress}%</span>
                    </div>
                    <Progress value={photoUploadProgress} className="h-2" />
                  </div>
                ) : null}

                {validationErrors.photo ? (
                  <p id={`${formId}-photo-error`} className="text-xs text-destructive">
                    {validationErrors.photo}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t">
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
              {isSubmitting ? 'Saving desire...' : 'Save desire'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
