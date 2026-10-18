import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AppNavigation } from '../components/app-navigation';

let pathname = '/store';
vi.mock('next/navigation', () => ({ usePathname: (): string => pathname }));

describe('primary navigation', () => {
  afterEach(() => {
    pathname = '/store';
  });
  it('keeps the parent destination current on nested journeys in both surfaces (PER-36)', () => {
    pathname = '/wants/d1000000-0000-4000-a000-000000000001/compare';
    render(<AppNavigation />);
    for (const navigation of screen.getAllByRole('navigation', { name: 'Primary' })) {
      expect(within(navigation).getByRole('link', { name: 'Wants' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });
  it('labels both responsive navigation surfaces and exposes the current page', () => {
    render(<AppNavigation />);
    const navigations = screen.getAllByRole('navigation', { name: 'Primary' });
    expect(navigations).toHaveLength(2);
    for (const [index, navigation] of navigations.entries()) {
      const links = within(navigation).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual(
        index === 0
          ? ['/', '/store', '/insights', '/wants', '/goals', '/settings']
          : ['/', '/store', '/insights', '/wants'],
      );
      expect(within(navigation).getByRole('link', { name: 'My Store' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });
  it('opens remaining mobile destinations with keyboard access', async () => {
    render(<AppNavigation />);
    const trigger = screen.getByRole('button', { name: 'More destinations' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Goals' })).toHaveAttribute('href', '/goals');
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
  it('lets keyboard users reach the primary links', async () => {
    const user = userEvent.setup();
    render(<AppNavigation />);
    await user.tab();
    expect(screen.getByRole('link', { name: /Havefolio/ })).toHaveFocus();
    await user.tab();
    const desktop = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    if (!desktop) throw new Error('Missing primary navigation');
    expect(within(desktop).getByRole('link', { name: 'Home' })).toHaveFocus();
  });
});
