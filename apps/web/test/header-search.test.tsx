import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderSearch } from '../components/header-search';
import { saveStoreLocation } from '../components/store-location';

let pathname = '/store';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: (): string => pathname,
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  push.mockReset();
});

describe('header search', () => {
  it('narrows My Store in place, keeping its other filters', async () => {
    pathname = '/store';
    window.history.replaceState(null, '', '/store?ownershipStatus=owned&sort=name');
    render(<HeaderSearch />);
    const user = userEvent.setup();

    expect(screen.getByRole('search', { name: 'Your items' })).toBeVisible();
    await user.type(
      screen.getByRole('searchbox', { name: 'Search what you own' }),
      '  Steel   KETTLE {enter}',
    );
    expect(window.location.search).toBe('?q=steel+kettle&sort=name&ownershipStatus=owned');
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(window.location.search).toBe('?sort=name&ownershipStatus=owned');
    expect(screen.getByRole('searchbox', { name: 'Search what you own' })).toHaveValue('');
  });

  it('follows searches changed elsewhere on My Store', () => {
    pathname = '/store';
    window.history.replaceState(null, '', '/store');
    render(<HeaderSearch />);
    act(() => saveStoreLocation({ q: 'tawa' }));
    expect(screen.getByRole('searchbox', { name: 'Search what you own' })).toHaveValue('tawa');
  });

  it('opens My Store with the search from any other page', async () => {
    pathname = '/wants';
    window.history.replaceState(null, '', '/wants?status=active');
    render(<HeaderSearch />);
    const user = userEvent.setup();
    const box = screen.getByRole('searchbox', { name: 'Search what you own' });
    expect(box).toHaveValue('');

    await user.type(box, 'drill{enter}');
    expect(push).toHaveBeenCalledWith('/store?q=drill');
    await user.clear(box);
    await user.type(box, '   {enter}');
    expect(push).toHaveBeenLastCalledWith('/store');
  });
});
