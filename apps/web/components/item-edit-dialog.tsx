'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import {
  acquisitionLabels,
  conditionLabels,
  frequencyLabels,
  monthOptions,
  pricePaid,
  purchaseDateText,
} from './item-detail-presentation';
import { amountEntryToMinor, minorToAmountEntry } from './money-entry';
import {
  itemAcquisitions,
  itemConditions,
  itemFrequencies,
  popularCurrencies,
  type DatePrecision,
  type ItemAcquisition,
  type ItemCondition,
  type ItemFrequency,
  type ItemResponse,
  type PurchaseDate,
  type TaxonomySnapshot,
  type UpdateItemRequest,
} from '@havefolio/contracts';
import { daysInMonth } from '@havefolio/domain';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Button } from '@havefolio/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { Textarea } from '@havefolio/ui/components/textarea';
import { ItemRequestError } from './items-client';
import { CategorySelector, TagSelector } from './taxonomy-selectors';

export type EditSection = 'basics' | 'purchase' | 'state' | 'classification' | 'notes';

export const sectionTitles: Record<EditSection, string> = {
  basics: 'Edit name, brand, model and description',
  purchase: 'Edit purchase details',
  state: 'Edit condition and use',
  classification: 'Edit category and tags',
  notes: 'Edit notes and specifications',
};

type SpecRow = { key: string; value: string; original?: unknown };
export interface ItemDraft {
  name: string;
  brand: string;
  model: string;
  description: string;
  priceKnown: 'known' | 'unknown';
  currency: string;
  amount: string;
  precision: DatePrecision;
  exactDate: string;
  month: string;
  year: string;
  acquisitionType: ItemAcquisition;
  condition: ItemCondition;
  useFrequency: ItemFrequency;
  categoryId: string | undefined;
  subcategoryId: string | undefined;
  tagIds: string[];
  notes: string;
  specs: SpecRow[];
}

const pad = (n: number | null | undefined, size: number): string =>
  n == null ? '' : String(n).padStart(size, '0');
const specText = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

export function draftFrom(item: ItemResponse): ItemDraft {
  const d = item.purchaseDate;
  return {
    name: item.name,
    brand: item.brand ?? '',
    model: item.model ?? '',
    description: item.description ?? '',
    priceKnown: item.pricePaidMinor === null ? 'unknown' : 'known',
    currency: item.currency,
    amount:
      item.pricePaidMinor === null ? '' : minorToAmountEntry(item.pricePaidMinor, item.currency),
    precision: d.precision,
    exactDate:
      d.precision === 'exact' ? `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}` : '',
    month: d.month ? String(d.month) : '',
    year: d.year ? String(d.year) : '',
    acquisitionType: item.acquisitionType,
    condition: item.condition,
    useFrequency: item.useFrequency,
    categoryId: item.categoryId ?? undefined,
    subcategoryId: item.subcategoryId ?? undefined,
    tagIds: [...item.tagIds],
    notes: item.notes ?? '',
    specs: Object.entries(item.specifications ?? {}).map(([key, value]) => ({
      key,
      value: specText(value),
      original: value,
    })),
  };
}

type Errors = Partial<Record<string, string>>;
const sameDate = (a: PurchaseDate, b: PurchaseDate): boolean =>
  a.precision === b.precision &&
  (a.year ?? null) === (b.year ?? null) &&
  (a.month ?? null) === (b.month ?? null) &&
  (a.day ?? null) === (b.day ?? null);
const optional = (value: string): string | null => value.trim() || null;
const sameTags = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Validates one section and returns only fields that differ from `base`, so history names
 * exactly what the owner corrected. Values are never coerced into invented precision.
 */
export function sectionChanges(
  section: EditSection,
  draft: ItemDraft,
  base: ItemResponse,
): { errors: Errors; changes: Omit<UpdateItemRequest, 'revision'> } {
  const errors: Errors = {};
  const changes: Omit<UpdateItemRequest, 'revision'> = {};
  if (section === 'basics') {
    const name = draft.name.trim();
    if (!name) errors.name = 'Enter a name for this item.';
    else if (name.length > 300) errors.name = 'Use 300 characters or fewer for the name.';
    else if (name !== base.name) changes.name = name;
    for (const [key, max] of [
      ['brand', 300],
      ['model', 300],
      ['description', 5000],
    ] as const) {
      const value = optional(draft[key]);
      if (value && value.length > max) errors[key] = `Use ${max} characters or fewer.`;
      else if (value !== base[key]) changes[key] = value;
    }
  }
  if (section === 'purchase') {
    let price: string | null = null;
    if (draft.priceKnown === 'known') {
      if (!draft.amount.trim())
        errors.amount = 'Enter the amount you paid, 0 if nothing, or choose “Not recorded”.';
      else
        try {
          price = amountEntryToMinor(draft.amount, draft.currency);
        } catch (error) {
          errors.amount = error instanceof Error ? error.message : 'Enter a valid amount.';
        }
    }
    if (!/^[A-Z]{3}$/.test(draft.currency)) errors.currency = 'Choose a currency.';
    let date: PurchaseDate = { precision: 'unknown' };
    const year = Number(draft.year);
    const yearValid = /^\d{4}$/.test(draft.year) && year >= 1;
    if (draft.precision === 'exact') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.exactDate);
      const [y, m, d] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
      if (!match || y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m))
        errors.exactDate = 'Enter the full date, or choose a less precise option.';
      else date = { precision: 'exact', year: y, month: m, day: d };
    } else if (draft.precision === 'month') {
      const month = Number(draft.month);
      if (!(month >= 1 && month <= 12)) errors.month = 'Choose the month.';
      if (!yearValid) errors.year = 'Enter a four-digit year.';
      if (!errors.month && !errors.year) date = { precision: 'month', year, month };
    } else if (draft.precision === 'year') {
      if (!yearValid) errors.year = 'Enter a four-digit year.';
      else date = { precision: 'year', year };
    }
    if (!errors.amount && price !== base.pricePaidMinor) changes.pricePaidMinor = price;
    if (!errors.currency && draft.currency !== base.currency) changes.currency = draft.currency;
    if (!errors.exactDate && !errors.month && !errors.year && !sameDate(date, base.purchaseDate))
      changes.purchaseDate = date;
    if (draft.acquisitionType !== base.acquisitionType)
      changes.acquisitionType = draft.acquisitionType;
  }
  if (section === 'state') {
    if (draft.condition !== base.condition) changes.condition = draft.condition;
    if (draft.useFrequency !== base.useFrequency) changes.useFrequency = draft.useFrequency;
  }
  if (section === 'classification') {
    if (draft.subcategoryId && !draft.categoryId)
      errors.category = 'Choose a category before a subcategory.';
    if ((draft.categoryId ?? null) !== base.categoryId)
      changes.categoryId = draft.categoryId ?? null;
    if ((draft.subcategoryId ?? null) !== base.subcategoryId)
      changes.subcategoryId = draft.subcategoryId ?? null;
    if (!sameTags(draft.tagIds, base.tagIds)) changes.tagIds = draft.tagIds;
  }
  if (section === 'notes') {
    const notes = optional(draft.notes);
    if (notes && notes.length > 10000) errors.notes = 'Use 10,000 characters or fewer.';
    else if (notes !== base.notes) changes.notes = notes;
    const specs: Record<string, unknown> = {};
    const seen = new Set<string>();
    draft.specs.forEach((row, index) => {
      const key = row.key.trim();
      if (!key && !row.value.trim()) return;
      if (!key) errors[`spec-${index}`] = `Name specification ${index + 1}, or remove it.`;
      else if (key.length > 100) errors[`spec-${index}`] = 'Use 100 characters or fewer.';
      else if (seen.has(key.toLowerCase()))
        errors[`spec-${index}`] = `“${key}” is listed twice. Combine or rename one.`;
      seen.add(key.toLowerCase());
      // An unchanged structured value keeps its original type instead of becoming text.
      specs[key] =
        row.original !== undefined && specText(row.original) === row.value
          ? row.original
          : row.value.trim();
    });
    const next = Object.keys(specs).length ? specs : null;
    if (next && new TextEncoder().encode(JSON.stringify(next)).length > 16384)
      errors.specs = 'Specifications are too long. Shorten or remove some.';
    else if (JSON.stringify(next) !== JSON.stringify(base.specifications ?? null))
      changes.specifications = next;
  }
  return { errors, changes };
}

const fieldOrder: Record<EditSection, string[]> = {
  basics: ['name', 'brand', 'model', 'description'],
  purchase: ['amount', 'currency', 'exactDate', 'month', 'year', 'acquisitionType'],
  state: ['condition', 'useFrequency'],
  classification: ['category', 'tags'],
  notes: ['notes', 'specs'],
};

type Conflict = { latest: ItemResponse; differences: string[] };

/** Human summary of what changed elsewhere in this section, compared with when editing began. */
function sectionDifferences(
  section: EditSection,
  base: ItemResponse,
  latest: ItemResponse,
  taxonomy: TaxonomySnapshot | undefined,
): string[] {
  const out: string[] = [];
  const text = (v: string | null): string => (v ? `“${v}”` : 'empty');
  if (section === 'basics')
    for (const [key, label] of [
      ['name', 'Name'],
      ['brand', 'Brand'],
      ['model', 'Model'],
      ['description', 'Description'],
    ] as const)
      if (base[key] !== latest[key]) out.push(`${label} is now ${text(latest[key])}.`);
  if (section === 'purchase') {
    if (base.pricePaidMinor !== latest.pricePaidMinor || base.currency !== latest.currency)
      out.push(`Price paid is now ${pricePaid(latest).value}.`);
    if (!sameDate(base.purchaseDate, latest.purchaseDate))
      out.push(`Purchase date is now ${purchaseDateText(latest.purchaseDate).value}.`);
    if (base.acquisitionType !== latest.acquisitionType)
      out.push(`How you got it is now ${acquisitionLabels[latest.acquisitionType]}.`);
  }
  if (section === 'state') {
    if (base.condition !== latest.condition)
      out.push(`Condition is now ${conditionLabels[latest.condition]}.`);
    if (base.useFrequency !== latest.useFrequency)
      out.push(`How often you use it is now ${frequencyLabels[latest.useFrequency]}.`);
  }
  if (section === 'classification') {
    const name = (id: string | null): string =>
      id ? (taxonomy?.categories.find((c) => c.id === id)?.name ?? 'another category') : 'none';
    if (base.categoryId !== latest.categoryId || base.subcategoryId !== latest.subcategoryId)
      out.push(`Category is now ${name(latest.categoryId)}.`);
    if (!sameTags(base.tagIds, latest.tagIds)) out.push('Tags were changed.');
  }
  if (section === 'notes') {
    if (base.notes !== latest.notes) out.push('Notes were changed.');
    if (JSON.stringify(base.specifications) !== JSON.stringify(latest.specifications))
      out.push('Specifications were changed.');
  }
  if (base.ownershipStatus !== latest.ownershipStatus)
    out.push('Its ownership status also changed.');
  return out;
}

export function ItemEditDialog({
  item,
  section,
  taxonomy,
  draft: savedDraft,
  focusField,
  online,
  onDraftChange,
  onClose,
  onSave,
  onReload,
  onSaved,
}: {
  item: ItemResponse;
  section: EditSection | undefined;
  taxonomy: TaxonomySnapshot | undefined;
  /** An unsaved draft kept from an earlier attempt, restored instead of the current values. */
  draft: ItemDraft | undefined;
  focusField?: string | undefined;
  online: boolean;
  onDraftChange: (section: EditSection, draft: ItemDraft | undefined) => void;
  onClose: () => void;
  onSave: (input: UpdateItemRequest) => Promise<ItemResponse>;
  onReload: () => Promise<ItemResponse | undefined>;
  onSaved: (item: ItemResponse, message: string) => void;
}): ReactElement {
  return (
    <Dialog open={Boolean(section)} onOpenChange={(open) => (open ? undefined : onClose())}>
      {section ? (
        <DialogContent className="max-h-[92svh] overflow-y-auto motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-w-xl">
          <EditForm
            key={section}
            item={item}
            section={section}
            taxonomy={taxonomy}
            savedDraft={savedDraft}
            focusField={focusField}
            online={online}
            onDraftChange={onDraftChange}
            onClose={onClose}
            onSave={onSave}
            onReload={onReload}
            onSaved={onSaved}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function EditForm({
  item,
  section,
  taxonomy,
  savedDraft,
  focusField,
  online,
  onDraftChange,
  onClose,
  onSave,
  onReload,
  onSaved,
}: {
  item: ItemResponse;
  section: EditSection;
  taxonomy: TaxonomySnapshot | undefined;
  savedDraft: ItemDraft | undefined;
  focusField?: string | undefined;
  online: boolean;
  onDraftChange: (section: EditSection, draft: ItemDraft | undefined) => void;
  onClose: () => void;
  onSave: (input: UpdateItemRequest) => Promise<ItemResponse>;
  onReload: () => Promise<ItemResponse | undefined>;
  onSaved: (item: ItemResponse, message: string) => void;
}): ReactElement {
  const id = useId();
  const [restored] = useState(Boolean(savedDraft));
  const [draft, setDraftState] = useState<ItemDraft>(() => savedDraft ?? draftFrom(item));
  // The values editing started from; conflict review compares the server against these.
  const [base, setBase] = useState<ItemResponse>(item);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | undefined>();
  const [conflict, setConflict] = useState<Conflict | undefined>();
  const [busy, setBusy] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!focusField) return;
    const timer = window.setTimeout(
      () => document.getElementById(`${id}-${focusField}`)?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [focusField, id]);

  const setDraft = (patch: Partial<ItemDraft>): void => {
    const next = { ...draft, ...patch };
    setDraftState(next);
    // Unsaved input survives closing the dialog and recoverable failures.
    onDraftChange(section, next);
    const touched = Object.keys(patch);
    if (touched.some((key) => errors[key]))
      setErrors((current) => {
        const copy = { ...current };
        for (const key of touched) delete copy[key];
        return copy;
      });
  };

  const fieldProps = (key: string, hint?: string): Record<string, unknown> => ({
    id: `${id}-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby':
      [errors[key] ? `${id}-${key}-error` : '', hint ? `${id}-${key}-hint` : '']
        .filter(Boolean)
        .join(' ') || undefined,
  });
  const fieldError = (key: string): ReactElement | null =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;

  /**
   * Sends only what the owner changed relative to where editing began, so saving after a
   * conflict never reverts someone else's change to a field the owner did not touch.
   */
  async function submit(event: FormEvent, latest?: ItemResponse): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const { errors: found, changes } = sectionChanges(section, draft, base);
    setErrors(found);
    setFailure(undefined);
    if (Object.keys(found).length) {
      window.setTimeout(() => summary.current?.focus(), 0);
      return;
    }
    if (!Object.keys(changes).length) {
      onDraftChange(section, undefined);
      onSaved(latest ?? item, 'No changes to save.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const saved = await onSave({ ...changes, revision: (latest ?? base).revision });
      onDraftChange(section, undefined);
      onSaved(saved, 'Changes saved.');
    } catch (error) {
      const failed =
        error instanceof ItemRequestError
          ? error
          : new ItemRequestError(500, 'Something went wrong. Try again.');
      if (failed.stale) {
        const latest = await onReload();
        if (latest)
          setConflict({
            latest,
            differences: sectionDifferences(section, base, latest, taxonomy),
          });
        else setFailure('This item changed elsewhere and could not be reloaded. Try again.');
      } else {
        setFailure(
          failed.offline
            ? `${failed.message} Your changes are still here; save again when you are back online.`
            : `${failed.message} Your changes are still here.`,
        );
      }
      window.setTimeout(() => summary.current?.focus(), 0);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const errorEntries = fieldOrder[section]
    .flatMap((key) =>
      key === 'specs'
        ? [
            ...draft.specs.map((_r, i) => `spec-${i}`).filter((k) => errors[k]),
            ...(errors.specs ? ['specs'] : []),
          ]
        : errors[key]
          ? [key]
          : [],
    )
    .map((key) => [key, errors[key]!] as const);

  const title = sectionTitles[section];
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid min-w-0 gap-5">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {section === 'purchase'
            ? 'Correct what you paid and when. This is what you paid at the time, not what it is worth now.'
            : section === 'notes'
              ? 'Private to you. Add anything worth remembering, and any specifications.'
              : 'Changes are saved only when you choose Save.'}
        </DialogDescription>
      </DialogHeader>

      {restored && !conflict ? (
        <Alert role="status">
          <AlertTitle>Your unsaved changes were kept</AlertTitle>
          <AlertDescription>
            <Button
              type="button"
              variant="link"
              className="h-auto min-h-11 px-0"
              onClick={() => {
                setDraftState(draftFrom(item));
                setBase(item);
                onDraftChange(section, undefined);
              }}
            >
              Start over from the saved details
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        ref={summary}
        tabIndex={-1}
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-live="assertive"
      >
        {errorEntries.length ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>
              Check {errorEntries.length === 1 ? 'this field' : 'these fields'}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {errorEntries.map(([key, message]) => (
                  <li key={key}>
                    <a
                      href={`#${id}-${key}`}
                      className="underline underline-offset-2"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`${id}-${key}`)?.focus();
                      }}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {failure ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        {conflict ? (
          <Alert role="alert">
            <AlertTitle>This item changed since you opened it</AlertTitle>
            <AlertDescription>
              <p>Nothing was overwritten. Your edits are still in the form below.</p>
              {conflict.differences.length ? (
                <ul className="list-disc space-y-1 pl-4">
                  {conflict.differences.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  None of these fields changed — something else did, such as photos or documents.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={busy || !online}
                  onClick={(e) => {
                    const latest = conflict.latest;
                    setConflict(undefined);
                    void submit(e, latest);
                  }}
                >
                  Save my version
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => {
                    setDraftState(draftFrom(conflict.latest));
                    setBase(conflict.latest);
                    setConflict(undefined);
                    onDraftChange(section, undefined);
                  }}
                >
                  Discard mine, use latest
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <fieldset disabled={busy} className="grid min-w-0 gap-5">
        <legend className="sr-only">{title}</legend>
        {section === 'basics' ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                {...fieldProps('name')}
                className="min-h-11 text-base md:text-sm"
                required
                maxLength={300}
                autoComplete="off"
                value={draft.name}
                onChange={(e) => setDraft({ name: e.target.value })}
              />
              {fieldError('name')}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['brand', 'model'] as const).map((key) => (
                <div key={key} className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-${key}`}>
                    {key === 'brand' ? 'Brand' : 'Model'} (optional)
                  </Label>
                  <Input
                    {...fieldProps(key)}
                    className="min-h-11 text-base md:text-sm"
                    maxLength={300}
                    autoComplete="off"
                    value={draft[key]}
                    onChange={(e) => setDraft({ [key]: e.target.value })}
                  />
                  {fieldError(key)}
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>Description (optional)</Label>
              <Textarea
                {...fieldProps('description')}
                className="min-h-24 text-base md:text-sm"
                maxLength={5000}
                value={draft.description}
                onChange={(e) => setDraft({ description: e.target.value })}
              />
              {fieldError('description')}
            </div>
          </>
        ) : null}

        {section === 'purchase' ? (
          <>
            <fieldset className="grid min-w-0 gap-3">
              <legend className="mb-2 text-sm font-medium">Price paid</legend>
              <RadioGroup
                value={draft.priceKnown}
                onValueChange={(value) => setDraft({ priceKnown: value as 'known' | 'unknown' })}
                className="grid gap-1 sm:grid-cols-2"
                aria-label="Is the price known?"
              >
                {(
                  [
                    ['known', 'I know the amount'],
                    ['unknown', 'Not recorded'],
                  ] as const
                ).map(([value, label]) => (
                  <Label
                    key={value}
                    htmlFor={`${id}-price-${value}`}
                    className="flex min-h-11 items-center gap-3 font-normal"
                  >
                    <RadioGroupItem id={`${id}-price-${value}`} value={value} />
                    {label}
                  </Label>
                ))}
              </RadioGroup>
              {draft.priceKnown === 'known' ? (
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor={`${id}-currency`}>Currency</Label>
                    <Select
                      value={draft.currency}
                      onValueChange={(value) => setDraft({ currency: value })}
                    >
                      <SelectTrigger {...fieldProps('currency')} className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(popularCurrencies.some((c) => c.code === draft.currency)
                          ? popularCurrencies
                          : [
                              { code: draft.currency, symbol: draft.currency, name: '' },
                              ...popularCurrencies,
                            ]
                        ).map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${id}-amount`}>Amount paid</Label>
                    <Input
                      {...fieldProps('amount', 'hint')}
                      className="min-h-11 text-base md:text-sm"
                      inputMode="decimal"
                      autoComplete="off"
                      value={draft.amount}
                      onChange={(e) => setDraft({ amount: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
              <p id={`${id}-amount-hint`} className="text-sm text-muted-foreground">
                {draft.priceKnown === 'known'
                  ? 'Enter 0 if you paid nothing. Use the currency you actually paid in.'
                  : 'An unknown price is left out of spending totals; the item still counts.'}
              </p>
              {fieldError('amount')}
              {fieldError('currency')}
            </fieldset>

            <fieldset className="grid min-w-0 gap-3">
              <legend className="mb-2 text-sm font-medium">When you got it</legend>
              <RadioGroup
                value={draft.precision}
                onValueChange={(value) => setDraft({ precision: value as DatePrecision })}
                className="grid gap-1 sm:grid-cols-2"
                aria-label="How precisely do you know the date?"
              >
                {(
                  [
                    ['exact', 'Exact date'],
                    ['month', 'Month and year'],
                    ['year', 'Year only'],
                    ['unknown', 'Not recorded'],
                  ] as const
                ).map(([value, label]) => (
                  <Label
                    key={value}
                    htmlFor={`${id}-precision-${value}`}
                    className="flex min-h-11 items-center gap-3 font-normal"
                  >
                    <RadioGroupItem id={`${id}-precision-${value}`} value={value} />
                    {label}
                  </Label>
                ))}
              </RadioGroup>
              {draft.precision === 'exact' ? (
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-exactDate`}>Date</Label>
                  <Input
                    {...fieldProps('exactDate')}
                    type="date"
                    className="min-h-11 text-base md:text-sm"
                    value={draft.exactDate}
                    onChange={(e) => setDraft({ exactDate: e.target.value })}
                  />
                  {fieldError('exactDate')}
                </div>
              ) : null}
              {draft.precision === 'month' || draft.precision === 'year' ? (
                <div className="grid grid-cols-2 gap-3">
                  {draft.precision === 'month' ? (
                    <div className="grid min-w-0 gap-2">
                      <Label htmlFor={`${id}-month`}>Month</Label>
                      <Select
                        value={draft.month}
                        onValueChange={(value) => setDraft({ month: value })}
                      >
                        <SelectTrigger {...fieldProps('month')} className="min-h-11 w-full">
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {monthOptions.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldError('month')}
                    </div>
                  ) : null}
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${id}-year`}>Year</Label>
                    <Input
                      {...fieldProps('year')}
                      className="min-h-11 text-base md:text-sm"
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="off"
                      value={draft.year}
                      onChange={(e) => setDraft({ year: e.target.value.trim() })}
                    />
                    {fieldError('year')}
                  </div>
                </div>
              ) : null}
              {draft.precision === 'unknown' ? (
                <p className="text-sm text-muted-foreground">
                  The date stays unknown — no date is filled in for you.
                </p>
              ) : null}
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor={`${id}-acquisitionType`}>How you got it</Label>
              <Select
                value={draft.acquisitionType}
                onValueChange={(value) => setDraft({ acquisitionType: value as ItemAcquisition })}
              >
                <SelectTrigger {...fieldProps('acquisitionType')} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {itemAcquisitions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {acquisitionLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.acquisitionType === 'gift' ? (
                <p className="text-sm text-muted-foreground">
                  Gifts do not count as spending unless you record an amount you paid.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {section === 'state' ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-condition`}>Condition</Label>
              <Select
                value={draft.condition}
                onValueChange={(value) => setDraft({ condition: value as ItemCondition })}
              >
                <SelectTrigger {...fieldProps('condition')} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {itemConditions.map((value) => (
                    <SelectItem key={value} value={value}>
                      {conditionLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-useFrequency`}>How often you use it</Label>
              <Select
                value={draft.useFrequency}
                onValueChange={(value) => setDraft({ useFrequency: value as ItemFrequency })}
              >
                <SelectTrigger {...fieldProps('useFrequency')} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {itemFrequencies.map((value) => (
                    <SelectItem key={value} value={value}>
                      {frequencyLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              These are separate from whether you still own it. Use the status actions on the item
              page to record selling, donating or losing it.
            </p>
          </>
        ) : null}

        {section === 'classification' ? (
          taxonomy ? (
            <>
              <div id={`${id}-category`} tabIndex={-1} className="grid gap-2 outline-none">
                <CategorySelector
                  taxonomy={taxonomy}
                  categoryId={draft.categoryId}
                  subcategoryId={draft.subcategoryId}
                  onChange={(categoryId, subcategoryId) => setDraft({ categoryId, subcategoryId })}
                />
                {fieldError('category')}
              </div>
              <div id={`${id}-tags`} tabIndex={-1} className="outline-none">
                <TagSelector
                  taxonomy={taxonomy}
                  selectedIds={draft.tagIds}
                  onChange={(tagIds) => setDraft({ tagIds })}
                />
              </div>
            </>
          ) : (
            <Alert role="alert">
              <AlertTitle>Categories and tags could not load</AlertTitle>
              <AlertDescription>Close this and reload the page to try again.</AlertDescription>
            </Alert>
          )
        ) : null}

        {section === 'notes' ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-notes`}>Notes (optional)</Label>
              <Textarea
                {...fieldProps('notes')}
                className="min-h-32 text-base md:text-sm"
                maxLength={10000}
                value={draft.notes}
                onChange={(e) => setDraft({ notes: e.target.value })}
              />
              {fieldError('notes')}
            </div>
            <fieldset id={`${id}-specs`} tabIndex={-1} className="grid min-w-0 gap-3 outline-none">
              <legend className="mb-1 text-sm font-medium">Specifications (optional)</legend>
              <p className="text-sm text-muted-foreground">
                For example: Size — Large, Wattage — 1500 W.
              </p>
              {draft.specs.map((row, index) => (
                <div
                  key={index}
                  className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end sm:border-0 sm:p-0"
                >
                  <div className="grid min-w-0 gap-1">
                    <Label htmlFor={`${id}-spec-${index}`} className="text-xs">
                      Specification {index + 1} name
                    </Label>
                    <Input
                      {...fieldProps(`spec-${index}`)}
                      className="min-h-11 text-base md:text-sm"
                      maxLength={100}
                      autoComplete="off"
                      value={row.key}
                      onChange={(e) =>
                        setDraft({
                          specs: draft.specs.map((r, i) =>
                            i === index ? { ...r, key: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="grid min-w-0 gap-1">
                    <Label htmlFor={`${id}-spec-value-${index}`} className="text-xs">
                      Specification {index + 1} value
                    </Label>
                    <Input
                      id={`${id}-spec-value-${index}`}
                      className="min-h-11 text-base md:text-sm"
                      maxLength={1000}
                      autoComplete="off"
                      value={row.value}
                      onChange={(e) =>
                        setDraft({
                          specs: draft.specs.map((r, i) =>
                            i === index ? { ...r, value: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 justify-self-start"
                    onClick={() => setDraft({ specs: draft.specs.filter((_r, i) => i !== index) })}
                  >
                    <Trash2Icon aria-hidden="true" />
                    <span className="sm:sr-only">Remove specification {index + 1}</span>
                  </Button>
                  {errors[`spec-${index}`] ? (
                    <p
                      id={`${id}-spec-${index}-error`}
                      className="text-sm text-destructive sm:col-span-3"
                    >
                      {errors[`spec-${index}`]}
                    </p>
                  ) : null}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 justify-self-start"
                disabled={draft.specs.length >= 50}
                onClick={() => setDraft({ specs: [...draft.specs, { key: '', value: '' }] })}
              >
                <PlusIcon aria-hidden="true" />
                Add a specification
              </Button>
              {fieldError('specs')}
            </fieldset>
          </>
        ) : null}
      </fieldset>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy}
          onClick={() => {
            // An explicit cancel discards; Escape or the close button keep the draft.
            onDraftChange(section, undefined);
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="min-h-11"
          disabled={busy || !online || Boolean(conflict)}
          aria-describedby={!online ? `${id}-offline` : undefined}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
      {!online ? (
        <p id={`${id}-offline`} className="text-sm text-muted-foreground">
          You are offline. Your changes stay here until you reconnect and save.
        </p>
      ) : null}
    </form>
  );
}
