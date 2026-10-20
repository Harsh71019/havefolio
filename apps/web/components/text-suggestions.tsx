'use client';
import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
} from 'react';
import Link from 'next/link';
import {
  ArrowLeftIcon,
  CheckIcon,
  FileTextIcon,
  PencilIcon,
  ScanTextIcon,
  ShieldCheckIcon,
  Undo2Icon,
} from 'lucide-react';
import {
  popularCurrencies,
  type EnrichmentField,
  type EnrichmentPage,
  type EnrichmentReviewEvent,
  type EnrichmentWork,
  type ItemDocument,
  type ItemDocumentSnapshot,
  type ItemPhoto,
  type ItemPhotoSnapshot,
  type ItemResponse,
} from '@havefolio/contracts';
import {
  formatPricePaidValue,
  formatPurchaseDateValue,
  parseDecimalAmount,
  parsePricePaidValue,
  parsePurchaseDateValue,
  toDecimalString,
  validEnrichmentValue,
} from '@havefolio/domain';
import { Alert, AlertDescription, AlertTitle } from '@havefolio/ui/components/alert';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { DateInput } from '@havefolio/ui/components/havefolio/date-input';
import { PrivatePhoto } from '@havefolio/ui/components/havefolio/private-photo';
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
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { fetchDocuments } from './documents-client';
import { auditTime, monthOptions } from './item-detail-presentation';
import { readItem } from './items-client';
import { amountEntryMessage } from './money-entry';
import { itemDetailHref } from './navigation-context';
import { fetchPhotos, photoSource } from './photos-client';
import { randomId } from './random-id';
import {
  activeStates,
  bandLabels,
  candidateTitle,
  currentValue,
  displayValue,
  evidence,
  fieldLabels,
  latestDecisions,
  workIsCurrent,
} from './text-suggestion-presentation';
import {
  readDecisions,
  readSuggestions,
  requestReading,
  reviewSuggestion,
  SuggestionRequestError,
} from './text-suggestions-client';

/** Injectable seam so component tests exercise the real UI against a fake API. */
export interface TextSuggestionsApi {
  readItem(id: string): Promise<ItemResponse>;
  fetchPhotos(id: string): Promise<ItemPhotoSnapshot>;
  fetchDocuments(id: string): Promise<ItemDocumentSnapshot>;
  readSuggestions: typeof readSuggestions;
  requestReading: typeof requestReading;
  reviewSuggestion: typeof reviewSuggestion;
  readDecisions: typeof readDecisions;
}

export const apiTextSuggestions: TextSuggestionsApi = {
  readItem,
  fetchPhotos,
  fetchDocuments,
  readSuggestions,
  requestReading,
  reviewSuggestion,
  readDecisions,
};

type Source =
  | { kind: 'photo'; id: string; label: string; photo: ItemPhoto }
  | { kind: 'receipt'; id: string; label: string; document: ItemDocument };

interface Loaded {
  item: ItemResponse;
  sources: Source[];
  page: EnrichmentPage;
  decisions: EnrichmentReviewEvent[];
}

async function fetchAll(api: TextSuggestionsApi, itemId: string): Promise<Loaded> {
  const [item, photos, documents, page, decisions] = await Promise.all([
    api.readItem(itemId),
    // Missing media lists only hide sources; the item and its suggestions still show.
    api.fetchPhotos(itemId).catch(() => ({ revision: 0, photos: [] })),
    api.fetchDocuments(itemId).catch(() => ({ revision: 0, documents: [] })),
    api.readSuggestions(itemId),
    api.readDecisions(itemId),
  ]);
  const receipts = documents.documents.filter((d) => d.kind === 'receipt');
  return {
    item,
    page,
    decisions,
    sources: [
      ...photos.photos.map((photo, index): Source => ({
        kind: 'photo',
        id: photo.id,
        label: `Photo ${index + 1}`,
        photo,
      })),
      ...receipts.map((document, index): Source => ({
        kind: 'receipt',
        id: document.id,
        label: `Receipt ${index + 1}`,
        document,
      })),
    ],
  };
}

const messageOf = (error: unknown): string =>
  error instanceof SuggestionRequestError || error instanceof Error
    ? error.message
    : 'Something went wrong. Try again.';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** At most this many status checks after a request; the page never polls indefinitely. */
const maxPolls = 40;

/**
 * PER-45 source-specific review of local photo/receipt reading. Suggestions are evidence, not
 * facts: every field is applied only by an explicit owner decision, with its confidence,
 * provenance and caveats shown, and the item's earlier value kept in the decision history.
 * Nothing here is cached in browser storage.
 */
export function TextSuggestions({
  itemId,
  returnTo,
  api = apiTextSuggestions,
  pollMs = 3000,
}: {
  itemId: string;
  returnTo?: string | undefined;
  api?: TextSuggestionsApi;
  pollMs?: number;
}): ReactElement {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; value: Loaded }
  >({ kind: 'loading' });
  const [status, setStatus] = useState<{ error: boolean; text: string } | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [polls, setPolls] = useState(0);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      setState({ kind: 'ready', value: await fetchAll(api, itemId) });
    } catch (error) {
      setState({ kind: 'failed', message: messageOf(error) });
    }
  }, [api, itemId]);

  useEffect(() => {
    let active = true;
    fetchAll(api, itemId)
      .then((value) => active && setState({ kind: 'ready', value }))
      .catch((error: unknown) => active && setState({ kind: 'failed', message: messageOf(error) }));
    return () => {
      active = false;
    };
  }, [api, itemId]);

  const ready = state.kind === 'ready' ? state.value : undefined;
  const ours = (ready?.page.items ?? []).filter(
    (w) => w.inputKind === 'photo' || w.inputKind === 'receipt',
  );
  const pending = ours.some((w) => activeStates.has(w.state));
  useEffect(() => {
    if (!pending || polls >= maxPolls) return;
    const timer = window.setTimeout(() => {
      setPolls((n) => n + 1);
      void api
        .readSuggestions(itemId)
        .then((page) =>
          setState((s) =>
            s.kind === 'ready' ? { kind: 'ready', value: { ...s.value, page } } : s,
          ),
        )
        .catch(() => undefined);
    }, pollMs);
    return () => window.clearTimeout(timer);
  }, [api, itemId, pending, pollMs, polls]);

  const back = itemDetailHref(itemId, returnTo);
  if (state.kind === 'loading')
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3 motion-reduce:animate-none" />
        <Skeleton className="h-32 w-full motion-reduce:animate-none" />
        <p className="sr-only">Loading suggestions…</p>
      </div>
    );
  if (state.kind === 'failed')
    return (
      <div role="alert" className="space-y-3">
        <h1 className="text-2xl font-semibold">Suggestions from photos and receipts</h1>
        <p>{state.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            onClick={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            Try again
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={back}>Back to item</Link>
          </Button>
        </div>
      </div>
    );

  const { item, sources, page, decisions } = state.value;
  const available = (kind: 'photo' | 'receipt'): boolean => page.availableKinds.includes(kind);
  const anyAvailable = available('photo') || available('receipt');

  async function read(source: Source): Promise<void> {
    if (busy) return;
    setBusy(source.id);
    setStatus(undefined);
    try {
      await api.requestReading(itemId, {
        commandId: randomId(),
        revision: item.revision,
        kind: source.kind,
        attachmentId: source.id,
      });
      setPolls(0);
      setStatus({
        error: false,
        text: `Reading ${source.label.toLowerCase()}. Suggestions appear below when ready.`,
      });
    } catch (error) {
      setStatus({ error: true, text: messageOf(error) });
    } finally {
      setBusy(undefined);
      await load();
    }
  }

  async function decide(
    work: EnrichmentWork,
    candidateId: string,
    field: EnrichmentField,
    decision: 'accept' | 'reject' | 'correct',
    value?: string,
  ): Promise<boolean> {
    const key = `${work.id}|${candidateId}|${field}`;
    if (busy) return false;
    setBusy(key);
    setStatus(undefined);
    try {
      await api.reviewSuggestion(itemId, work.id, {
        commandId: randomId(),
        revision: item.revision,
        candidateId,
        field,
        decision,
        ...(value === undefined ? {} : { value }),
      });
      setStatus({
        error: false,
        text:
          decision === 'reject'
            ? `${fieldLabels[field]} kept as it was.`
            : `${fieldLabels[field]} updated. The earlier value is kept in your decisions.`,
      });
      return true;
    } catch (error) {
      setStatus({ error: true, text: messageOf(error) });
      return false;
    } finally {
      setBusy(undefined);
      await load();
    }
  }

  const latest = latestDecisions(decisions);
  const sourceLabel = (work: EnrichmentWork): string =>
    sources.find((s) => s.id === work.attachmentId)?.label ??
    (work.inputKind === 'photo' ? 'A removed photo' : 'A removed receipt');

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" className="-ml-3 min-h-11">
          <Link href={back}>
            <ArrowLeftIcon aria-hidden="true" />
            Back to item
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Suggestions from photos and receipts</h1>
        <p className="text-muted-foreground">{item.name}</p>
        <Alert role="note">
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>Read privately, changed only by you</AlertTitle>
          <AlertDescription>
            <p>
              Havefolio reads the text on Havefolio’s own server. Your images and their text are
              never sent to another service. Nothing on the item changes until you choose to use a
              suggestion. The recognised text is thrown away; only the suggestions shown here are
              kept with this item.
            </p>
          </AlertDescription>
        </Alert>
        {!anyAvailable ? (
          <Alert role="note">
            <ScanTextIcon aria-hidden="true" />
            <AlertTitle>Reading text isn’t turned on</AlertTitle>
            <AlertDescription>
              <p>
                This Havefolio can’t read photos or receipts right now. You can still add or edit
                every detail yourself on the item page.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        {!online ? (
          <p role="status" className="text-sm text-muted-foreground">
            You’re offline. Reading and decisions need a connection; nothing is lost.
          </p>
        ) : null}
        {status ? (
          <p role={status.error ? 'alert' : 'status'} className="text-sm">
            {status.text}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="sources-heading" className="space-y-3">
        <div>
          <h2 id="sources-heading" className="text-lg font-semibold">
            Choose a photo or receipt
          </h2>
          <p className="text-sm text-muted-foreground">
            Reading takes a few seconds. You can read the same image again later.
          </p>
        </div>
        {sources.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {sources.map((source) => {
              const pdf =
                source.kind === 'receipt' && source.document.mimeType === 'application/pdf';
              return (
                <li key={source.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                    {source.kind === 'photo' ? (
                      <PrivatePhoto
                        {...photoSource(itemId, source.photo, '', '4rem')}
                        announceFailure={false}
                        failedLabel={`${source.label} could not load.`}
                      />
                    ) : (
                      <FileTextIcon
                        aria-hidden="true"
                        className="m-auto mt-5 size-6 text-muted-foreground"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{source.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {pdf
                        ? 'PDF — can’t be read yet'
                        : source.kind === 'photo'
                          ? 'Photo'
                          : 'Receipt image'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={pdf || !available(source.kind) || !online || Boolean(busy)}
                    aria-label={`Read text from ${source.label}`}
                    onClick={() => void read(source)}
                  >
                    <ScanTextIcon aria-hidden="true" />
                    {busy === source.id ? 'Asking…' : 'Read text'}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="space-y-3 rounded-lg border border-dashed p-4 text-sm">
            <p>
              Add a photo or a picture of the receipt to this item first. Suggestions are always
              optional.
            </p>
            <Button asChild variant="outline" className="min-h-11">
              <Link href={back}>Go to the item</Link>
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="suggestions-heading" className="space-y-4">
        <h2 id="suggestions-heading" className="text-lg font-semibold">
          Suggestions
        </h2>
        {ours.length ? (
          <ul className="space-y-4">
            {ours.map((work) => (
              <li key={work.id}>
                <WorkCard
                  work={work}
                  item={item}
                  label={sourceLabel(work)}
                  current={workIsCurrent(work, decisions, item.revision)}
                  latest={latest}
                  busy={busy}
                  online={online}
                  onDecide={decide}
                  onReadAgain={(() => {
                    const source = sources.find((s) => s.id === work.attachmentId);
                    return source && available(source.kind) ? () => void read(source) : undefined;
                  })()}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No suggestions yet. Choose an image above when you’d like Havefolio to read it.
          </p>
        )}
      </section>

      <DecisionHistory decisions={decisions} />
    </div>
  );
}

function WorkCard({
  work,
  item,
  label,
  current,
  latest,
  busy,
  online,
  onDecide,
  onReadAgain,
}: {
  work: EnrichmentWork;
  item: ItemResponse;
  label: string;
  current: boolean;
  latest: Map<string, EnrichmentReviewEvent>;
  busy: string | undefined;
  online: boolean;
  onDecide: (
    work: EnrichmentWork,
    candidateId: string,
    field: EnrichmentField,
    decision: 'accept' | 'reject' | 'correct',
    value?: string,
  ) => Promise<boolean>;
  onReadAgain: (() => void) | undefined;
}): ReactElement {
  const headingId = useId();
  const again = onReadAgain ? (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={!online || Boolean(busy)}
      onClick={onReadAgain}
    >
      Read it again
    </Button>
  ) : null;
  let body: ReactElement;
  if (activeStates.has(work.state))
    body = (
      <p role="status" className="text-sm">
        Reading… This usually takes a few seconds. You can leave this page; nothing changes on its
        own.
      </p>
    );
  else if (work.state === 'unconfigured')
    body = (
      <p className="text-sm">Reading wasn’t available for this request. Your item is unchanged.</p>
    );
  else if (work.state === 'failed')
    body = (
      <div className="space-y-3 text-sm">
        <p>
          This image couldn’t be read. Your item is unchanged, and you can enter details yourself at
          any time.
        </p>
        {again}
      </div>
    );
  else if (work.state === 'stale')
    body = (
      <div className="space-y-3 text-sm">
        <p>
          The item or image changed while this was waiting, so it was set aside without suggestions.
        </p>
        {again}
      </div>
    );
  else if (!work.candidates.length)
    body = (
      <p className="text-sm">
        No item details could be read clearly. Nothing was changed. A sharper, well-lit photo may
        help.
      </p>
    );
  else
    body = (
      <div className="space-y-4">
        {!current ? (
          <Alert role="note">
            <Undo2Icon aria-hidden="true" />
            <AlertTitle>These suggestions are out of date</AlertTitle>
            <AlertDescription>
              <p>
                The item changed after they were made, so they can’t be used safely. Your earlier
                decisions are kept below.
              </p>
              {again}
            </AlertDescription>
          </Alert>
        ) : null}
        {work.candidates.length > 1 ? (
          <p className="text-sm text-muted-foreground">
            This receipt lists more than one thing. Use the line that matches this item; each amount
            belongs only to its own line.
          </p>
        ) : null}
        {work.candidates.map((candidate) => (
          <div key={candidate.id} className="space-y-3 rounded-lg border p-3">
            <h4 className="font-medium">{candidateTitle(candidate.id)}</h4>
            <ul className="divide-y">
              {candidate.fields.map((suggestion) => (
                <li key={suggestion.field} className="py-3 first:pt-0 last:pb-0">
                  <FieldReview
                    work={work}
                    candidateId={candidate.id}
                    item={item}
                    field={suggestion.field}
                    value={suggestion.value}
                    confidence={suggestion.confidence}
                    reference={suggestion.source.reference}
                    decision={latest.get(`${work.id}|${candidate.id}|${suggestion.field}`)}
                    disabled={!current || !online || Boolean(busy)}
                    working={busy === `${work.id}|${candidate.id}|${suggestion.field}`}
                    onDecide={onDecide}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  return (
    <article aria-labelledby={headingId} className="space-y-3 rounded-xl border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
          From {label}
        </h3>
        <p className="text-sm text-muted-foreground">Asked {auditTime(work.createdAt)}</p>
      </header>
      {body}
    </article>
  );
}

const bandVariant = { clear: 'secondary', check: 'outline', unclear: 'outline' } as const;

function FieldReview({
  work,
  candidateId,
  item,
  field,
  value,
  confidence,
  reference,
  decision,
  disabled,
  working,
  onDecide,
}: {
  work: EnrichmentWork;
  candidateId: string;
  item: ItemResponse;
  field: EnrichmentField;
  value: string;
  confidence: number;
  reference: string;
  decision: EnrichmentReviewEvent | undefined;
  disabled: boolean;
  working: boolean;
  onDecide: (
    work: EnrichmentWork,
    candidateId: string,
    field: EnrichmentField,
    decision: 'accept' | 'reject' | 'correct',
    value?: string,
  ) => Promise<boolean>;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const shown = evidence(confidence, reference);
  const label = fieldLabels[field];
  const decided = decision
    ? decision.decision === 'reject'
      ? 'You kept your value'
      : decision.decision === 'correct'
        ? `You corrected it to ${displayValue(field, decision.confirmedValue)}`
        : 'You used this'
    : undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Badge variant={bandVariant[shown.band]}>{bandLabels[shown.band]}</Badge>
        {decided ? (
          <Badge variant="outline">
            <CheckIcon aria-hidden="true" />
            Decided
          </Badge>
        ) : null}
      </div>
      <p className="font-medium break-words">
        <span className="sr-only">Suggested {label.toLowerCase()}: </span>
        {displayValue(field, value)}
      </p>
      <p className="text-sm text-muted-foreground">
        Currently: {displayValue(field, currentValue(item, field))}
      </p>
      {shown.band === 'unclear' ? (
        <p className="text-sm">Unclear — compare it with the image before using it.</p>
      ) : null}
      {shown.caveats.length || shown.text ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {shown.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
          {shown.text ? (
            <li>
              Read from line {shown.line}: <q className="break-words">{shown.text}</q>
            </li>
          ) : null}
        </ul>
      ) : null}
      {field === 'pricePaid' && item.acquisitionType === 'gift' ? (
        <p className="text-sm text-muted-foreground">
          This item is recorded as a gift. Using an amount records that you paid it.
        </p>
      ) : null}
      {decided ? <p className="text-sm">{decided}.</p> : null}
      {editing ? (
        <CorrectionForm
          field={field}
          suggested={value}
          item={item}
          disabled={disabled}
          onCancel={() => setEditing(false)}
          onSave={async (corrected) => {
            if (await onDecide(work, candidateId, field, 'correct', corrected)) setEditing(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={shown.band === 'clear' ? 'default' : 'outline'}
            className="min-h-11"
            disabled={disabled}
            aria-label={`Use suggested ${label.toLowerCase()}`}
            onClick={() => void onDecide(work, candidateId, field, 'accept')}
          >
            <CheckIcon aria-hidden="true" />
            {working ? 'Saving…' : 'Use this'}
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled}
            aria-label={`Edit suggested ${label.toLowerCase()} before using it`}
            onClick={() => setEditing(true)}
          >
            <PencilIcon aria-hidden="true" />
            Edit
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={disabled}
            aria-label={`Keep current ${label.toLowerCase()}`}
            onClick={() => void onDecide(work, candidateId, field, 'reject')}
          >
            Keep current
          </Button>
        </div>
      )}
    </div>
  );
}

/** Builds the canonical correction value; amounts and dates are validated, never rounded. */
function CorrectionForm({
  field,
  suggested,
  item,
  disabled,
  onCancel,
  onSave,
}: {
  field: EnrichmentField;
  suggested: string;
  item: ItemResponse;
  disabled: boolean;
  onCancel: () => void;
  onSave: (value: string) => Promise<void>;
}): ReactElement {
  const id = useId();
  const money = field === 'pricePaid' ? parsePricePaidValue(suggested) : null;
  const date = field === 'purchaseDate' ? parsePurchaseDateValue(suggested) : null;
  const [text, setText] = useState(
    field === 'pricePaid' || field === 'purchaseDate' ? '' : suggested,
  );
  const [currency, setCurrency] = useState(money?.currency ?? item.currency);
  // The owner edits a plain decimal; the suggestion itself is integer minor units.
  const [amount, setAmount] = useState(money ? toDecimalString(money) : '');
  const [precision, setPrecision] = useState<'exact' | 'month' | 'year'>(
    date?.precision ?? 'exact',
  );
  const [exactDate, setExactDate] = useState(
    date?.precision === 'exact' ? formatPurchaseDateValue(date) : '',
  );
  const [month, setMonth] = useState(date && date.precision !== 'year' ? String(date.month) : '');
  const [year, setYear] = useState(date ? String(date.year) : '');
  const [error, setError] = useState<string | undefined>();
  const label = fieldLabels[field];

  function value(): string | undefined {
    if (field === 'pricePaid') {
      try {
        return formatPricePaidValue(parseDecimalAmount(amount, currency));
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
        setError(amountEntryMessage(code, currency));
        return undefined;
      }
    }
    if (field === 'purchaseDate') {
      const candidate =
        precision === 'exact'
          ? exactDate
          : precision === 'month'
            ? `${year}-${month.padStart(2, '0')}`
            : year;
      if (!parsePurchaseDateValue(candidate)) {
        setError('Enter a real date at the precision you know. Leave out what you don’t know.');
        return undefined;
      }
      return candidate;
    }
    if (!validEnrichmentValue(field, text)) {
      setError(
        `Enter a ${label.toLowerCase()} up to ${field === 'description' ? '5,000' : '300'} characters.`,
      );
      return undefined;
    }
    return text;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    const corrected = value();
    if (corrected !== undefined) await onSave(corrected);
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="grid min-w-0 gap-3 rounded-lg border p-3"
    >
      <fieldset disabled={disabled} className="grid min-w-0 gap-3">
        <legend className="font-medium">Correct the {label.toLowerCase()}</legend>
        {field === 'pricePaid' ? (
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-currency`}>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id={`${id}-currency`} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...new Set([currency, item.currency, ...popularCurrencies.map((c) => c.code)]),
                  ].map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${id}-amount`}>Amount paid</Label>
              <Input
                id={`${id}-amount`}
                className="min-h-11 text-base md:text-sm"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        ) : field === 'purchaseDate' ? (
          <>
            <RadioGroup
              value={precision}
              onValueChange={(v) => setPrecision(v as typeof precision)}
              className="flex flex-wrap gap-x-6 gap-y-1"
              aria-label="How precisely you know the date"
            >
              {(
                [
                  ['exact', 'Exact date'],
                  ['month', 'Month and year'],
                  ['year', 'Year only'],
                ] as const
              ).map(([v, l]) => (
                <Label
                  key={v}
                  htmlFor={`${id}-precision-${v}`}
                  className="flex min-h-11 items-center gap-3 font-normal"
                >
                  <RadioGroupItem id={`${id}-precision-${v}`} value={v} />
                  {l}
                </Label>
              ))}
            </RadioGroup>
            {precision === 'exact' ? (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-date`}>Date</Label>
                <DateInput
                  id={`${id}-date`}
                  className="min-h-11"
                  value={exactDate}
                  onChange={setExactDate}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {precision === 'month' ? (
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={`${id}-month`}>Month</Label>
                    <Select value={month} onValueChange={setMonth}>
                      <SelectTrigger id={`${id}-month`} className="min-h-11 w-full">
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
                  </div>
                ) : null}
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor={`${id}-year`}>Year</Label>
                  <Input
                    id={`${id}-year`}
                    className="min-h-11 text-base md:text-sm"
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                    value={year}
                    onChange={(e) => setYear(e.target.value.trim())}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={`${id}-text`}>{label}</Label>
            <Input
              id={`${id}-text`}
              className="min-h-11 text-base md:text-sm"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11">
            Save correction
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function DecisionHistory({ decisions }: { decisions: EnrichmentReviewEvent[] }): ReactElement {
  const ordered = [...decisions].sort((a, b) => b.resultingRevision - a.resultingRevision);
  return (
    <section aria-labelledby="decisions-heading" className="space-y-3">
      <div>
        <h2 id="decisions-heading" className="text-lg font-semibold">
          Your decisions
        </h2>
        <p className="text-sm text-muted-foreground">
          Each decision keeps the value before and after, so nothing you entered is lost. Your
          original entry is also kept.
        </p>
      </div>
      {ordered.length ? (
        <ul className="divide-y rounded-lg border">
          {ordered.map((event) => (
            <li key={event.id} className="space-y-1 p-3 text-sm">
              <p className="font-medium">
                {fieldLabels[event.field]}:{' '}
                {event.decision === 'reject'
                  ? 'kept your value'
                  : event.decision === 'correct'
                    ? 'corrected'
                    : 'used suggestion'}
              </p>
              <p className="text-muted-foreground break-words">
                Before: {displayValue(event.field, event.previousValue)} · After:{' '}
                {displayValue(event.field, event.confirmedValue)}
              </p>
              <p className="text-muted-foreground">{auditTime(event.createdAt)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No decisions yet.
        </p>
      )}
    </section>
  );
}
