'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import {
  type CreateItemRequest,
  type DatePrecision,
  type ItemAcquisition,
  type ItemCondition,
  type ItemFrequency,
  type ItemResponse,
  type ItemStatus,
  type OwnerResponse,
  type PurchaseDate,
  type TaxonomySnapshot,
  itemAcquisitions,
  itemConditions,
  itemFrequencies,
  itemStatuses,
  popularCurrencies,
} from '@havefolio/contracts';
import { daysInMonth, formatMoney, parseMinorUnits } from '@havefolio/domain';
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
import { Checkbox } from '@havefolio/ui/components/checkbox';
import { Textarea } from '@havefolio/ui/components/textarea';
import { Badge } from '@havefolio/ui/components/badge';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileEdit,
  PlusCircle,
  RotateCcw,
} from 'lucide-react';
import { CategorySelector, TagSelector } from './taxonomy-selectors';
import { amountEntryToMinor } from './money-entry';
import { taxonomyRequest, TaxonomyRequestError } from './taxonomy-client';
import {
  createItem,
  fetchCurrentOwner,
  loadItemDraft,
  saveItemDraft,
  clearItemDraft,
  ItemRequestError,
  type ItemDraft,
} from './items-client';

const statusLabels: Record<ItemStatus, string> = {
  owned: 'Currently owned',
  sold: 'Sold',
  donated: 'Donated',
  disposed: 'Disposed of',
  lost: 'Lost',
  returned: 'Returned',
};

const acquisitionLabels: Record<ItemAcquisition, string> = {
  bought: 'Bought new',
  gift: 'Gift',
  secondhand: 'Second-hand / Used',
  other: 'Other',
  unknown: 'Not specified',
};

const conditionLabels: Record<ItemCondition, string> = {
  working: 'Working well',
  needs_repair: 'Needs repair',
  broken: 'Broken',
  unknown: 'Unknown',
};

const frequencyLabels: Record<ItemFrequency, string> = {
  often: 'Often (daily / weekly)',
  sometimes: 'Sometimes (monthly)',
  rarely: 'Rarely (a few times a year)',
  never: 'Never used',
  unknown: 'Unknown',
};

const months = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function AddItemForm(): ReactElement {
  const formId = useId();

  // Authentication & Taxonomy State
  const [owner, setOwner] = useState<OwnerResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [taxonomy, setTaxonomy] = useState<TaxonomySnapshot | null>(null);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);

  // Form Fields State
  const [name, setName] = useState('');
  const [ownershipStatus, setOwnershipStatus] = useState<ItemStatus>('owned');
  const [currency, setCurrency] = useState('INR');
  const [priceUnknown, setPriceUnknown] = useState(false);
  const [priceDisplay, setPriceDisplay] = useState('');

  // Date State
  const [dateUnknown, setDateUnknown] = useState(false);
  const [datePrecision, setDatePrecision] = useState<DatePrecision>('exact');
  const [exactDate, setExactDate] = useState(''); // YYYY-MM-DD
  const [purchaseYear, setPurchaseYear] = useState('');
  const [purchaseMonth, setPurchaseMonth] = useState('1');

  // Taxonomy fields
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [subcategoryId, setSubcategoryId] = useState<string | undefined>();
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Optional fields
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [acquisitionType, setAcquisitionType] = useState<ItemAcquisition>('bought');
  const [condition, setCondition] = useState<ItemCondition>('working');
  const [useFrequency, setUseFrequency] = useState<ItemFrequency>('often');
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  // Submission & Validation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [createdItem, setCreatedItem] = useState<ItemResponse | null>(null);

  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load initial owner and taxonomy
  useEffect(() => {
    let active = true;

    async function initialize(): Promise<void> {
      try {
        const currentOwner = await fetchCurrentOwner();
        if (!active) return;
        setOwner(currentOwner);

        if (currentOwner) {
          // Check for saved draft
          const draft = loadItemDraft(currentOwner.id);
          if (draft && active) {
            setName(draft.name || '');
            setOwnershipStatus(draft.ownershipStatus || 'owned');
            setCurrency(draft.currency || 'INR');
            setPriceUnknown(draft.priceMode === 'unknown');
            setPriceDisplay(draft.priceDisplay || '');

            setDateUnknown(draft.datePrecision === 'unknown');
            setDatePrecision(draft.datePrecision || 'exact');
            if (draft.purchaseYear && draft.purchaseMonth && draft.purchaseDay) {
              setExactDate(
                `${draft.purchaseYear.padStart(4, '0')}-${draft.purchaseMonth.padStart(2, '0')}-${draft.purchaseDay.padStart(2, '0')}`,
              );
            }
            if (draft.purchaseYear) setPurchaseYear(draft.purchaseYear);
            if (draft.purchaseMonth) setPurchaseMonth(draft.purchaseMonth);

            setCategoryId(draft.categoryId);
            setSubcategoryId(draft.subcategoryId);
            setTagIds(draft.tagIds || []);

            setBrand(draft.brand || '');
            setModel(draft.model || '');
            setDescription(draft.description || '');
            setNotes(draft.notes || '');
            if (draft.acquisitionType) setAcquisitionType(draft.acquisitionType);
            if (draft.condition) setCondition(draft.condition);
            if (draft.useFrequency) setUseFrequency(draft.useFrequency);

            if (
              draft.brand ||
              draft.model ||
              draft.description ||
              draft.notes ||
              draft.tagIds?.length
            ) {
              setShowOptionalDetails(true);
            }
            setDraftRestored(true);
          }
        }
      } finally {
        if (active) setAuthLoading(false);
      }

      try {
        const snap = await taxonomyRequest();
        if (active) setTaxonomy(snap);
      } catch (err) {
        if (active) {
          if (err instanceof TaxonomyRequestError && err.status === 401) {
            setSessionExpired(true);
          } else {
            setTaxonomyError(err instanceof Error ? err.message : 'Could not load taxonomy.');
          }
        }
      } finally {
        if (active) setTaxonomyLoading(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  // Autosave draft on changes when owner is known and form has not succeeded
  useEffect(() => {
    if (!owner || createdItem || authLoading) return;

    // Do not save an entirely blank state
    if (
      !name &&
      !priceDisplay &&
      !exactDate &&
      !purchaseYear &&
      !categoryId &&
      !brand &&
      !model &&
      !notes
    ) {
      return;
    }

    let pYear = purchaseYear;
    let pMonth = purchaseMonth;
    let pDay: string | undefined;

    if (datePrecision === 'exact' && exactDate) {
      const parts = exactDate.split('-');
      if (parts.length === 3) {
        pYear = parts[0] ?? '';
        pMonth = parts[1] ?? '';
        pDay = parts[2];
      }
    }

    const draftData: Omit<ItemDraft, 'version' | 'updatedAt'> = {
      name,
      ownershipStatus,
      currency,
      priceMode: priceUnknown ? 'unknown' : 'known',
      priceDisplay,
      datePrecision: dateUnknown ? 'unknown' : datePrecision,
      purchaseYear: pYear || undefined,
      purchaseMonth: pMonth || undefined,
      purchaseDay: pDay || undefined,
      categoryId,
      subcategoryId,
      tagIds,
      brand: brand || undefined,
      model: model || undefined,
      description: description || undefined,
      notes: notes || undefined,
      acquisitionType,
      condition,
      useFrequency,
    };

    saveItemDraft(owner.id, draftData);
  }, [
    owner,
    createdItem,
    authLoading,
    name,
    ownershipStatus,
    currency,
    priceUnknown,
    priceDisplay,
    dateUnknown,
    datePrecision,
    exactDate,
    purchaseYear,
    purchaseMonth,
    categoryId,
    subcategoryId,
    tagIds,
    brand,
    model,
    description,
    notes,
    acquisitionType,
    condition,
    useFrequency,
  ]);

  function handleDiscardDraft(): void {
    if (owner) {
      clearItemDraft(owner.id);
    }
    setName('');
    setOwnershipStatus('owned');
    setCurrency('INR');
    setPriceUnknown(false);
    setPriceDisplay('');
    setDateUnknown(false);
    setDatePrecision('exact');
    setExactDate('');
    setPurchaseYear('');
    setPurchaseMonth('1');
    setCategoryId(undefined);
    setSubcategoryId(undefined);
    setTagIds([]);
    setBrand('');
    setModel('');
    setDescription('');
    setNotes('');
    setAcquisitionType('bought');
    setCondition('working');
    setUseFrequency('often');
    setShowOptionalDetails(false);
    setValidationErrors({});
    setServerError(null);
    setDraftRestored(false);
  }

  function handleResetForNewItem(): void {
    if (owner) {
      clearItemDraft(owner.id);
    }
    setName('');
    setOwnershipStatus('owned');
    setCurrency('INR');
    setPriceUnknown(false);
    setPriceDisplay('');
    setDateUnknown(false);
    setDatePrecision('exact');
    setExactDate('');
    setPurchaseYear('');
    setPurchaseMonth('1');
    setCategoryId(undefined);
    setSubcategoryId(undefined);
    setTagIds([]);
    setBrand('');
    setModel('');
    setDescription('');
    setNotes('');
    setAcquisitionType('bought');
    setCondition('working');
    setUseFrequency('often');
    setShowOptionalDetails(false);
    setValidationErrors({});
    setServerError(null);
    setDraftRestored(false);
    setCreatedItem(null);
  }

  // Validate form
  function validate(): { valid: boolean; payload?: CreateItemRequest } {
    const errors: Record<string, string> = {};

    // 1. Name validation
    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = 'Enter an item name.';
    } else if (trimmedName.length > 300) {
      errors.name = 'Item name must be 300 characters or fewer.';
    }

    // 2. Price validation
    let pricePaidMinor: string | null = null;
    if (priceUnknown) {
      pricePaidMinor = null;
    } else {
      const trimmedPrice = priceDisplay.trim();
      if (!trimmedPrice) {
        errors.price = 'Enter the amount paid, or choose Price unknown.';
      } else {
        try {
          pricePaidMinor = amountEntryToMinor(trimmedPrice, currency);
        } catch (err) {
          errors.price = err instanceof Error ? err.message : 'Enter a valid amount.';
        }
      }
    }

    // 3. Date validation
    let purchaseDate: PurchaseDate;
    if (dateUnknown) {
      purchaseDate = { precision: 'unknown' };
    } else {
      if (datePrecision === 'year') {
        const yearNum = Number.parseInt(purchaseYear, 10);
        if (!purchaseYear || Number.isNaN(yearNum) || yearNum < 1 || yearNum > 9999) {
          errors.date = 'Enter a valid 4-digit purchase year (1–9999), or choose Date unknown.';
        }
        purchaseDate = { precision: 'year', year: yearNum };
      } else if (datePrecision === 'month') {
        const yearNum = Number.parseInt(purchaseYear, 10);
        const monthNum = Number.parseInt(purchaseMonth, 10);
        if (!purchaseYear || Number.isNaN(yearNum) || yearNum < 1 || yearNum > 9999) {
          errors.date = 'Enter a valid purchase year (1–9999), or choose Date unknown.';
        } else if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          errors.date = 'Select a valid purchase month.';
        }
        purchaseDate = { precision: 'month', year: yearNum, month: monthNum };
      } else {
        // exact
        if (!exactDate) {
          errors.date = 'Enter an exact purchase date, or choose Date unknown.';
        }
        const parts = exactDate.split('-');
        const y = Number.parseInt(parts[0] ?? '', 10);
        const m = Number.parseInt(parts[1] ?? '', 10);
        const d = Number.parseInt(parts[2] ?? '', 10);

        if (!exactDate || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
          errors.date = 'Enter a complete purchase date (year, month, and day).';
        } else {
          if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
            errors.date = 'The specified day is not valid for that month and year.';
          }
        }
        purchaseDate = { precision: 'exact', year: y, month: m, day: d };
      }
    }

    // 4. Taxonomy validation
    if (subcategoryId && !categoryId) {
      errors.category = 'A subcategory requires an active category.';
    }

    // 5. Optional bounded fields validation
    if (brand && brand.length > 300) {
      errors.brand = 'Brand must be 300 characters or fewer.';
    }
    if (model && model.length > 300) {
      errors.model = 'Model must be 300 characters or fewer.';
    }
    if (description && description.length > 5000) {
      errors.description = 'Description must be 5000 characters or fewer.';
    }
    if (notes && notes.length > 10000) {
      errors.notes = 'Notes must be 10000 characters or fewer.';
    }

    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      return { valid: false };
    }

    const payload: CreateItemRequest = {
      name: trimmedName,
      ownershipStatus,
      currency,
      pricePaidMinor,
      purchaseDate,
      categoryId: categoryId || null,
      subcategoryId: subcategoryId || null,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      brand: brand.trim() || null,
      model: model.trim() || null,
      description: description.trim() || null,
      notes: notes.trim() || null,
      acquisitionType: showOptionalDetails ? acquisitionType : undefined,
      condition: showOptionalDetails ? condition : undefined,
      useFrequency: showOptionalDetails ? useFrequency : undefined,
    };

    return { valid: true, payload };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Prevent duplicate submissions
    if (submittingRef.current || isSubmitting) return;

    setServerError(null);

    const check = validate();
    if (!check.valid || !check.payload) {
      // Focus error summary
      setTimeout(() => {
        if (errorSummaryRef.current) {
          errorSummaryRef.current.focus();
        } else {
          nameInputRef.current?.focus();
        }
      }, 50);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await createItem(check.payload);
      // Clear draft on successful creation
      if (owner) {
        clearItemDraft(owner.id);
      }
      setCreatedItem(result);
    } catch (err) {
      if (err instanceof ItemRequestError) {
        if (err.status === 401) {
          setSessionExpired(true);
        }
        setServerError(err.message);
      } else {
        setServerError(
          err instanceof Error
            ? err.message
            : 'Could not save item. Check your connection and try again.',
        );
      }

      setTimeout(() => {
        errorSummaryRef.current?.focus();
      }, 50);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  // Handle re-signing in when session expires
  async function handleSignedIn(): Promise<void> {
    const currentOwner = await fetchCurrentOwner();
    setOwner(currentOwner);
    setSessionExpired(false);
    setServerError(null);
    try {
      const snap = await taxonomyRequest();
      setTaxonomy(snap);
    } catch {
      // Non-fatal if taxonomy is already loaded
    }
  }

  // Loading skeleton state
  if (authLoading || (taxonomyLoading && !taxonomy)) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6" role="status" aria-label="Loading form">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  // Session expired / unauthenticated state
  if (sessionExpired || !owner) {
    return (
      <div className="mx-auto w-full max-w-md">
        <InlineSignIn
          message={
            sessionExpired
              ? 'Your session expired. Sign in to save your draft to your private inventory.'
              : 'Sign in to record items in your private inventory.'
          }
          onSignedIn={handleSignedIn}
        />
      </div>
    );
  }

  // Post-save success view
  if (createdItem) {
    const displayPrice = createdItem.pricePaidMinor
      ? formatMoney(parseMinorUnits(createdItem.pricePaidMinor, createdItem.currency))
      : 'Price unknown';

    const displayDate =
      createdItem.purchaseDate.precision === 'unknown'
        ? 'Date unknown'
        : createdItem.purchaseDate.precision === 'year'
          ? `Purchased in ${createdItem.purchaseDate.year}`
          : createdItem.purchaseDate.precision === 'month'
            ? `Purchased in ${months.find((m) => m.value === String(createdItem.purchaseDate.month))?.label ?? createdItem.purchaseDate.month} ${createdItem.purchaseDate.year}`
            : `Purchased on ${createdItem.purchaseDate.year}-${String(createdItem.purchaseDate.month).padStart(2, '0')}-${String(createdItem.purchaseDate.day).padStart(2, '0')}`;

    return (
      <Card className="mx-auto w-full max-w-xl border-green-500/20 bg-card shadow-sm" role="status">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2
              className="size-6 text-green-600 dark:text-green-500"
              aria-hidden="true"
            />
          </div>
          <CardTitle role="heading" aria-level={2} className="text-xl sm:text-2xl">
            {createdItem.name} saved to your home
          </CardTitle>
          <CardDescription className="text-sm sm:text-base">
            Your item is safely recorded in your private inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
            <Badge variant="secondary">{statusLabels[createdItem.ownershipStatus]}</Badge>
            <Badge variant="outline">{displayPrice}</Badge>
            <Badge variant="outline">{displayDate}</Badge>
            {createdItem.categoryId && taxonomy ? (
              <Badge variant="outline">
                {taxonomy.categories.find((c) => c.id === createdItem.categoryId)?.name ??
                  'Categorised'}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 pt-2">
            <Button asChild className="h-11 w-full justify-start gap-3 text-base">
              <Link href={`/items/${createdItem.id}/photos/new`}>
                <Camera className="size-5" aria-hidden="true" />
                Add photo
              </Link>
            </Button>

            <Button
              asChild
              variant="secondary"
              className="h-11 w-full justify-start gap-3 text-base"
            >
              <Link href={`/items/${createdItem.id}/edit`}>
                <FileEdit className="size-5" aria-hidden="true" />
                Add more details
              </Link>
            </Button>

            <Button asChild variant="outline" className="h-11 w-full justify-start gap-3 text-base">
              <Link href={`/items/${createdItem.id}`}>
                <Eye className="size-5" aria-hidden="true" />
                View item
              </Link>
            </Button>
          </div>
        </CardContent>
        <CardFooter className="justify-center border-t pt-4">
          <Button
            variant="ghost"
            className="h-11 text-sm text-muted-foreground hover:text-foreground"
            onClick={handleResetForNewItem}
          >
            <PlusCircle className="mr-2 size-4" aria-hidden="true" />
            Add another item
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const hasErrors = Object.keys(validationErrors).length > 0 || Boolean(serverError);

  return (
    <Card className="mx-auto w-full max-w-xl shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-xl sm:text-2xl font-semibold">Add item</CardTitle>
            <CardDescription className="text-sm">
              Record a possession in under a minute without receipts or photos.
            </CardDescription>
          </div>
          {draftRestored ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                Draft restored
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={handleDiscardDraft}
              >
                <RotateCcw className="mr-1 size-3" aria-hidden="true" />
                Discard
              </Button>
            </div>
          ) : null}
        </div>
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
                      onClick={(e) => {
                        e.preventDefault();
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

          {/* 1. Item Name */}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-name`} className="text-sm font-medium">
              Item name <span className="text-destructive">*</span>
            </Label>
            <Input
              ref={nameInputRef}
              id={`${formId}-name`}
              name="name"
              type="text"
              autoComplete="off"
              required
              maxLength={300}
              placeholder="e.g. Electric kettle, Sony headphones, Winter coat"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (validationErrors.name) {
                  setValidationErrors((prev) => {
                    const copy = { ...prev };
                    delete copy.name;
                    return copy;
                  });
                }
              }}
              aria-invalid={Boolean(validationErrors.name)}
              aria-describedby={
                validationErrors.name ? `${formId}-name-error` : `${formId}-name-hint`
              }
              className="min-h-11 text-base md:text-sm"
              disabled={isSubmitting}
            />
            {validationErrors.name ? (
              <p id={`${formId}-name-error`} className="text-xs text-destructive">
                {validationErrors.name}
              </p>
            ) : (
              <p id={`${formId}-name-hint`} className="text-xs text-muted-foreground">
                A simple, memorable name for what you own.
              </p>
            )}
          </div>

          {/* 2. Category & Subcategory */}
          {taxonomy ? (
            <div className="space-y-2">
              <CategorySelector
                taxonomy={taxonomy}
                categoryId={categoryId}
                subcategoryId={subcategoryId}
                disabled={isSubmitting}
                onChange={(cat, sub) => {
                  setCategoryId(cat);
                  setSubcategoryId(sub);
                  if (validationErrors.category) {
                    setValidationErrors((prev) => {
                      const copy = { ...prev };
                      delete copy.category;
                      return copy;
                    });
                  }
                }}
              />
              {validationErrors.category ? (
                <p id={`${formId}-category-error`} className="text-xs text-destructive">
                  {validationErrors.category}
                </p>
              ) : null}
            </div>
          ) : taxonomyError ? (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              <p>{taxonomyError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 min-h-11"
                onClick={async () => {
                  try {
                    setTaxonomyError(null);
                    setTaxonomy(await taxonomyRequest());
                  } catch (err) {
                    setTaxonomyError(
                      err instanceof Error ? err.message : 'Could not load taxonomy.',
                    );
                  }
                }}
              >
                Retry loading categories
              </Button>
            </div>
          ) : null}

          {/* 3. Amount Paid & Currency */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${formId}-price`} className="text-sm font-medium">
                Actual amount paid
              </Label>
              <label
                htmlFor={`${formId}-price-unknown`}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                <Checkbox
                  id={`${formId}-price-unknown`}
                  checked={priceUnknown}
                  onCheckedChange={(checked) => {
                    const isUnknown = Boolean(checked);
                    setPriceUnknown(isUnknown);
                    if (isUnknown) {
                      setValidationErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.price;
                        return copy;
                      });
                    }
                  }}
                  disabled={isSubmitting}
                />
                Price unknown
              </label>
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div>
                <Label htmlFor={`${formId}-currency`} className="sr-only">
                  Currency
                </Label>
                <Select
                  value={currency}
                  onValueChange={(val) => setCurrency(val)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id={`${formId}-currency`} className="min-h-11 w-full">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {popularCurrencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Input
                  id={`${formId}-price`}
                  name="price"
                  type="text"
                  inputMode="decimal"
                  placeholder={priceUnknown ? 'Unknown' : '0.00'}
                  value={priceUnknown ? '' : priceDisplay}
                  onChange={(e) => {
                    setPriceDisplay(e.target.value);
                    if (validationErrors.price) {
                      setValidationErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.price;
                        return copy;
                      });
                    }
                  }}
                  disabled={priceUnknown || isSubmitting}
                  aria-invalid={Boolean(validationErrors.price)}
                  aria-describedby={
                    validationErrors.price ? `${formId}-price-error` : `${formId}-price-hint`
                  }
                  className="min-h-11 text-base md:text-sm"
                />
              </div>
            </div>

            {validationErrors.price ? (
              <p id={`${formId}-price-error`} className="text-xs text-destructive">
                {validationErrors.price}
              </p>
            ) : (
              <p id={`${formId}-price-hint`} className="text-xs text-muted-foreground">
                Enter 0 if this was free. Choose &ldquo;Price unknown&rdquo; if you do not recall
                the amount.
              </p>
            )}
          </div>

          {/* 4. Approximate Purchase Date */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Approximate purchase date</Label>
              <label
                htmlFor={`${formId}-date-unknown`}
                className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                <Checkbox
                  id={`${formId}-date-unknown`}
                  checked={dateUnknown}
                  onCheckedChange={(checked) => {
                    const isUnknown = Boolean(checked);
                    setDateUnknown(isUnknown);
                    if (isUnknown) {
                      setValidationErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.date;
                        return copy;
                      });
                    }
                  }}
                  disabled={isSubmitting}
                />
                Date unknown
              </label>
            </div>

            {!dateUnknown ? (
              <div className="space-y-3">
                <div className="flex gap-4 text-xs">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`${formId}-precision`}
                      value="exact"
                      checked={datePrecision === 'exact'}
                      onChange={() => setDatePrecision('exact')}
                      disabled={isSubmitting}
                      className="size-4 text-primary"
                    />
                    Exact date
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`${formId}-precision`}
                      value="month"
                      checked={datePrecision === 'month'}
                      onChange={() => setDatePrecision('month')}
                      disabled={isSubmitting}
                      className="size-4 text-primary"
                    />
                    Month &amp; year
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name={`${formId}-precision`}
                      value="year"
                      checked={datePrecision === 'year'}
                      onChange={() => setDatePrecision('year')}
                      disabled={isSubmitting}
                      className="size-4 text-primary"
                    />
                    Year only
                  </label>
                </div>

                {datePrecision === 'exact' ? (
                  <div>
                    <Label htmlFor={`${formId}-exact-date`} className="sr-only">
                      Exact purchase date
                    </Label>
                    <Input
                      id={`${formId}-exact-date`}
                      type="date"
                      value={exactDate}
                      onChange={(e) => {
                        setExactDate(e.target.value);
                        if (validationErrors.date) {
                          setValidationErrors((prev) => {
                            const copy = { ...prev };
                            delete copy.date;
                            return copy;
                          });
                        }
                      }}
                      className="min-h-11 text-base md:text-sm"
                      disabled={isSubmitting}
                    />
                  </div>
                ) : datePrecision === 'month' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`${formId}-month`} className="sr-only">
                        Month
                      </Label>
                      <Select
                        value={purchaseMonth}
                        onValueChange={(val) => setPurchaseMonth(val)}
                        disabled={isSubmitting}
                      >
                        <SelectTrigger id={`${formId}-month`} className="min-h-11 w-full">
                          <SelectValue placeholder="Month" />
                        </SelectTrigger>
                        <SelectContent>
                          {months.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`${formId}-year`} className="sr-only">
                        Year
                      </Label>
                      <Input
                        id={`${formId}-year`}
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="YYYY (e.g. 2023)"
                        value={purchaseYear}
                        onChange={(e) => {
                          setPurchaseYear(e.target.value);
                          if (validationErrors.date) {
                            setValidationErrors((prev) => {
                              const copy = { ...prev };
                              delete copy.date;
                              return copy;
                            });
                          }
                        }}
                        className="min-h-11 text-base md:text-sm"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor={`${formId}-year-only`} className="sr-only">
                      Year
                    </Label>
                    <Input
                      id={`${formId}-year-only`}
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="YYYY (e.g. 2022)"
                      value={purchaseYear}
                      onChange={(e) => {
                        setPurchaseYear(e.target.value);
                        if (validationErrors.date) {
                          setValidationErrors((prev) => {
                            const copy = { ...prev };
                            delete copy.date;
                            return copy;
                          });
                        }
                      }}
                      className="min-h-11 text-base md:text-sm"
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Date will be recorded as unknown without inventing a day.
              </p>
            )}

            {validationErrors.date ? (
              <p id={`${formId}-date-error`} className="text-xs text-destructive">
                {validationErrors.date}
              </p>
            ) : null}
          </div>

          {/* 5. Ownership Status */}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-ownership-status`} className="text-sm font-medium">
              Ownership status
            </Label>
            <Select
              value={ownershipStatus}
              onValueChange={(val) => setOwnershipStatus(val as ItemStatus)}
              disabled={isSubmitting}
            >
              <SelectTrigger id={`${formId}-ownership-status`} className="min-h-11 w-full">
                <SelectValue placeholder="Ownership status" />
              </SelectTrigger>
              <SelectContent>
                {itemStatuses.map((st) => (
                  <SelectItem key={st} value={st}>
                    {statusLabels[st]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 6. Expandable Optional Details */}
          <div className="rounded-lg border p-4 space-y-4">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between text-left text-sm font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowOptionalDetails((prev) => !prev)}
              aria-expanded={showOptionalDetails}
              aria-controls={`${formId}-optional-details`}
            >
              <span>Additional details (optional)</span>
              <ChevronDown
                className={`size-4 transition-transform duration-200 ${
                  showOptionalDetails ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>

            {showOptionalDetails ? (
              <div id={`${formId}-optional-details`} className="space-y-4 pt-2">
                {/* Tags */}
                {taxonomy ? (
                  <TagSelector
                    taxonomy={taxonomy}
                    selectedIds={tagIds}
                    disabled={isSubmitting}
                    onChange={setTagIds}
                  />
                ) : null}

                {/* Brand & Model */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-brand`} className="text-xs font-medium">
                      Brand
                    </Label>
                    <Input
                      id={`${formId}-brand`}
                      type="text"
                      maxLength={300}
                      placeholder="e.g. Apple, Sony, IKEA"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      disabled={isSubmitting}
                      className="min-h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-model`} className="text-xs font-medium">
                      Model / Variant
                    </Label>
                    <Input
                      id={`${formId}-model`}
                      type="text"
                      maxLength={300}
                      placeholder="e.g. WH-1000XM4, M2 Air"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={isSubmitting}
                      className="min-h-11"
                    />
                  </div>
                </div>

                {/* Acquisition, Condition & Frequency */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-acquisition`} className="text-xs font-medium">
                      Acquisition
                    </Label>
                    <Select
                      value={acquisitionType}
                      onValueChange={(val) => setAcquisitionType(val as ItemAcquisition)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id={`${formId}-acquisition`} className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {itemAcquisitions.map((acq) => (
                          <SelectItem key={acq} value={acq}>
                            {acquisitionLabels[acq]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-condition`} className="text-xs font-medium">
                      Condition
                    </Label>
                    <Select
                      value={condition}
                      onValueChange={(val) => setCondition(val as ItemCondition)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id={`${formId}-condition`} className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {itemConditions.map((cond) => (
                          <SelectItem key={cond} value={cond}>
                            {conditionLabels[cond]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-frequency`} className="text-xs font-medium">
                      Use frequency
                    </Label>
                    <Select
                      value={useFrequency}
                      onValueChange={(val) => setUseFrequency(val as ItemFrequency)}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id={`${formId}-frequency`} className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {itemFrequencies.map((freq) => (
                          <SelectItem key={freq} value={freq}>
                            {frequencyLabels[freq]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <Label htmlFor={`${formId}-notes`} className="text-xs font-medium">
                    Notes
                  </Label>
                  <Textarea
                    id={`${formId}-notes`}
                    maxLength={10000}
                    placeholder="Where you keep it, warranty details, or repair history"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isSubmitting}
                    rows={3}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Submit Action */}
          <div className="pt-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 w-full text-base font-medium"
            >
              {isSubmitting ? 'Saving item…' : 'Save item'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InlineSignIn({
  message,
  onSignedIn,
}: {
  message: string;
  onSignedIn: () => Promise<void>;
}): ReactElement {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.get('email'),
          password: values.get('password'),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Email or password was not recognised.'
            : response.status === 429
              ? 'Too many attempts. Wait before trying again.'
              : 'Sign-in is unavailable. Try again.',
        );
        return;
      }
      form.reset();
      await onSignedIn();
    } catch {
      setError('Unable to connect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-md shadow-sm">
      <CardHeader>
        <CardTitle>Sign in to your private inventory</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="item-auth-email">Email</Label>
            <Input
              id="item-auth-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              disabled={busy}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-auth-password">Password</Label>
            <Input
              id="item-auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
              className="min-h-11"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} className="min-h-11 w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
