import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AppNavigation } from '../components/app-navigation';

vi.mock('next/navigation', () => ({ usePathname: (): string => '/store' }));

describe('primary navigation', () => {
  it('labels both responsive navigation surfaces and exposes the current page', () => {
    render(<AppNavigation />);
    const navigations = screen.getAllByRole('navigation', { name: 'Primary' });
    expect(navigations).toHaveLength(2);
    for (const navigation of navigations) {
      const links = within(navigation).getAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/',
        '/store',
        '/wants',
        '/goals',
      ]);
      expect(within(navigation).getByRole('link', { name: 'My Store' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
        'aria-current',
      );
    }
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
