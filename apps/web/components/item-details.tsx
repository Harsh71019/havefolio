'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  HandHeartIcon,
  ListPlusIcon,
  PencilIcon,
  SearchXIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
  WifiOffIcon,
  type LucideIcon,
} from 'lucide-react';
import type {
  ItemActionRequest,
  ItemDocument,
  ItemDocumentKind,
  ItemDocumentSnapshot,
  ItemEventsPage,
  ItemListEntry,
  ItemPhotoSnapshot,
  ItemResponse,
  ItemsPage,
  ItemStatus,
  TaxonomySnapshot,
  UpdateItemRequest,
} from '@havefolio/contracts';
import { Badge } from '@havefolio/ui/components/badge';
import { Button } from '@havefolio/ui/components/button';
import { Card, CardContent } from '@havefolio/ui/components/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@havefolio/ui/components/empty';
import { Pill } from '@havefolio/ui/components/kibo-ui/pill';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import { toast } from '@havefolio/ui/components/sonner';
import {
  DocumentRequestError,
  deleteDocument,
  fetchDocuments,
  uploadDocument,
} from './documents-client';
import { ItemDocuments, ItemPhotosSummary, type Loadable } from './item-attachments';
import {
  acquisitionLabels,
  auditTime,
  conditionLabels,
  frequencyLabels,
  pricePaid,
  provenanceText,
  purchaseDateText,
  type Shown,
} from './item-detail-presentation';
import { ItemEditDialog, type EditSection, type ItemDraft } from './item-edit-dialog';
import { ItemHistory, type HistoryState } from './item-history';
import { DeleteItemSection, LifecycleActions } from './item-lifecycle';
import { isInactive, statusLabel } from './item-presentation';
import {
  deleteItem,
  ItemRequestError,
  readItem,
  readItemHistory,
  readRelatedItems,
  recordItemAction,
  updateItem,
} from './items-client';
import {
  deletedFlashKey,
  itemDetailHref,
  itemPhotosHref,
  safeReturnPath,
} from './navigation-context';
import { fetchPhotos, PhotoRequestError } from './photos-client';
import { taxonomyRequest } from './taxonomy-client';

/** Injectable seam so component tests exercise real UI against a fake API. */
export interface ItemDetailsApi {
  readItem(id: string): Promise<ItemResponse>;
  updateItem(id: string, input: UpdateItemRequest): Promise<ItemResponse>;
  recordItemAction(id: string, input: ItemActionRequest): Promise<ItemResponse>;
  readItemHistory(id: string, after?: string | null): Promise<ItemEventsPage>;
  deleteItem(id: string, revision: number): Promise<void>;
  readRelatedItems(filter: { categoryId: string } | { tagId: string }): Promise<ItemsPage>;
  loadTaxonomy(): Promise<TaxonomySnapshot>;
  fetchPhotos(id: string): Promise<ItemPhotoSnapshot>;
  fetchDocuments(id: string): Promise<ItemDocumentSnapshot>;
  uploadDocument(
    id: string,
    uploadId: string,
    kind: ItemDocumentKind,
    file: File,
  ): Promise<ItemDocument>;
  deleteDocument(id: string, documentId: string, revision: number): Promise<ItemDocumentSnapshot>;
}

export const apiItemDetails: ItemDetailsApi = {
  readItem,
  updateItem,
  recordItemAction,
  readItemHistory,
  deleteItem,
  readRelatedItems: (filter) => readRelatedItems(filter),
  loadTaxonomy: () => taxonomyRequest(),
  fetchPhotos,
  fetchDocuments,
  uploadDocument,
  deleteDocument,
};

const statusIcons: Record<ItemStatus, LucideIcon> = {
  owned: CircleCheckIcon,
  sold: TagIcon,
  donated: HandHeartIcon,
  disposed: Trash2Icon,
  lost: SearchXIcon,
  returned: Undo2Icon,
};

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

type Load =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ItemRequestError }
  | { kind: 'ready'; item: ItemResponse };

const asItemError = (error: unknown): ItemRequestError =>
  error instanceof ItemRequestError
    ? error
    : new ItemRequestError(500, 'Something went wrong. Try again.');
const mediaMessage = (error: unknown): { message: string; disabled?: boolean } =>
  error instanceof DocumentRequestError
    ? { message: error.message, ...(error.disabled ? { disabled: true } : {}) }
    : error instanceof PhotoRequestError
      ? { message: error.message }
      : { message: 'Try again.' };

type MissingDetail = { label: string; section: EditSection; field: string };
/** Optional details not yet recorded; shown as invitations, never as requirements. */
function missingDetails(item: ItemResponse): MissingDetail[] {
  const missing: MissingDetail[] = [];
  if (!item.brand) missing.push({ label: 'Brand', section: 'basics', field: 'brand' });
  if (!item.model) missing.push({ label: 'Model', section: 'basics', field: 'model' });
  if (item.pricePaidMinor === null && item.acquisitionType !== 'gift')
    missing.push({ label: 'Price paid', section: 'purchase', field: 'amount' });
  if (item.purchaseDate.precision === 'unknown')
    missing.push({ label: 'When you got it', section: 'purchase', field: 'exactDate' });
  if (item.acquisitionType === 'unknown')
    missing.push({ label: 'How you got it', section: 'purchase', field: 'acquisitionType' });
  if (item.condition === 'unknown')
    missing.push({ label: 'Condition', section: 'state', field: 'condition' });
  if (item.useFrequency === 'unknown')
    missing.push({ label: 'How often you use it', section: 'state', field: 'useFrequency' });
  if (!item.categoryId)
    missing.push({ label: 'Category', section: 'classification', field: 'category' });
  if (!item.notes) missing.push({ label: 'Notes', section: 'notes', field: 'notes' });
  return missing;
}

export function ItemDetails({
  itemId,
  returnTo: rawReturnTo,
  api = apiItemDetails,
}: {
  itemId: string;
  returnTo?: string | undefined;
  api?: ItemDetailsApi;
}): ReactElement {
  const router = useRouter();
  const returnTo = safeReturnPath(rawReturnTo);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [taxonomy, setTaxonomy] = useState<TaxonomySnapshot | undefined>();
  const [history, setHistory] = useState<HistoryState>({ kind: 'loading' });
  const [photos, setPhotos] = useState<Loadable<ItemPhotoSnapshot>>({ kind: 'loading' });
  const [documents, setDocuments] = useState<Loadable<ItemDocumentSnapshot>>({ kind: 'loading' });
  const [relatedState, setRelated] = useState<
    { key: string; label: string; items: ItemListEntry[] } | undefined
  >();
  const [editing, setEditing] = useState<{ section: EditSection; field?: string } | undefined>();
  const [drafts, setDrafts] = useState<Partial<Record<EditSection, ItemDraft>>>({});
  const [addDetails, setAddDetails] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const editReturn = useRef<HTMLElement | null>(null);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  const announce = useCallback((text: string, visible = true): void => {
    setAnnouncement('');
    // Clear first so repeating the same sentence is announced again.
    window.setTimeout(() => setAnnouncement(text), 50);
    if (visible) toast.success(text);
  }, []);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistory({ kind: 'loading' });
    try {
      const page = await api.readItemHistory(itemId);
      setHistory({
        kind: 'ready',
        events: page.events,
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (error) {
      setHistory({ kind: 'failed', message: asItemError(error).message });
    }
  }, [api, itemId]);
  const loadPhotos = useCallback(async (): Promise<void> => {
    try {
      setPhotos({ kind: 'ready', value: await api.fetchPhotos(itemId) });
    } catch (error) {
      setPhotos({ kind: 'failed', ...mediaMessage(error) });
    }
  }, [api, itemId]);
  const loadDocuments = useCallback(async (): Promise<void> => {
    try {
      setDocuments({ kind: 'ready', value: await api.fetchDocuments(itemId) });
    } catch (error) {
      setDocuments({ kind: 'failed', ...mediaMessage(error) });
    }
  }, [api, itemId]);

  const loadItem = useCallback(async (): Promise<ItemResponse | undefined> => {
    try {
      const item = await api.readItem(itemId);
      setLoad({ kind: 'ready', item });
      return item;
    } catch (error) {
      setLoad({ kind: 'failed', error: asItemError(error) });
      return undefined;
    }
  }, [api, itemId]);

  useEffect(() => {
    let active = true;
    void api
      .readItem(itemId)
      .then((item) => {
        if (!active) return;
        setLoad({ kind: 'ready', item });
        void loadHistory();
        void loadPhotos();
        void loadDocuments();
        api
          .loadTaxonomy()
          .then((t) => active && setTaxonomy(t))
          .catch(() => undefined);
      })
      .catch((error: unknown) => active && setLoad({ kind: 'failed', error: asItemError(error) }));
    return () => {
      active = false;
    };
  }, [api, itemId, loadDocuments, loadHistory, loadPhotos]);

  const item = load.kind === 'ready' ? load.item : undefined;
  const relatedKey = item ? `${item.categoryId ?? ''}|${item.tagIds[0] ?? ''}` : '';
  useEffect(() => {
    if (!item) return;
    const filter = item.categoryId
      ? { categoryId: item.categoryId }
      : item.tagIds[0]
        ? { tagId: item.tagIds[0] }
        : undefined;
    if (!filter) return;
    let active = true;
    api
      .readRelatedItems(filter)
      .then((page) => {
        if (!active) return;
        const items = page.items.filter((i) => i.id !== item.id).slice(0, 6);
        setRelated({ key: relatedKey, label: 'categoryId' in filter ? 'category' : 'tag', items });
      })
      .catch(() => active && setRelated(undefined));
    return () => {
      active = false;
    };
    // Re-query only when the classification used for the relationship changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, relatedKey]);

  // Results for an earlier classification are never shown against the current one.
  const related = relatedState?.key === relatedKey ? relatedState : undefined;

  if (load.kind === 'loading') return <DetailSkeleton returnTo={returnTo} />;
  if (load.kind === 'failed')
    return (
      <DetailFailure
        error={load.error}
        returnTo={returnTo}
        onRetry={() => {
          setLoad({ kind: 'loading' });
          void loadItem().then((loaded) => {
            if (!loaded) return;
            void loadHistory();
            void loadPhotos();
            void loadDocuments();
          });
        }}
      />
    );
  const current = load.item;

  const applyItem = (next: ItemResponse, message: string): void => {
    setLoad({ kind: 'ready', item: next });
    announce(message);
    void loadHistory();
  };
  const categoryName = (id: string | null): string | undefined =>
    id ? taxonomy?.categories.find((c) => c.id === id)?.name : undefined;
  const subcategoryName = (id: string | null): string | undefined =>
    id ? taxonomy?.subcategories.find((c) => c.id === id)?.name : undefined;
  const missing = missingDetails(current);
  const Icon = statusIcons[current.ownershipStatus];
  const openEditor = (section: EditSection, field?: string, from?: HTMLElement | null): void => {
    editReturn.current = from ?? null;
    setEditing({ section, ...(field ? { field } : {}) });
  };
  const sectionEdit = (section: EditSection, label: string): ReactElement => (
    <Button
      variant="ghost"
      className="min-h-11"
      aria-label={`Edit ${label}`}
      onClick={(e) => openEditor(section, undefined, e.currentTarget)}
    >
      <PencilIcon aria-hidden="true" />
      Edit
    </Button>
  );
  const price = pricePaid(current);
  const date = purchaseDateText(current.purchaseDate);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10 lg:px-12">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <Button asChild variant="ghost" className="-ml-3 min-h-11">
        <Link href={returnTo}>
          <ArrowLeftIcon aria-hidden="true" />
          Back to My Store
        </Link>
      </Button>
      {!online ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border p-3 text-sm">
          <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
          You are offline. Details stay visible; changes can be saved once you reconnect.
        </div>
      ) : null}

      <header className="space-y-4">
        <div className="space-y-2">
          <Badge
            variant={isInactive(current.ownershipStatus) ? 'outline' : 'secondary'}
            className="gap-1.5 text-sm"
          >
            <Icon aria-hidden="true" />
            <span>
              <span className="sr-only">Status: </span>
              {statusLabel(current.ownershipStatus)}
              {isInactive(current.ownershipStatus) ? ' · no longer in your home' : ''}
            </span>
          </Badge>
          <h1
            id="item-heading"
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight break-words outline-none sm:text-4xl"
          >
            {current.name}
          </h1>
          {current.brand || current.model ? (
            <p className="text-lg break-words text-muted-foreground">
              {[current.brand, current.model].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <LifecycleActions
          item={current}
          online={online}
          onRecord={(input) => api.recordItemAction(current.id, input)}
          onRecorded={applyItem}
          onFailure={async () => {
            await loadItem();
            void loadHistory();
          }}
        />
        {missing.length ? (
          <Button
            variant="link"
            className="h-auto min-h-11 px-0"
            onClick={() => setAddDetails(true)}
          >
            <ListPlusIcon aria-hidden="true" />
            Add details ({missing.length} optional)
          </Button>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <div className="min-w-0 space-y-6">
          <DetailCard
            title="Purchase"
            headingId="purchase-heading"
            action={sectionEdit('purchase', 'purchase details')}
          >
            <Facts
              facts={[
                [current.acquisitionType === 'gift' ? 'Amount you paid' : 'Price paid', price],
                ['When you got it', date],
                [
                  'How you got it',
                  {
                    value: acquisitionLabels[current.acquisitionType],
                    muted: current.acquisitionType === 'unknown',
                  },
                ],
              ]}
            />
          </DetailCard>

          <DetailCard
            title="Condition and use"
            headingId="state-heading"
            action={sectionEdit('state', 'condition and use')}
          >
            <Facts
              facts={[
                [
                  'Condition',
                  {
                    value: conditionLabels[current.condition],
                    muted: current.condition === 'unknown',
                  },
                ],
                [
                  'How often you use it',
                  {
                    value: frequencyLabels[current.useFrequency],
                    muted: current.useFrequency === 'unknown',
                  },
                ],
                [
                  'Ownership',
                  {
                    value: statusLabel(current.ownershipStatus),
                    note: 'Changed with the actions above, so it keeps a history.',
                  },
                ],
              ]}
            />
          </DetailCard>

          <DetailCard
            title="Category and tags"
            headingId="classification-heading"
            action={sectionEdit('classification', 'category and tags')}
          >
            <Facts
              facts={[
                [
                  'Category',
                  current.categoryId
                    ? {
                        value:
                          categoryName(current.categoryId) ??
                          (taxonomy ? 'Unavailable' : 'Loading…'),
                      }
                    : { value: 'Uncategorised', muted: true },
                ],
                [
                  'Subcategory',
                  current.subcategoryId
                    ? {
                        value:
                          subcategoryName(current.subcategoryId) ??
                          (taxonomy ? 'Unavailable' : 'Loading…'),
                      }
                    : { value: 'None', muted: true },
                ],
              ]}
            />
            <div className="mt-4">
              <h3 className="text-sm text-muted-foreground">Tags</h3>
              {current.tagIds.length ? (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Tags">
                  {current.tagIds.map((tagId) => (
                    <li key={tagId}>
                      <Pill>{taxonomy?.tags.find((t) => t.id === tagId)?.name ?? 'Tag'}</Pill>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No tags</p>
              )}
            </div>
          </DetailCard>

          <DetailCard
            title="About"
            headingId="basics-heading"
            action={sectionEdit('basics', 'name, brand, model and description')}
          >
            <Facts
              facts={[
                [
                  'Brand',
                  current.brand ? { value: current.brand } : { value: 'Not added', muted: true },
                ],
                [
                  'Model',
                  current.model ? { value: current.model } : { value: 'Not added', muted: true },
                ],
              ]}
            />
            {current.description ? (
              <p className="mt-4 break-words whitespace-pre-line">{current.description}</p>
            ) : null}
          </DetailCard>

          <DetailCard
            title="Notes and specifications"
            headingId="notes-heading"
            action={sectionEdit('notes', 'notes and specifications')}
          >
            <h3 className="text-sm text-muted-foreground">Notes</h3>
            {current.notes ? (
              <p className="mt-1 break-words whitespace-pre-line">{current.notes}</p>
            ) : (
              <p className="mt-1 text-muted-foreground">No notes yet</p>
            )}
            <h3 className="mt-4 text-sm text-muted-foreground">Specifications</h3>
            {current.specifications && Object.keys(current.specifications).length ? (
              <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                {Object.entries(current.specifications).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="break-words text-muted-foreground">{key}</dt>
                    <dd className="break-words">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-1 text-muted-foreground">None recorded</p>
            )}
          </DetailCard>

          <Card>
            <CardContent>
              <ItemHistory
                state={history}
                onRetry={() => void loadHistory()}
                onLoadMore={() => {
                  if (history.kind !== 'ready' || !history.nextCursor) return;
                  setHistory({ ...history, loadingMore: true });
                  api
                    .readItemHistory(current.id, history.nextCursor)
                    .then((page) =>
                      setHistory((h) =>
                        h.kind === 'ready'
                          ? {
                              kind: 'ready',
                              events: [
                                ...h.events,
                                ...page.events.filter((e) => !h.events.some((x) => x.id === e.id)),
                              ],
                              nextCursor: page.nextCursor,
                              loadingMore: false,
                            }
                          : h,
                      ),
                    )
                    .catch((error: unknown) =>
                      setHistory((h) =>
                        h.kind === 'ready'
                          ? { ...h, loadingMore: false, moreError: asItemError(error).message }
                          : h,
                      ),
                    );
                }}
              />
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Photos, documents and related items">
          <Card>
            <CardContent>
              <ItemPhotosSummary
                itemId={current.id}
                itemName={current.name}
                state={photos}
                manageHref={itemPhotosHref(current.id, returnTo)}
                onRetry={() => {
                  setPhotos({ kind: 'loading' });
                  void loadPhotos();
                }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <ItemDocuments
                itemId={current.id}
                state={documents}
                online={online}
                onRetry={() => {
                  setDocuments({ kind: 'loading' });
                  void loadDocuments();
                }}
                onUpload={async (kind, file, uploadId) => {
                  const added = await api.uploadDocument(current.id, uploadId, kind, file);
                  // Document changes advance the item revision; keep it current for edits.
                  await Promise.all([loadDocuments(), loadItem()]);
                  announce(`${kind === 'receipt' ? 'Receipt' : 'Warranty'} added.`, false);
                  return added;
                }}
                onDelete={async (doc, revision) => {
                  try {
                    const snapshot = await api.deleteDocument(current.id, doc.id, revision);
                    setDocuments({ kind: 'ready', value: snapshot });
                    await loadItem();
                    announce('Document removed.', false);
                  } catch (error) {
                    await loadDocuments();
                    throw error;
                  }
                }}
              />
            </CardContent>
          </Card>
          {related?.items.length ? (
            <Card>
              <CardContent className="space-y-3">
                <h2 id="related-heading" className="text-lg font-semibold">
                  {related.label === 'category'
                    ? `Also in ${categoryName(current.categoryId) ?? 'this category'}`
                    : `Also tagged ${taxonomy?.tags.find((t) => t.id === current.tagIds[0])?.name ?? 'the same'}`}
                </h2>
                <ul aria-labelledby="related-heading" className="divide-y">
                  {related.items.map((other) => (
                    <li key={other.id}>
                      <Link
                        href={itemDetailHref(other.id, returnTo)}
                        className="flex min-h-11 items-center justify-between gap-3 py-2 underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="min-w-0 break-words">{other.name}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {statusLabel(other.ownershipStatus)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="space-y-3">
              <h2 className="text-lg font-semibold">Record</h2>
              <Facts
                facts={[
                  ['Added', { value: auditTime(current.createdAt) }],
                  ['Last updated', { value: auditTime(current.updatedAt) }],
                  ['Source', { value: provenanceText(current.originalSource) }],
                ]}
              />
            </CardContent>
          </Card>
        </aside>
      </div>

      <DeleteItemSection
        item={current}
        online={online}
        photoCount={photos.kind === 'ready' ? photos.value.photos.length : undefined}
        documentCount={documents.kind === 'ready' ? documents.value.documents.length : undefined}
        onDelete={(revision) => api.deleteItem(current.id, revision)}
        onDeleted={() => {
          try {
            window.sessionStorage.setItem(deletedFlashKey, current.name);
          } catch {
            // Storage unavailable: My Store still loads without the deleted item.
          }
          router.replace(returnTo);
          router.refresh();
        }}
        onStale={async () => {
          await Promise.all([loadItem(), loadPhotos(), loadDocuments()]);
          void loadHistory();
        }}
      />

      <ItemEditDialog
        item={current}
        section={editing?.section}
        focusField={editing?.field}
        taxonomy={taxonomy}
        online={online}
        draft={editing ? drafts[editing.section] : undefined}
        onDraftChange={(section, draft) =>
          setDrafts((all) => {
            const next = { ...all };
            if (draft) next[section] = draft;
            else delete next[section];
            return next;
          })
        }
        onClose={() => {
          setEditing(undefined);
          window.setTimeout(
            () => (editReturn.current ?? document.getElementById('item-heading'))?.focus(),
            0,
          );
        }}
        onSave={(input) => api.updateItem(current.id, input)}
        onReload={loadItem}
        onSaved={(saved, message) => {
          setEditing(undefined);
          applyItem(saved, message);
          window.setTimeout(
            () => (editReturn.current ?? document.getElementById('item-heading'))?.focus(),
            0,
          );
        }}
      />

      <Dialog open={addDetails} onOpenChange={setAddDetails}>
        <DialogContent className="max-h-[92svh] overflow-y-auto motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none">
          <DialogHeader>
            <DialogTitle>Add details</DialogTitle>
            <DialogDescription>
              All optional. Add what you know now — anything you skip can stay empty.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2">
            {missing.map((m) => (
              <li key={m.label}>
                <Button
                  variant="outline"
                  className="min-h-11 w-full justify-start"
                  onClick={() => {
                    setAddDetails(false);
                    openEditor(m.section, m.field, null);
                  }}
                >
                  Add {m.label.toLowerCase()}
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function DetailCard({
  title,
  headingId,
  action,
  children,
}: {
  title: string;
  headingId: string;
  action: ReactElement;
  children: React.ReactNode;
}): ReactElement {
  return (
    <Card>
      <CardContent>
        <section aria-labelledby={headingId}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id={headingId} className="text-lg font-semibold">
              {title}
            </h2>
            {action}
          </div>
          {children}
        </section>
      </CardContent>
    </Card>
  );
}

function Facts({ facts }: { facts: [string, Shown][] }): ReactElement {
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {facts.map(([label, shown]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground sm:text-base">{label}</dt>
          <dd className="-mt-2 min-w-0 break-words sm:mt-0">
            <span className={shown.muted ? 'text-muted-foreground' : undefined}>{shown.value}</span>
            {shown.note ? (
              <span className="block text-sm text-muted-foreground">{shown.note}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailSkeleton({ returnTo }: { returnTo: string }): ReactElement {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10 lg:px-12">
      <p role="status" className="sr-only">
        Loading item.
      </p>
      <Button asChild variant="ghost" className="-ml-3 min-h-11">
        <Link href={returnTo}>
          <ArrowLeftIcon aria-hidden="true" />
          Back to My Store
        </Link>
      </Button>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-6 w-24 motion-reduce:animate-none" />
        <Skeleton className="h-10 w-2/3 motion-reduce:animate-none" />
        <Skeleton className="h-11 w-full max-w-md motion-reduce:animate-none" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Skeleton className="h-64 motion-reduce:animate-none" />
          <Skeleton className="h-64 motion-reduce:animate-none" />
        </div>
      </div>
    </main>
  );
}

function DetailFailure({
  error,
  returnTo,
  onRetry,
}: {
  error: ItemRequestError;
  returnTo: string;
  onRetry: () => void;
}): ReactElement {
  const notFound = error.status === 404;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <Card className="border-dashed py-0">
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h1>
                {notFound
                  ? 'This item is not in your inventory'
                  : error.unauthenticated
                    ? 'Please sign in again'
                    : 'This item could not load'}
              </h1>
            </EmptyTitle>
            <EmptyDescription role="alert">
              {notFound
                ? 'It may have been deleted, or the link is out of date.'
                : `${error.message} Nothing has been changed.`}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            {error.unauthenticated ? (
              <Button asChild className="min-h-11">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : notFound ? null : (
              <Button className="min-h-11" onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button asChild variant="outline" className="min-h-11">
              <Link href={returnTo}>Back to My Store</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </Card>
    </main>
  );
}
