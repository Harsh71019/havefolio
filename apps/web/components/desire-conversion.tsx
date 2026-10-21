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
import {
  itemAcquisitions,
  itemConditions,
  itemFrequencies,
  itemStatuses,
  popularCurrencies,
  type ConvertDesireRequest,
  type DatePrecision,
  type DesireConversion,
  type DesireConversionState,
  type ItemAcquisition,
  type ItemCondition,
  type ItemFrequency,
  type ItemStatus,
  type PurchaseDate,
} from '@havefolio/contracts';
import { daysInMonth } from '@havefolio/domain';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@havefolio/ui/components/card';
import { Checkbox } from '@havefolio/ui/components/checkbox';
import { Input } from '@havefolio/ui/components/input';
import { DateInput } from '@havefolio/ui/components/havefolio/date-input';
import { Label } from '@havefolio/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@havefolio/ui/components/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { Textarea } from '@havefolio/ui/components/textarea';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
import {
  convertDesire,
  desirePhotoSource,
  DesireRequestError,
  getConversion,
  resumeConversionPhoto,
} from './desires-client';
import { formatLikelyPrice } from './desire-presentation';
import { amountEntryToMinor } from './money-entry';
import { randomId } from './random-id';
import { pageTitleClassName } from './page-heading';

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
  worn_out: 'Worn out',
  unknown: 'Unknown',
};
const frequencyLabels: Record<ItemFrequency, string> = {
  often: 'Often (daily / weekly)',
  sometimes: 'Sometimes (monthly)',
  rarely: 'Rarely (a few times a year)',
  never: 'Not used yet',
  unknown: 'Unknown',
};
const precisionLabels: Record<DatePrecision, string> = {
  exact: 'Exact date',
  month: 'Month and year',
  year: 'Year only',
  unknown: 'I don’t know',
};
const photoMessages: Record<DesireConversion['photo'], string> = {
  not_requested: 'The want’s photo was not copied.',
  pending: 'The photo copy has not finished yet. Your item is saved.',
  copied: 'The want’s photo was copied to the item. The original stays with the want.',
  unavailable: 'The want’s photo was no longer available to copy. You can add one to the item.',
};
const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: new Date(2000, i, 1).toLocaleString('en-IN', { month: 'long' }),
}));

type Errors = Partial<
  Record<
    | 'name'
    | 'price'
    | 'currency'
    | 'date'
    | 'acquisition'
    | 'condition'
    | 'usage'
    | 'status'
    | 'notes',
    string
  >
>;

const message = (error: unknown): string =>
  error instanceof DesireRequestError ? error.message : 'Something went wrong. Try again.';
const ambiguous = (error: unknown): boolean =>
  !(error instanceof DesireRequestError) || error.status === 0 || error.status >= 500;

/** Small marker distinguishing copied suggestions from owner-confirmed facts. */
function Provenance({ edited }: { edited: boolean }): ReactElement {
  return (
    <Badge variant={edited ? 'secondary' : 'outline'}>
      {edited ? 'Edited by you' : 'Suggested from your want'}
    </Badge>
  );
}

function FieldError({ id, text }: { id: string; text: string | undefined }): ReactElement | null {
  return text ? (
    <p id={id} className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

export function DesireConversionFlow({ desireId }: { desireId: string }): ReactElement {
  const formId = useId();
  const [state, setState] = useState<DesireConversionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // Suggestions (copied from the want; editable).
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [includeLink, setIncludeLink] = useState(false);
  const [copyPhoto, setCopyPhoto] = useState(false);
  // Confirmed facts (never prefilled).
  const [priceKnown, setPriceKnown] = useState<'' | 'known' | 'unknown'>('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [precision, setPrecision] = useState<DatePrecision | ''>('');
  const [exactDate, setExactDate] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [acquisition, setAcquisition] = useState<ItemAcquisition | ''>('');
  const [condition, setCondition] = useState<ItemCondition | ''>('');
  const [usage, setUsage] = useState<ItemFrequency | ''>('');
  const [status, setStatus] = useState<ItemStatus | ''>('');
  const pending = useRef<ConvertDesireRequest | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((next: DesireConversionState): void => {
    setState(next);
    setName(next.suggestions.name);
    setNotes(next.suggestions.notes ?? '');
    setCopyPhoto(next.suggestions.photo !== null);
    setIncludeLink(false);
  }, []);

  const fetchState = useCallback(
    (signal?: AbortSignal): Promise<void> =>
      getConversion(desireId, signal)
        .then((next) => {
          if (!signal?.aborted) apply(next);
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setLoadError(message(error));
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [apply, desireId],
  );
  const load = (): void => {
    setLoading(true);
    setLoadError('');
    void fetchState();
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchState(controller.signal);
    return () => controller.abort();
  }, [fetchState]);

  const refresh = async (): Promise<void> => setState(await getConversion(desireId));

  const validate = (s: DesireConversionState): ConvertDesireRequest | null => {
    const e: Errors = {};
    const trimmed = name.trim();
    if (!trimmed) e.name = 'Enter an item name.';
    else if (trimmed.length > 300) e.name = 'Use 300 characters or fewer.';
    if (!currency) e.currency = 'Choose the currency you paid in.';
    let pricePaid: ConvertDesireRequest['item']['pricePaid'] = { state: 'unknown' };
    if (!priceKnown) e.price = 'Confirm the amount you paid, or choose I don’t know.';
    else if (priceKnown === 'known') {
      if (!amount.trim()) e.price = 'Enter the amount you actually paid. 0 is allowed.';
      else if (currency) {
        try {
          pricePaid = { state: 'known', minor: amountEntryToMinor(amount.trim(), currency) };
        } catch (err) {
          e.price = err instanceof Error ? err.message : 'Enter a valid amount.';
        }
      }
    }
    let purchaseDate: PurchaseDate = { precision: 'unknown' };
    const y = Number.parseInt(year, 10);
    if (!precision) e.date = 'Confirm what you know about the purchase date.';
    else if (precision === 'year' || precision === 'month') {
      if (!/^\d{1,4}$/.test(year) || y < 1 || y > 9999) e.date = 'Enter a year from 1 to 9999.';
      else if (precision === 'month' && !month) e.date = 'Choose the purchase month.';
      else
        purchaseDate =
          precision === 'year'
            ? { precision, year: y }
            : { precision, year: y, month: Number(month) };
    } else if (precision === 'exact') {
      const [py, pm, pd] = exactDate.split('-').map((p) => Number.parseInt(p, 10));
      if (!py || !pm || !pd || pm > 12 || pd > daysInMonth(py, pm))
        e.date = 'Enter a complete, valid purchase date.';
      else purchaseDate = { precision, year: py, month: pm, day: pd };
    }
    if (!acquisition) e.acquisition = 'Choose how you got it.';
    if (!condition) e.condition = 'Choose its current condition.';
    if (!usage) e.usage = 'Choose how often you expect to use it.';
    if (!status) e.status = 'Choose its ownership status.';
    const link = includeLink && s.suggestions.productUrl;
    const fullNotes = [notes.trim(), link ? `Product link: ${s.suggestions.productUrl}` : '']
      .filter(Boolean)
      .join('\n\n');
    if (fullNotes.length > 10000) e.notes = 'Notes must be 10,000 characters or fewer.';
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      commandId: randomId(),
      boughtEventId: s.boughtEventId!,
      copyPhoto: copyPhoto && s.suggestions.photo !== null,
      item: {
        name: trimmed,
        ownershipStatus: status as ItemStatus,
        currency,
        pricePaid,
        purchaseDate,
        acquisitionType: acquisition as ItemAcquisition,
        condition: condition as ItemCondition,
        useFrequency: usage as ItemFrequency,
        notes: fullNotes || null,
      },
    };
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!state || busy) return;
    setFailure('');
    setNotice('');
    setStale(false);
    if (!uncertain) {
      const command = validate(state);
      if (!command) {
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      pending.current = command;
    }
    setBusy(true);
    try {
      const conversion = await convertDesire(desireId, pending.current!);
      pending.current = null;
      setUncertain(false);
      setState({ ...state, eligibility: 'converted', conversion });
      setNotice('Added to your inventory.');
    } catch (error) {
      // Keep the exact command after an ambiguous failure so a retry resolves the same conversion.
      const unsure = pending.current !== null && ambiguous(error);
      setUncertain(unsure);
      if (!unsure) pending.current = null;
      if (error instanceof DesireRequestError && error.code === 'DESIRE_ALREADY_CONVERTED') {
        await refresh().catch(() => undefined);
        setNotice(error.message);
      } else {
        setStale(
          error instanceof DesireRequestError &&
            ['STALE_BOUGHT_OUTCOME', 'DESIRE_NOT_BOUGHT', 'CONVERSION_COMMAND_REUSED'].includes(
              error.code,
            ),
        );
        setFailure(message(error));
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => noticeRef.current?.focus());
    }
  };

  const retryPhoto = async (): Promise<void> => {
    if (!state?.conversion) return;
    setBusy(true);
    setFailure('');
    try {
      const conversion = await resumeConversionPhoto(desireId);
      setState({ ...state, conversion });
      setNotice(photoMessages[conversion.photo]);
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => noticeRef.current?.focus());
    }
  };

  if (loading)
    return (
      <div role="status" aria-label="Loading purchase details" className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
        <span className="sr-only">Loading purchase details…</span>
      </div>
    );
  if (!state)
    return (
      <div className="space-y-4">
        <h1 className={pageTitleClassName}>Add to your inventory</h1>
        <Alert variant="destructive">
          <AlertTitle>Could not load this want</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11" onClick={load}>
            Retry loading
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/wants">Back to Wants</Link>
          </Button>
        </div>
      </div>
    );

  const s = state.suggestions;
  const historyHref = `/wants/${desireId}/history`;
  const describedBy = (key: keyof Errors, hint?: string): string | undefined =>
    [errors[key] ? `${formId}-${key}-error` : '', hint ?? ''].filter(Boolean).join(' ') ||
    undefined;
  const errorList = Object.values(errors).filter(Boolean);

  return (
    <div className="space-y-6">
      <Link
        href={historyHref}
        className="inline-flex min-h-11 items-center underline underline-offset-4"
      >
        Back to decision history
      </Link>
      <header className="space-y-2">
        <h1 className={pageTitleClassName}>Add to your inventory</h1>
        <p className="wrap-anywhere text-lg">{s.name}</p>
        <p className="text-sm text-muted-foreground">
          This is optional. Your bought decision is already recorded whether or not you add an item.
        </p>
      </header>

      <div ref={noticeRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {failure ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{stale ? 'This want changed' : 'Not added yet'}</AlertTitle>
            <AlertDescription>
              <p>{failure}</p>
              {stale ? (
                <Button
                  variant="outline"
                  className="mt-3 min-h-11"
                  onClick={() => {
                    setFailure('');
                    setStale(false);
                    load();
                  }}
                >
                  Reload latest
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
      </div>

      {state.conversion ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              In your inventory
            </CardTitle>
            <CardDescription>
              Linked to this want’s private history. Correcting the decision later keeps the item.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm wrap-anywhere">
            <p>
              <Link href={`/items/${state.conversion.itemId}`} className="font-medium underline">
                {state.conversion.itemName}
              </Link>
            </p>
            {!state.conversion.boughtOutcomeCurrent ? (
              <p>The bought decision was corrected afterwards. The item was kept.</p>
            ) : null}
            <p>{photoMessages[state.conversion.photo]}</p>
            {state.conversion.photo === 'pending' ? (
              <Button className="min-h-11" disabled={busy} onClick={() => void retryPhoto()}>
                {busy ? 'Copying photo…' : 'Retry photo copy'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : state.eligibility === 'not_bought' ? (
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Record bought first
            </CardTitle>
            <CardDescription>
              Items can be added from a want whose current decision is bought.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="min-h-11">
              <Link href={historyHref}>Open decision history</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-6">
          {errorList.length ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-md border border-destructive p-4 text-sm outline-none"
            >
              <p className="font-medium">Confirm {errorList.length} detail(s) before adding:</p>
              <ul className="mt-2 list-disc pl-5">
                {errorList.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <fieldset disabled={busy || uncertain} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Suggested from your want
                </CardTitle>
                <CardDescription>
                  Copied for convenience. Keep, edit or clear anything here.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`${formId}-name`}>Item name</Label>
                    <Provenance edited={name !== s.name} />
                  </div>
                  <Input
                    id={`${formId}-name`}
                    value={name}
                    maxLength={300}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={describedBy('name')}
                    onChange={(e) => setName(e.target.value)}
                    className="min-h-11"
                  />
                  <FieldError id={`${formId}-name-error`} text={errors.name} />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`${formId}-notes`}>Private notes (optional)</Label>
                    {s.notes ? <Provenance edited={notes !== s.notes} /> : null}
                  </div>
                  <Textarea
                    id={`${formId}-notes`}
                    value={notes}
                    maxLength={10000}
                    aria-invalid={Boolean(errors.notes)}
                    aria-describedby={describedBy('notes')}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <FieldError id={`${formId}-notes-error`} text={errors.notes} />
                </div>
                {s.productUrl ? (
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`${formId}-link`}
                      checked={includeLink}
                      onCheckedChange={(v) => setIncludeLink(v === true)}
                      className="mt-3.5"
                    />
                    <div className="space-y-1">
                      <Label htmlFor={`${formId}-link`} className="min-h-11">
                        Add the product link to notes
                      </Label>
                      <p className="break-all text-sm text-muted-foreground">{s.productUrl}</p>
                    </div>
                  </div>
                ) : null}
                {s.photo ? (
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`${formId}-photo`}
                      checked={copyPhoto}
                      onCheckedChange={(v) => setCopyPhoto(v === true)}
                      className="mt-3.5"
                    />
                    <div className="space-y-2">
                      <Label htmlFor={`${formId}-photo`} className="min-h-11">
                        Copy the want’s photo to the item
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        A private copy is made. The want keeps its own photo.
                      </p>
                      <div className="size-20 overflow-hidden rounded-md border bg-muted">
                        <PrivatePhoto
                          {...desirePhotoSource(
                            desireId,
                            s.photo,
                            s.photo.decorative ? '' : (s.photo.altText ?? s.name),
                            '80px',
                          )}
                          fit="cover"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Confirm what actually happened
                </CardTitle>
                <CardDescription>
                  These facts are never filled in for you. Choose “I don’t know” where that is true.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <fieldset
                  className="space-y-3"
                  aria-describedby={describedBy('price', `${formId}-price-hint`)}
                >
                  <legend className="font-medium">Actual price paid</legend>
                  <p id={`${formId}-price-hint`} className="text-sm text-muted-foreground">
                    {s.likelyPriceMinor !== null
                      ? `You estimated ${formatLikelyPrice(s.likelyPriceMinor, s.likelyCurrency)} while deciding. That estimate is not used as the price paid.`
                      : 'Enter what you paid. A gift you paid nothing for can be 0.'}
                  </p>
                  <RadioGroup
                    value={priceKnown}
                    onValueChange={(v) => setPriceKnown(v as 'known' | 'unknown')}
                    aria-label="Actual price paid"
                    aria-invalid={Boolean(errors.price)}
                  >
                    <div className="flex min-h-11 items-center gap-3">
                      <RadioGroupItem value="known" id={`${formId}-price-known`} />
                      <Label htmlFor={`${formId}-price-known`} className="min-h-11 flex-1">
                        I know the amount
                      </Label>
                    </div>
                    <div className="flex min-h-11 items-center gap-3">
                      <RadioGroupItem value="unknown" id={`${formId}-price-unknown`} />
                      <Label htmlFor={`${formId}-price-unknown`} className="min-h-11 flex-1">
                        I don’t know (left out of spending totals)
                      </Label>
                    </div>
                  </RadioGroup>
                  {priceKnown === 'known' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`${formId}-amount`}>Amount paid</Label>
                      <Input
                        id={`${formId}-amount`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        aria-invalid={Boolean(errors.price)}
                        aria-describedby={describedBy('price')}
                        onChange={(e) => setAmount(e.target.value)}
                        className="min-h-11"
                      />
                    </div>
                  ) : null}
                  <FieldError id={`${formId}-price-error`} text={errors.price} />
                </fieldset>

                <div className="space-y-2">
                  <Label htmlFor={`${formId}-currency`}>Currency paid</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger
                      id={`${formId}-currency`}
                      className="min-h-11 w-full"
                      aria-invalid={Boolean(errors.currency)}
                      aria-describedby={describedBy('currency')}
                    >
                      <SelectValue placeholder="Choose currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {popularCurrencies.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError id={`${formId}-currency-error`} text={errors.currency} />
                </div>

                <fieldset className="space-y-3" aria-describedby={describedBy('date')}>
                  <legend className="font-medium">Purchase date</legend>
                  <RadioGroup
                    value={precision}
                    onValueChange={(v) => setPrecision(v as DatePrecision)}
                    aria-label="Purchase date precision"
                    aria-invalid={Boolean(errors.date)}
                  >
                    {(Object.keys(precisionLabels) as DatePrecision[]).map((p) => (
                      <div key={p} className="flex min-h-11 items-center gap-3">
                        <RadioGroupItem value={p} id={`${formId}-precision-${p}`} />
                        <Label htmlFor={`${formId}-precision-${p}`} className="min-h-11 flex-1">
                          {precisionLabels[p]}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                  {precision === 'exact' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`${formId}-exact`}>Date</Label>
                      <DateInput
                        id={`${formId}-exact`}
                        value={exactDate}
                        onChange={setExactDate}
                        className="min-h-11"
                      />
                    </div>
                  ) : null}
                  {precision === 'month' || precision === 'year' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {precision === 'month' ? (
                        <div className="space-y-2">
                          <Label htmlFor={`${formId}-month`}>Month</Label>
                          <Select value={month} onValueChange={setMonth}>
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
                      ) : null}
                      <div className="space-y-2">
                        <Label htmlFor={`${formId}-year`}>Year</Label>
                        <Input
                          id={`${formId}-year`}
                          inputMode="numeric"
                          value={year}
                          onChange={(e) => setYear(e.target.value)}
                          className="min-h-11"
                        />
                      </div>
                    </div>
                  ) : null}
                  <FieldError id={`${formId}-date-error`} text={errors.date} />
                </fieldset>

                <div className="grid gap-5 sm:grid-cols-2">
                  {(
                    [
                      [
                        'acquisition',
                        'How you got it',
                        acquisition,
                        setAcquisition,
                        itemAcquisitions,
                        acquisitionLabels,
                      ],
                      ['status', 'Ownership now', status, setStatus, itemStatuses, statusLabels],
                      [
                        'condition',
                        'Condition',
                        condition,
                        setCondition,
                        itemConditions,
                        conditionLabels,
                      ],
                      ['usage', 'Expected use', usage, setUsage, itemFrequencies, frequencyLabels],
                    ] as const
                  ).map(([key, label, value, set, options, names]) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`${formId}-${key}`}>{label}</Label>
                      <Select value={value} onValueChange={(v) => (set as (x: string) => void)(v)}>
                        <SelectTrigger
                          id={`${formId}-${key}`}
                          className="min-h-11 w-full"
                          aria-invalid={Boolean(errors[key])}
                          aria-describedby={describedBy(key)}
                        >
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {(names as Record<string, string>)[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError id={`${formId}-${key}-error`} text={errors[key]} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </fieldset>

          {uncertain ? (
            <p className="text-sm">
              We couldn’t confirm whether the item was added. Retry the same submission to check; it
              will never add a second item.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy} className="min-h-11">
              {busy ? 'Adding…' : uncertain ? 'Retry same submission' : 'Add to inventory'}
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={historyHref}>Keep only the bought decision</Link>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
