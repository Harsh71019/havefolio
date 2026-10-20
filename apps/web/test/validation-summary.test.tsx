import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddItemForm } from '../components/add-item-form';
import { AddDesireForm } from '../components/add-desire-form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn<typeof fetch>((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = url.includes('/auth/me')
      ? { id: 'synthetic-owner', email: 'owner@example.test' }
      : url.includes('/taxonomy')
        ? { categories: [], subcategories: [], tags: [], defaultsSeeded: true }
        : url.includes('/merchants')
          ? { merchants: [], hasMore: false, nextCursor: null }
          : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function activate(message: RegExp, keyboard = false): Promise<HTMLElement> {
  const link = await screen.findByRole('link', { name: message });
  const user = userEvent.setup();
  if (keyboard) {
    link.focus();
    await user.keyboard('{Enter}');
  } else await user.click(link);
  const target = document.getElementById(link.getAttribute('href')!.slice(1));
  expect(target).not.toBeNull();
  expect(target).toBeVisible();
  expect(target).toHaveFocus();
  expect(target).toHaveAttribute('aria-invalid', 'true');
  const descriptions = target!
    .getAttribute('aria-describedby')!
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
  expect(descriptions).toContain(link.textContent);
  return target!;
}

async function item(): Promise<void> {
  render(<AddItemForm />);
  await screen.findByRole('textbox', { name: /Item name/ });
}
function submit(): void {
  fireEvent.submit(document.querySelector('form')!);
}

describe('PER-72 rendered validation recovery', () => {
  it.each(['exact', 'month', 'year'])(
    'focuses the invalid %s purchase date and retains text',
    async (precision) => {
      await item();
      const user = userEvent.setup();
      if (precision !== 'exact')
        await user.click(
          screen.getByRole('radio', { name: precision === 'month' ? 'Month & year' : 'Year only' }),
        );
      const date = screen.getByRole('textbox', {
        name: precision === 'exact' ? 'Exact purchase date' : 'Year',
      });
      fireEvent.change(date, { target: { value: precision === 'exact' ? '31/02/2024' : '0000' } });
      submit();
      expect(await activate(/purchase (date|year)/, true)).toBe(date);
      expect(date).toHaveValue(precision === 'exact' ? '31/02/2024' : '0000');
    },
  );

  it('focuses purchase URL with matching inline error', async () => {
    await item();
    const input = screen.getByRole('textbox', { name: 'Purchase URL (optional)' });
    fireEvent.change(input, { target: { value: 'https://user:pass@example.test' } });
    submit();
    expect(await activate(/absolute HTTP/)).toBe(input);
    expect(input).toHaveValue('https://user:pass@example.test');
  });

  it('focuses name and price without submitting a save', async () => {
    await item();
    submit();
    await activate(/Enter an item name/);
    await activate(/Enter the amount paid/, true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it.each(['expanded', 'collapsed'])(
    'reveals invalid optional item metadata when %s',
    async (state) => {
      await item();
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', { name: /Additional details/ });
      await user.click(toggle);
      fireEvent.change(screen.getByRole('textbox', { name: 'Brand' }), {
        target: { value: 'b'.repeat(301) },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Model / Variant' }), {
        target: { value: 'm'.repeat(301) },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
        target: { value: 'n'.repeat(10001) },
      });
      if (state === 'collapsed') await user.click(toggle);
      submit();
      for (const message of [/Brand must/, /Model must/, /Notes must/]) {
        await activate(message, true);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
      }
      expect(screen.getByRole('textbox', { name: 'Brand' })).toHaveValue('b'.repeat(301));
    },
  );

  it.each(['expanded', 'collapsed'])(
    'reveals want price, URL, reason and waiting date when %s',
    async (state) => {
      render(<AddDesireForm />);
      const user = userEvent.setup();
      const toggles = [/Likely price/, /Waiting/, /Product link/, /Private reason/].map((name) =>
        screen.getByRole('button', { name }),
      );
      for (const toggle of toggles) await user.click(toggle);
      fireEvent.change(screen.getByRole('textbox', { name: 'Estimated amount' }), {
        target: { value: 'abc' },
      });
      fireEvent.change(document.querySelector('input[type="url"]')!, {
        target: { value: 'broken' },
      });
      fireEvent.change(
        screen.getByPlaceholderText('What purpose will this serve? What problem does it solve?'),
        {
          target: { value: 'r'.repeat(2001) },
        },
      );
      await user.click(screen.getByRole('button', { name: /Custom/ }));
      fireEvent.change(document.querySelector('input[type="datetime-local"]')!, {
        target: { value: '2020-01-01T12:00' },
      });
      if (state === 'collapsed') for (const toggle of toggles) await user.click(toggle);
      submit();
      const summary = (
        await screen.findByRole('heading', { name: 'Please check the following before saving:' })
      ).parentElement!;
      const links = within(summary).getAllByRole('link');
      expect(links).toHaveLength(5);
      for (const link of links)
        await activate(new RegExp(link.textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), true);
      for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('textbox', { name: 'Estimated amount' })).toHaveValue('abc');
      expect(document.querySelector('input[type="datetime-local"]')).toHaveValue(
        '2020-01-01T12:00',
      );
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    },
  );

  it('reveals a rejected photo and focuses a visible labelled file control', async () => {
    render(<AddDesireForm />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: /Private photo/ });
    await user.click(toggle);
    fireEvent.change(document.querySelector('input[id$="-photo-file"]')!, {
      target: { files: [new File(['bad'], 'bad.txt', { type: 'text/plain' })] },
    });
    await user.click(toggle);
    const summary = (
      await screen.findByRole('heading', { name: 'Please check the following before saving:' })
    ).parentElement!;
    const link = within(summary).getByRole('link');
    await activate(new RegExp(link.textContent));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('recovers restored category and description errors without losing metadata', async () => {
    localStorage.setItem(
      'havefolio_item_draft_v1_synthetic-owner',
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        name: 'Synthetic draft',
        subcategoryId: 'orphan',
        description: 'd'.repeat(5001),
        acquisitionType: 'gift',
        condition: 'worn_out',
        useFrequency: 'rarely',
      }),
    );
    await item();
    submit();
    await activate(/subcategory requires/, true);
    await activate(/Description must/, true);
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('d'.repeat(5001));
    expect(screen.getByRole('combobox', { name: 'Acquisition' })).toHaveTextContent('Gift');
    expect(screen.getByRole('combobox', { name: 'Condition' })).toHaveTextContent('Worn out');
    expect(screen.getByRole('combobox', { name: 'Use frequency' })).toHaveTextContent('Rarely');
    const ids = Array.from(document.querySelectorAll('[id]'), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('focuses the month selector for an invalid restored month with a valid year', async () => {
    localStorage.setItem(
      'havefolio_item_draft_v1_synthetic-owner',
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        name: 'Synthetic month',
        datePrecision: 'month',
        purchaseMonth: '13',
        purchaseYear: '2024',
      }),
    );
    await item();
    submit();
    const target = await activate(/Select a valid purchase month/, true);
    expect(target).toBe(screen.getByRole('combobox', { name: 'Month' }));
    expect(screen.getByRole('textbox', { name: 'Year' })).toHaveValue('2024');
  });

  it('keeps a category recovery control available when taxonomy is offline', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (typeof input === 'string' && input.includes('/taxonomy')) {
        return Promise.resolve(new Response('{}', { status: 503 }));
      }
      return original(input, init);
    });
    localStorage.setItem(
      'havefolio_item_draft_v1_synthetic-owner',
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        name: 'Synthetic offline',
        subcategoryId: 'orphan',
      }),
    );
    await item();
    await screen.findByRole('button', { name: /Retry loading categories/ });
    submit();
    await activate(/subcategory requires/, true);
  });

  it('retains duplicate-submit protection in the real Add want form', () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === 'POST') return new Promise<Response>(() => undefined);
      return original(input, init);
    });
    render(<AddDesireForm />);
    fireEvent.change(screen.getByRole('textbox', { name: /What are you considering/ }), {
      target: { value: 'Synthetic guarded want' },
    });
    act(() => {
      submit();
      submit();
    });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Saving desire/ })).toBeDisabled();
  });

  it('respects reduced motion when moving focus', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await item();
    submit();
    await activate(/Enter an item name/);
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'center' }),
    );
  });
});
