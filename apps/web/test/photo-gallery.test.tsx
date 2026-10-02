import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemPhoto } from '@havefolio/contracts';
import { PhotoGallery } from '../components/photo-gallery';

const item = '15151515-1515-4151-a151-151515151515';
const uuid = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const photo = (n: number, extra: Partial<ItemPhoto> = {}): ItemPhoto => ({
  id: uuid(n),
  position: 0,
  cover: false,
  width: 4000,
  height: 3000,
  byteSize: 1000,
  mimeType: 'image/webp',
  altText: null,
  decorative: false,
  ...extra,
});

type Failure = { status: number; message: string };
const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
/** In-memory stand-in for the authenticated photo API, persisting across remounts. */
class FakeServer {
  revision = 1;
  photos: ItemPhoto[] = [];
  calls: { method: string; url: string; body?: unknown }[] = [];
  fail: Record<string, Failure[]> = {};
  hideOnDeleteFailure = false;
  next = 100;
  snapshot(): Response {
    return Response.json({
      revision: this.revision,
      photos: this.photos.map((p, position) => ({ ...p, position, cover: position === 0 })),
    });
  }
  handle = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = requestUrl(input);
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    this.calls.push({ method, url, ...(body ? { body } : {}) });
    const failure = this.fail[method]?.shift();
    if (failure) {
      if (method === 'DELETE' && this.hideOnDeleteFailure) {
        const id = url.split('/').pop();
        this.photos = this.photos.filter((p) => p.id !== id);
      }
      return Promise.resolve(Response.json({ message: failure.message }, failure));
    }
    const stale = body && body.revision !== this.revision;
    if (stale)
      return Promise.resolve(Response.json({ message: 'STALE_ITEM_REVISION' }, { status: 409 }));
    if (method === 'PATCH' && url.endsWith('/order')) {
      const ids = body!.photoIds as string[];
      this.photos = ids.map((id) => this.photos.find((p) => p.id === id)!);
      this.revision++;
    } else if (method === 'PATCH') {
      const id = url.split('/').pop();
      const decorative = body!.decorative as boolean;
      this.photos = this.photos.map((p) =>
        p.id === id
          ? { ...p, decorative, altText: decorative ? null : (body!.altText as string | null) }
          : p,
      );
      this.revision++;
    } else if (method === 'DELETE') {
      this.photos = this.photos.filter((p) => p.id !== url.split('/').pop());
      this.revision++;
    }
    return Promise.resolve(this.snapshot());
  };
  upload(): ItemPhoto {
    const created = photo(this.next++);
    this.photos.push(created);
    this.revision++;
    return created;
  }
}

/** Upload transport double: per-request progress, then a scripted API result. */
class FakeXhr {
  static sent: { uploadId: string; name: string }[] = [];
  static script: (() => { status: number; body: unknown })[] = [];
  static server: FakeServer;
  static hold = false;
  static pending: FakeXhr[] = [];
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  private headers: Record<string, string> = {};
  open(): void {}
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  abort(): void {}
  send(form: FormData): void {
    FakeXhr.sent.push({
      uploadId: this.headers['Upload-Id']!,
      name: (form.get('photos') as File).name,
    });
    if (FakeXhr.hold) FakeXhr.pending.push(this);
    else this.finish();
  }
  progress(loaded: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total: 100 } as ProgressEvent);
  }
  finish(): void {
    const scripted = FakeXhr.script.shift()?.() ?? {
      status: 201,
      body: { results: [{ index: 0, photo: FakeXhr.server.upload() }] },
    };
    this.status = scripted.status;
    this.responseText = JSON.stringify(scripted.body);
    this.onload?.();
  }
}

let server: FakeServer;
const revoke = vi.fn();
beforeEach(() => {
  server = new FakeServer();
  FakeXhr.server = server;
  FakeXhr.sent = [];
  FakeXhr.script = [];
  FakeXhr.hold = false;
  FakeXhr.pending = [];
  vi.stubGlobal('fetch', vi.fn(server.handle));
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-preview');
  revoke.mockClear();
  URL.revokeObjectURL = revoke;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const file = (name: string, type = 'image/jpeg'): File => new File(['synthetic'], name, { type });
async function renderGallery(): Promise<void> {
  render(<PhotoGallery itemId={item} />);
  await screen.findByRole('heading', { name: /^Photos/ });
}
const status = (): HTMLElement =>
  screen.getAllByRole('status').find((node) => node.className.includes('sr-only'))!;
const tile = (n: number): HTMLElement =>
  screen.getAllByRole('listitem').filter((li) => li.closest('ol'))[n - 1]!;
async function openMenu(n: number, action: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `More actions for photo ${n}` }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

describe('item photo gallery', () => {
  it('shows loading, then the empty gallery and no-cover state', async () => {
    render(<PhotoGallery itemId={item} />);
    expect(screen.getByLabelText('Loading photos')).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByText('No photos yet')).toBeVisible();
    expect(screen.getByText('No cover photo yet')).toBeVisible();
    expect(
      screen.getByText(/No cover yet\. Your first uploaded photo becomes the cover/),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Photos (0 of 8)' })).toBeVisible();
  });

  it('reports a failed initial load with a retry action', async () => {
    server.fail.GET = [{ status: 503, message: 'ITEMS_UNAVAILABLE' }];
    render(<PhotoGallery itemId={item} />);
    expect(await screen.findByText(/Photos could not load\./)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No photos yet')).toBeVisible();
  });

  it('renders responsive, lazy, same-origin images that preserve aspect ratio', async () => {
    server.photos = [
      photo(1, { altText: 'Blue kettle' }),
      photo(2),
      photo(3, { width: 300, height: 600 }),
    ];
    await renderGallery();
    const gallery = screen.getByRole('heading', { name: 'Photos (3 of 8)' }).closest('section')!;
    const images = within(gallery).getAllByRole('img');
    expect(images).toHaveLength(3);
    const [first, second, third] = images as [HTMLImageElement, HTMLImageElement, HTMLImageElement];
    expect(first).toHaveAttribute('alt', 'Blue kettle');
    expect(second).toHaveAttribute('alt', 'Item photo 2 of 3, not yet described');
    expect(first.getAttribute('src')).toBe(
      `/api/v1/items/${item}/photos/${uuid(1)}/content/thumbnail`,
    );
    expect(first.getAttribute('srcset')).toBe(
      `/api/v1/items/${item}/photos/${uuid(1)}/content/thumbnail 320w, /api/v1/items/${item}/photos/${uuid(1)}/content/display 1600w`,
    );
    expect(first.getAttribute('sizes')).toContain('45vw');
    expect(first).toHaveAttribute('width', '4000');
    expect(first).toHaveAttribute('height', '3000');
    expect(first).toHaveAttribute('loading', 'eager');
    expect(third).toHaveAttribute('loading', 'lazy');
    expect(third.getAttribute('srcset')).toContain('content/thumbnail 160w');
    expect(third).toHaveAttribute('referrerpolicy', 'no-referrer');
    // The large cover view shows the thumbnail first, then requests the display variant.
    const cover = screen.getByRole('heading', { name: 'Cover' }).closest('section')!;
    expect(within(cover).getByRole('img', { name: 'Blue kettle' }).getAttribute('src')).toContain(
      '/content/display',
    );
    expect(cover.querySelector('img[aria-hidden="true"]')?.getAttribute('src')).toContain(
      '/content/thumbnail',
    );
  });

  it('never places provider identifiers, signed URLs or receipts in the page', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    const html = document.body.innerHTML;
    expect(html).not.toMatch(
      /cloudinary|api_key|signature=|havefolio\/(test|production|development)|receipt|warranty/i,
    );
    expect(server.calls.every((call) => call.url.startsWith(`/api/v1/items/${item}/photos`))).toBe(
      true,
    );
  });

  it('offers camera capture and multiple gallery selection, uploads with per-file progress', async () => {
    FakeXhr.hold = true;
    await renderGallery();
    expect(screen.getByLabelText('Take a photo')).toHaveAttribute('capture', 'environment');
    expect(screen.getByLabelText('Choose from gallery or files')).toHaveAttribute('multiple');
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [file('one.jpg'), file('two.png', 'image/png')] },
    });
    expect(screen.getAllByRole('img', { name: /Preview of selected photo/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    act(() => FakeXhr.pending[0]!.progress(40));
    expect(
      screen.getByRole('progressbar', { name: 'Upload progress for photo 1' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Uploading 40%')).toBeVisible();
    act(() => FakeXhr.pending[0]!.progress(100));
    expect(screen.getByText('Processing and saving…')).toBeVisible();
    act(() => FakeXhr.pending.shift()!.finish());
    await waitFor(() => expect(FakeXhr.pending).toHaveLength(1));
    act(() => FakeXhr.pending.shift()!.finish());
    expect(await screen.findByText('2 of 2 photos saved.')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Photos (2 of 8)' })).toBeVisible();
    expect(screen.getAllByText('Saved privately')).toHaveLength(2);
    expect(within(tile(1)).getByText('Cover')).toBeVisible();
  });

  it('uploads a single camera photo', async () => {
    await renderGallery();
    fireEvent.change(screen.getByLabelText('Take a photo'), {
      target: { files: [file('camera.jpg')] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    expect(await screen.findByText('1 of 1 photos saved.')).toBeVisible();
    expect(FakeXhr.sent.map((s) => s.name)).toEqual(['camera.jpg']);
  });

  it('removes a local preview before upload', async () => {
    await renderGallery();
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [file('one.jpg')] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(screen.queryByRole('img', { name: /Preview/ })).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-preview');
  });

  it('keeps successful uploads and retries only the failed file with the same Upload-Id', async () => {
    await renderGallery();
    FakeXhr.script = [
      () => ({ status: 201, body: { results: [{ index: 0, photo: server.upload() }] } }),
      () => ({ status: 201, body: { results: [{ index: 0, error: 'PHOTO_PROCESSING_BUSY' }] } }),
    ];
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [file('one.jpg'), file('two.jpg')] },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Upload photos' }));
    expect(
      await screen.findByText('1 of 2 photos saved. 1 not saved — retry it below.'),
    ).toBeVisible();
    expect(
      screen.getByText('Image processing is busy. Try this photo again shortly.'),
    ).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Photos (1 of 8)' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Upload or retry unsaved photos' }));
    expect(await screen.findByText('2 of 2 photos saved.')).toBeVisible();
    expect(FakeXhr.sent.map((s) => s.name)).toEqual(['one.jpg', 'two.jpg', 'two.jpg']);
    expect(FakeXhr.sent[2]!.uploadId).toBe(FakeXhr.sent[1]!.uploadId);
  });

  it('explains unsupported HEIC without uploading it', async () => {
    await renderGallery();
    fireEvent.change(screen.getByLabelText('Choose from gallery or files'), {
      target: { files: [file('IMG_0001.HEIC', '')] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('HEIC/HEIF is not supported yet');
    expect(screen.getByText('Not uploaded')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it('reorders with keyboard controls, announces, keeps focus and persists across refresh', async () => {
    server.photos = [photo(1), photo(2), photo(3)];
    const user = userEvent.setup();
    const view = render(<PhotoGallery itemId={item} />);
    await screen.findByRole('heading', { name: 'Photos (3 of 8)' });
    expect(screen.getByRole('button', { name: 'Move photo 1 earlier' })).toBeDisabled();
    screen.getByRole('button', { name: 'Move photo 2 earlier' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(status()).toHaveTextContent('Photo 2 moved to position 1 of 3. It is now the cover.'),
    );
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      revision: 1,
      photoIds: [uuid(2), uuid(1), uuid(3)],
    });
    // The moved photo is now first: "earlier" is disabled, so focus stays on its "later" control.
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('id', `photo-later-${uuid(2)}`),
    );
    view.unmount();
    render(<PhotoGallery itemId={item} />);
    await screen.findByRole('heading', { name: 'Photos (3 of 8)' });
    expect(within(tile(1)).getByText('Cover')).toBeVisible();
    expect(screen.getByRole('button', { name: 'More actions for photo 1' })).toHaveAttribute(
      'id',
      `photo-menu-${uuid(2)}`,
    );
  });

  it('rolls back an optimistic reorder on a revision conflict and reloads', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    server.revision = 7; // Changed elsewhere after this page loaded.
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Photos changed elsewhere, so this change was not saved.',
    );
    expect(screen.getByRole('button', { name: 'More actions for photo 1' })).toHaveAttribute(
      'id',
      `photo-menu-${uuid(1)}`,
    );
    expect(server.photos.map((p) => p.id)).toEqual([uuid(1), uuid(2)]);
    expect(server.calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('restores the previous order when the network rejects a reorder', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    server.fail.PATCH = [{ status: 503, message: 'ITEMS_UNAVAILABLE' }];
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 1 later' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The previous order has been restored.',
    );
    expect(screen.getByRole('button', { name: 'More actions for photo 1' })).toHaveAttribute(
      'id',
      `photo-menu-${uuid(1)}`,
    );
  });

  it('sets and changes the cover through the photo menu', async () => {
    server.photos = [photo(1), photo(2), photo(3, { altText: 'Kettle lid' })];
    await renderGallery();
    await openMenu(3, 'Set as cover');
    await waitFor(() => expect(status()).toHaveTextContent('Kettle lid is now the cover.'));
    expect(within(tile(1)).getByText('Cover')).toBeVisible();
    expect(within(tile(1)).getByText('Kettle lid')).toBeVisible();
    expect(screen.getByText(/Kettle lid is the cover\./)).toBeVisible();
    await openMenu(2, 'Set as cover');
    await waitFor(() => expect(status()).toHaveTextContent('Photo 2 is now the cover.'));
    expect(server.photos.map((p) => p.id)).toEqual([uuid(1), uuid(3), uuid(2)]);
  });

  it('confirms cover deletion, shows the replacement cover and then the empty cover', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    await openMenu(1, 'Delete photo');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('It is the cover, so the next photo will become the cover.');
    const confirm = within(dialog).getByRole('button', { name: 'Delete photo' });
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(status()).toHaveTextContent('Photo deleted. Photo 1 is now the cover.'),
    );
    expect(server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(server.calls.find((c) => c.method === 'DELETE')!.body).toEqual({ revision: 1 });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute('id', `photo-menu-${uuid(2)}`),
    );
    await openMenu(1, 'Delete photo');
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'It is the cover and the only photo, so the item will have no cover.',
    );
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete photo' }),
    );
    await waitFor(() => expect(status()).toHaveTextContent('The item has no cover photo now.'));
    expect(screen.getByText('No cover photo yet')).toBeVisible();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'add-photos-heading'));
  });

  it('keeps the photo and dialog after a delete failure and blocks duplicate submissions', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    let release: (r: Response) => void = () => undefined;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(
      (input, init) =>
        new Promise((resolve) => {
          server.calls.push({ method: init?.method ?? 'GET', url: requestUrl(input) });
          release = resolve;
        }),
    );
    await openMenu(2, 'Delete photo');
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete photo' }));
    const busy = within(dialog).getByRole('button', { name: 'Deleting…' });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    act(() => release(Response.json({ message: 'MEDIA_STORAGE_UNAVAILABLE' }, { status: 503 })));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Photo storage is temporarily unavailable. Try again shortly. The photo is still in your gallery.',
    );
    // The modal hides the gallery from assistive technology; the photo itself is unchanged.
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(server.photos).toHaveLength(2);
    expect(screen.getAllByRole('heading', { name: 'Photos (2 of 8)', hidden: true })).toHaveLength(
      1,
    );
  });

  it('treats a hidden photo after a cleanup failure as removed without internal details', async () => {
    server.photos = [photo(1), photo(2)];
    server.fail.DELETE = [{ status: 503, message: 'MEDIA_STORAGE_UNAVAILABLE' }];
    server.hideOnDeleteFailure = true;
    await renderGallery();
    await openMenu(2, 'Delete photo');
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete photo' }),
    );
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        'Photo removed. Private storage cleanup will finish automatically.',
      ),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain('MEDIA_STORAGE_UNAVAILABLE');
  });

  it('edits, validates and clears alt text, including an explicit decorative choice', async () => {
    server.photos = [photo(1)];
    const user = userEvent.setup();
    await renderGallery();
    await openMenu(1, 'Edit description');
    const field = await screen.findByLabelText('Description');
    await user.type(field, 'IMG_1234.jpg');
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    expect(
      screen.getByText('This looks like a file name. Describe what the photo shows instead.'),
    ).toBeVisible();
    await user.clear(field);
    fireEvent.change(field, { target: { value: 'x'.repeat(251) } });
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    expect(screen.getByText('Use 250 characters or fewer.')).toBeVisible();
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);
    await user.clear(field);
    await user.type(field, '  Steel kettle with wooden handle ');
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    await waitFor(() => expect(status()).toHaveTextContent('Description saved.'));
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      revision: 1,
      altText: 'Steel kettle with wooden handle',
      decorative: false,
    });
    expect(
      within(tile(1)).getByRole('img', { name: 'Steel kettle with wooden handle' }),
    ).toBeDefined();
    await openMenu(1, 'Edit description');
    await user.click(await screen.findByLabelText('Decorative photo'));
    expect(screen.getByLabelText('Description')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    await waitFor(() => expect(status()).toHaveTextContent('Photo marked as decorative.'));
    expect(within(tile(1)).queryByRole('img')).toBeNull();
    expect(tile(1).querySelector('img')).toHaveAttribute('alt', '');
    expect(within(tile(1)).getByText('Decorative — skipped by screen readers')).toBeVisible();
  });

  it('replaces a described cover: upload first, keep position and text, then delete the original', async () => {
    server.photos = [photo(1, { altText: 'Front view' }), photo(2)];
    await renderGallery();
    await openMenu(1, 'Replace photo');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Choose from gallery or files')).not.toHaveAttribute(
      'multiple',
    );
    fireEvent.change(within(dialog).getByLabelText('Choose from gallery or files'), {
      target: { files: [file('better.jpg')] },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload replacement' }));
    await waitFor(() => expect(status()).toHaveTextContent('Photo 1 replaced.'));
    const order = server.calls.filter((c) => c.method !== 'GET').map((c) => c.method);
    expect(order).toEqual(['PATCH', 'PATCH', 'DELETE']);
    expect(server.photos.map((p) => p.id)).toEqual([uuid(100), uuid(2)]);
    expect(server.photos[0]!.altText).toBe('Front view');
    expect(within(tile(1)).getByText('Cover')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the original untouched when a replacement upload fails', async () => {
    server.photos = [photo(1), photo(2)];
    FakeXhr.script = [
      () => ({ status: 201, body: { results: [{ index: 0, error: 'PHOTO_INVALID' }] } }),
    ];
    await renderGallery();
    await openMenu(2, 'Replace photo');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Choose from gallery or files'), {
      target: { files: [file('broken.jpg')] },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload replacement' }));
    expect(
      await within(dialog).findByText(
        'This image could not be decoded safely. Choose another image.',
      ),
    ).toBeVisible();
    expect(server.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
    expect(server.photos.map((p) => p.id)).toEqual([uuid(1), uuid(2)]);
  });

  it('keeps both photos visible when the original cannot be removed after replacement', async () => {
    server.photos = [photo(1), photo(2)];
    server.fail.DELETE = [{ status: 503, message: 'MEDIA_STORAGE_UNAVAILABLE' }];
    await renderGallery();
    await openMenu(2, 'Replace photo');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Choose from gallery or files'), {
      target: { files: [file('new.jpg')] },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload replacement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The replacement was saved, but the original could not be removed',
    );
    expect(screen.getByRole('heading', { name: 'Photos (3 of 8)' })).toBeVisible();
  });

  it('requires a free slot before replacing so the original is never removed first', async () => {
    server.photos = Array.from({ length: 8 }, (_, n) => photo(n + 1));
    await renderGallery();
    await openMenu(1, 'Replace photo');
    expect(await within(await screen.findByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Replacing needs one free photo slot',
    );
    expect(
      screen.getByLabelText('Choose from gallery or files', { selector: '#photo-gallery' }),
    ).toBeDisabled();
  });

  it('recovers expired or failed image delivery, then offers a manual retry', async () => {
    server.photos = [photo(1)];
    await renderGallery();
    const image = within(tile(1)).getByRole('img');
    const gets = server.calls.filter((c) => c.method === 'GET').length;
    fireEvent.error(image);
    await waitFor(() =>
      expect(within(tile(1)).getByRole('img').getAttribute('src')).toContain('?attempt=1'),
    );
    expect(server.calls.filter((c) => c.method === 'GET').length).toBe(gets + 1);
    fireEvent.error(within(tile(1)).getByRole('img'));
    expect(within(tile(1)).getByRole('alert')).toHaveTextContent('Photo 1 could not load.');
    await userEvent.click(within(tile(1)).getByRole('button', { name: 'Retry' }));
    expect(within(tile(1)).getByRole('img').getAttribute('src')).toContain('?attempt=2');
  });

  it('pauses changes while offline and refreshes on reconnection', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(
      screen.getByText('You are offline. Photos cannot be changed until you reconnect.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Move photo 1 later' })).toBeDisabled();
    expect(
      screen.getByLabelText('Choose from gallery or files', { selector: '#photo-gallery' }),
    ).toBeDisabled();
    online.mockReturnValue(true);
    const gets = server.calls.filter((c) => c.method === 'GET').length;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(server.calls.filter((c) => c.method === 'GET').length).toBe(gets + 1),
    );
    expect(screen.getByRole('button', { name: 'Move photo 1 later' })).toBeEnabled();
  });

  it('marks the cover with text and an icon, not colour alone', async () => {
    server.photos = [photo(1), photo(2)];
    await renderGallery();
    expect(within(tile(1)).getByText('Cover')).toBeVisible();
    expect(within(tile(1)).getByText('(cover)')).toHaveClass('sr-only');
    expect(within(tile(2)).queryByText('Cover')).toBeNull();
  });
});
