'use client';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type FormEvent,
  type MouseEvent,
} from 'react';
import type {
  TagEntry,
  TaxonomyEntry,
  TaxonomySnapshot,
  SubcategoryEntry,
} from '@havefolio/contracts';
import { Button } from '@havefolio/ui/components/button';
import { Badge } from '@havefolio/ui/components/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@havefolio/ui/components/card';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';
import { Skeleton } from '@havefolio/ui/components/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@havefolio/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@havefolio/ui/components/select';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { TaxonomyRequestError, taxonomyRequest } from './taxonomy-client';

type Kind = 'categories' | 'subcategories' | 'tags';
type Entry = TaxonomyEntry | SubcategoryEntry | TagEntry;
type Action = {
  type: 'create' | 'rename' | 'delete' | 'retire' | 'restore';
  kind: Kind;
  entry?: Entry;
  parent?: string;
};
const kindLabel = (kind: Kind): string =>
  kind === 'categories' ? 'category' : kind === 'subcategories' ? 'subcategory' : 'tag';

export function TaxonomyManagement(): ReactElement {
  const [data, setData] = useState<TaxonomySnapshot>();
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const focusAfterMove = useRef<string | undefined>(undefined);
  const [action, setAction] = useState<Action>();
  const [name, setName] = useState('');
  const [replacement, setReplacement] = useState('');
  const [dialogError, setDialogError] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);

  useEffect(() => {
    if (!busy && focusAfterMove.current) {
      document.getElementById(focusAfterMove.current)?.focus();
      focusAfterMove.current = undefined;
    }
  }, [busy]);

  async function reload(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      setData(await taxonomyRequest());
      setUnauthenticated(false);
    } catch (failure) {
      setError((failure as Error).message);
      if (failure instanceof TaxonomyRequestError && failure.status === 401) {
        setData(undefined);
        setUnauthenticated(true);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    taxonomyRequest()
      .then((snapshot) => {
        if (active) {
          setData(snapshot);
          setUnauthenticated(false);
        }
      })
      .catch((failure: Error) => {
        if (active) {
          setError(failure.message);
          setUnauthenticated(failure instanceof TaxonomyRequestError && failure.status === 401);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  function open(next: Action, event: MouseEvent<HTMLButtonElement>): void {
    trigger.current = event.currentTarget;
    setAction(next);
    setName(next.type === 'rename' ? next.entry!.name : '');
    setReplacement('');
    setDialogError('');
    setMessage('');
  }
  async function mutate(
    path: string,
    method: string,
    body: object,
    success: string,
    inDialog = false,
  ): Promise<void> {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError('');
    setDialogError('');
    setMessage('');
    try {
      setData(await taxonomyRequest(path, method, body));
      setMessage(success);
      if (inDialog) setAction(undefined);
    } catch (failure) {
      const text = (failure as Error).message;
      if (failure instanceof TaxonomyRequestError && failure.status === 401) {
        setData(undefined);
        setAction(undefined);
        setUnauthenticated(true);
        setError(text);
      } else if (inDialog) setDialogError(text);
      else setError(text);
    } finally {
      setBusy(false);
      requestInFlight.current = false;
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!action) return;
    const { type, kind, entry, parent } = action;
    const path = `/${kind}${type === 'create' ? '' : `/${entry!.id}`}`;
    const body =
      type === 'create'
        ? { name, ...(parent ? { categoryId: parent } : {}) }
        : type === 'rename'
          ? { name }
          : type === 'delete'
            ? kind === 'tags'
              ? { removeRelationships: true }
              : {
                  ...(replacement ? { replacementId: replacement } : {}),
                  ...(kind === 'categories' ? { removeSubcategories: true } : {}),
                }
            : { retired: type === 'retire' };
    await mutate(
      path,
      type === 'create' ? 'POST' : type === 'delete' ? 'DELETE' : 'PATCH',
      body,
      `${kindLabel(kind)} ${type === 'create' ? 'created' : type === 'rename' ? 'renamed' : type === 'delete' ? 'deleted' : type === 'retire' ? 'retired' : 'restored'}.`,
      true,
    );
  }
  async function move(
    kind: 'categories' | 'subcategories',
    rows: TaxonomyEntry[],
    index: number,
    direction: number,
    parent?: string,
  ): Promise<void> {
    const ids = rows.map((row) => row.id);
    const target = index + direction;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    focusAfterMove.current = `rename-${rows[index]!.id}`;
    await mutate(
      `/${kind}/order`,
      'PATCH',
      { ids, ...(parent ? { categoryId: parent } : {}) },
      'Display order updated.',
    );
    // Stable rename control remains enabled even when the moved arrow reaches a boundary.
  }
  function controls(
    kind: Kind,
    entry: Entry,
    rows?: TaxonomyEntry[],
    index?: number,
    parent?: string,
    inheritedRetired = false,
  ): ReactElement {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {rows && index != null && kind !== 'tags' ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11"
              disabled={busy || loading || index === 0}
              aria-label={`Move ${entry.name} up`}
              onClick={() => void move(kind, rows, index, -1, parent)}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11"
              disabled={busy || loading || index === rows.length - 1}
              aria-label={`Move ${entry.name} down`}
              onClick={() => void move(kind, rows, index, 1, parent)}
            >
              <ArrowDown aria-hidden="true" className="size-4" />
            </Button>
          </>
        ) : null}
        <Button
          id={`rename-${entry.id}`}
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={busy || loading}
          aria-label={`Rename ${entry.name}`}
          onClick={(event) => open({ type: 'rename', kind, entry }, event)}
        >
          Rename
        </Button>
        {'retiredAt' in entry ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={busy || loading || (!!entry.retiredAt && inheritedRetired)}
            aria-label={`${entry.retiredAt ? 'Restore' : 'Retire'} ${entry.name}`}
            onClick={(event) =>
              open({ type: entry.retiredAt ? 'restore' : 'retire', kind, entry }, event)
            }
          >
            {entry.retiredAt ? 'Restore' : 'Retire'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={busy || loading}
          aria-label={`Delete ${entry.name}`}
          onClick={(event) => open({ type: 'delete', kind, entry }, event)}
        >
          Delete
        </Button>
      </div>
    );
  }
  if (loading && !data)
    return (
      <div role="status" aria-label="Loading categories and tags" className="space-y-4">
        <p className="text-sm text-muted-foreground">Loading your categories and tags…</p>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (unauthenticated) return <SignIn message={error} onSignedIn={reload} />;
  if (!data)
    return (
      <div className="space-y-3">
        <p role="alert">{error}</p>
        <Button onClick={() => void reload()}>Retry loading</Button>
      </div>
    );
  const children =
    action?.kind === 'categories'
      ? data.subcategories.filter((row) => row.categoryId === action.entry?.id)
      : [];
  const canDelete =
    action?.type !== 'delete' ||
    action.kind === 'tags' ||
    !action.entry?.itemCount ||
    !!replacement;
  const replacements =
    action?.kind === 'categories'
      ? data.categories.filter((row) => row.id !== action.entry?.id && !row.retiredAt)
      : data.subcategories.filter(
          (row) =>
            row.id !== action?.entry?.id &&
            !row.retiredAt &&
            row.categoryId === (action?.entry as SubcategoryEntry)?.categoryId &&
            !data.categories.find((root) => root.id === row.categoryId)?.retiredAt,
        );
  const title = action
    ? `${action.type === 'create' ? 'Create' : action.type === 'rename' ? 'Rename' : action.type === 'delete' ? 'Delete' : action.type === 'retire' ? 'Retire' : 'Restore'} ${kindLabel(action.kind)}`
    : '';
  return (
    <div className="space-y-6" aria-busy={busy || loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Only your authenticated account can manage these entries.
        </p>
        <Button variant="outline" disabled={busy || loading} onClick={() => void reload()}>
          Reload
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {message || (loading ? 'Refreshing…' : busy ? 'Saving…' : '')}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Categories & subcategories</CardTitle>
          <CardDescription>
            Retirement keeps existing classifications readable and removes them from new choices.
            Names are reserved while retired.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              ref={fallback}
              disabled={busy || loading}
              onClick={(event) => open({ type: 'create', kind: 'categories' }, event)}
            >
              Create category
            </Button>
            {!data.defaultsSeeded ? (
              <Button
                variant="outline"
                disabled={busy || loading}
                onClick={() =>
                  void mutate(
                    '/defaults',
                    'POST',
                    {},
                    'Example categories added. You can retire or remove them.',
                  )
                }
              >
                Add example categories
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories yet. Create your own or add a small set of removable examples.
            </p>
          ) : (
            data.categories.map((category, index) => {
              const subcategories = data.subcategories.filter(
                (row) => row.categoryId === category.id,
              );
              return (
                <section
                  key={category.id}
                  aria-label={category.name}
                  className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4"
                >
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-2">
                      <h2 className="break-words font-medium">{category.name}</h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {category.isDemo ? 'Demo/default' : 'Custom'}
                        </Badge>
                        {category.retiredAt ? <Badge variant="secondary">Retired</Badge> : null}
                        <span className="text-xs text-muted-foreground">
                          {category.itemCount} items
                        </span>
                      </div>
                    </div>
                    {controls('categories', category, data.categories, index)}
                  </div>
                  {subcategories.length ? (
                    <ul className="space-y-2 border-l pl-3">
                      {subcategories.map((subcategory, childIndex) => (
                        <li
                          key={subcategory.id}
                          className="min-w-0 space-y-1 rounded-md border p-2"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words text-sm font-medium">
                              {subcategory.name}
                            </span>
                            {subcategory.retiredAt || category.retiredAt ? (
                              <Badge variant="secondary">
                                {subcategory.retiredAt ? 'Retired' : 'Parent retired'}
                              </Badge>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              {subcategory.itemCount} items
                            </span>
                          </div>
                          {controls(
                            'subcategories',
                            subcategory,
                            subcategories,
                            childIndex,
                            category.id,
                            !!category.retiredAt,
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={busy || loading || !!category.retiredAt}
                    onClick={(event) =>
                      open({ type: 'create', kind: 'subcategories', parent: category.id }, event)
                    }
                    aria-label={`Add subcategory to ${category.name}`}
                  >
                    Add subcategory
                  </Button>
                </section>
              );
            })
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reusable tags</CardTitle>
          <CardDescription>
            Use multiple tags on an item. Removing a tag keeps the items themselves.
          </CardDescription>
          <div className="pt-2">
            <Button
              disabled={busy || loading}
              onClick={(event) => open({ type: 'create', kind: 'tags' }, event)}
            >
              Create tag
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {data.tags.length ? (
            <ul className="space-y-2">
              {data.tags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <span className="break-words font-medium">{tag.name}</span>
                    <p className="text-xs text-muted-foreground">{tag.itemCount} items</p>
                  </div>
                  {controls('tags', tag)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tags yet. Add a tag you can reuse across your possessions.
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={!!action}
        onOpenChange={(value) => {
          if (!value && !busy) setAction(undefined);
        }}
      >
        <DialogContent
          className="max-h-[85svh] overflow-y-auto"
          showCloseButton={!busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (trigger.current?.isConnected ? trigger.current : fallback.current)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {action?.type === 'create' || action?.type === 'rename'
                ? 'Choose a useful name. Capitalisation is preserved; equivalent names cannot be duplicated.'
                : action?.type === 'retire'
                  ? 'Existing items keep their classification. This entry and, for a parent, its subcategories will be excluded from new item choices.'
                  : action?.type === 'restore'
                    ? 'This entry becomes available for new item choices again. A subcategory’s parent must be active.'
                    : action?.kind === 'tags'
                      ? `Deleting “${action.entry?.name}” removes this tag from ${action.entry?.itemCount ?? 0} items. The items themselves are kept.`
                      : `Deleting “${action?.entry?.name}” affects ${action?.entry?.itemCount ?? 0} items. In-use entries need an active replacement. Items, original input and history are preserved.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {action?.type === 'create' || action?.type === 'rename' ? (
              <div className="space-y-2">
                <Label htmlFor="taxonomy-name">Name</Label>
                <Input
                  id="taxonomy-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={action.kind === 'tags' ? 80 : 120}
                  disabled={busy || loading}
                  aria-describedby={dialogError ? 'taxonomy-dialog-error' : undefined}
                  aria-invalid={!!dialogError}
                />
              </div>
            ) : null}
            {action?.type === 'delete' && children.length ? (
              <p role="alert" className="text-sm">
                This also deletes {children.length} child subcategories. Any affected items move to
                the replacement category with no subcategory. Retire the parent instead to keep all
                classifications.
              </p>
            ) : null}
            {action?.type === 'delete' && action.kind !== 'tags' && !!action.entry?.itemCount ? (
              <div className="space-y-2">
                <Label htmlFor="taxonomy-replacement">Replacement {kindLabel(action.kind)}</Label>
                <Select
                  value={replacement}
                  onValueChange={setReplacement}
                  disabled={busy || loading}
                >
                  <SelectTrigger
                    id="taxonomy-replacement"
                    className="w-full min-w-0 [&>span]:truncate"
                  >
                    <SelectValue placeholder="Choose an active replacement" />
                  </SelectTrigger>
                  <SelectContent>
                    {replacements.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {action.kind === 'categories' ? (
                  <p className="text-sm text-muted-foreground">
                    Items move to the replacement category and their subcategory is cleared.
                  </p>
                ) : null}
                {replacements.length === 0 ? (
                  <p className="text-sm">
                    Create or restore a suitable replacement first, or retire this entry instead.
                  </p>
                ) : null}
              </div>
            ) : null}
            {dialogError ? (
              <p id="taxonomy-dialog-error" role="alert" className="text-sm text-destructive">
                {dialogError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy || loading}
                onClick={() => setAction(undefined)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={action?.type === 'delete' ? 'destructive' : 'default'}
                disabled={
                  busy ||
                  !canDelete ||
                  ((action?.type === 'create' || action?.type === 'rename') && !name.trim())
                }
              >
                {busy
                  ? 'Saving…'
                  : action?.type === 'delete'
                    ? action.kind === 'tags'
                      ? 'Delete tag and remove assignments'
                      : action.entry?.itemCount
                        ? 'Reassign items and delete'
                        : 'Delete'
                    : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignIn({
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
        body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
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
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Sign in to your private inventory</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="taxonomy-email">Email</Label>
            <Input
              id="taxonomy-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-password">Password</Label>
            <Input
              id="taxonomy-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              maxLength={128}
              disabled={busy}
            />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Use the owner account already configured for Havefolio.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
