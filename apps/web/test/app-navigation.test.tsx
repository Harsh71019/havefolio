import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { AppNavigation } from '../components/app-navigation';

let pathname = '/store';
vi.mock('next/navigation', () => ({ usePathname: (): string => pathname }));

describe('primary navigation', () => {
  afterEach(() => {
    pathname = '/store';
    delete document.documentElement.dataset.sidebar;
    window.localStorage.clear();
    vi.unstubAllGlobals();
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
  it('keeps My Store active on nested item routes in both surfaces (PER-90)', () => {
    pathname = '/items/00000000-0000-4000-a000-000000000001';
    render(<AppNavigation />);
    for (const navigation of screen.getAllByRole('navigation', { name: 'Primary' })) {
      expect(within(navigation).getByRole('link', { name: 'My Store' })).toHaveAttribute(
        'aria-current',
        'page',
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
          ? ['/', '/store', '/insights', '/wants', '/goals', '/settings/taxonomy', '/settings']
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
    expect(screen.getByRole('menuitem', { name: 'Categories' })).toHaveAttribute(
      'href',
      '/settings/taxonomy',
    );
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
  it('selects a mobile destination from More and closes without returning focus to More (PER-90)', async () => {
    render(<AppNavigation />);
    const trigger = screen.getByRole('button', { name: 'More destinations' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const goalsLink = screen.getByRole('menuitem', { name: 'Goals' });
    expect(goalsLink).toBeInTheDocument();
    await userEvent.click(goalsLink);
    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Goals' })).not.toBeInTheDocument();
    });
  });
  it('highlights Categories exclusively on taxonomy, and Settings on merchants', () => {
    pathname = '/settings/taxonomy';
    const { unmount } = render(<AppNavigation />);
    const desktop = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(desktop).getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(desktop).getByRole('link', { name: 'Settings' })).not.toHaveAttribute(
      'aria-current',
    );
    unmount();
    pathname = '/settings/merchants';
    render(<AppNavigation />);
    expect(
      within(screen.getAllByRole('navigation', { name: 'Primary' })[0]!).getByRole('link', {
        name: 'Settings',
      }),
    ).toHaveAttribute('aria-current', 'page');
    pathname = '/store';
  });
  it('lets keyboard users reach the primary links', async () => {
    const user = userEvent.setup();
    render(<AppNavigation />);
    await user.tab();
    expect(screen.getByRole('link', { name: /Havefolio/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveFocus();
    await user.tab();
    const desktop = screen.getAllByRole('navigation', { name: 'Primary' })[0];
    if (!desktop) throw new Error('Missing primary navigation');
    expect(within(desktop).getByRole('link', { name: 'Home' })).toHaveFocus();
  });

  describe('collapsible desktop sidebar (PER-66)', () => {
    const desktop = (): HTMLElement => screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    const viewport = (desktopWidth: boolean): void => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: desktopWidth, media: query }));
    };

    it('collapses to an icon rail, remembers it and expands again', async () => {
      const user = userEvent.setup();
      render(<AppNavigation />);
      const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-controls', 'primary-sidebar');

      await user.click(toggle);
      expect(document.documentElement.dataset.sidebar).toBe('collapsed');
      expect(window.localStorage.getItem('havefolio:sidebar:v1')).toBe('collapsed');
      expect(toggle).toHaveAccessibleName('Expand sidebar');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(within(desktop()).getByRole('link', { name: 'My Store' })).toHaveAttribute(
        'aria-current',
        'page',
      );

      await user.click(toggle);
      expect(document.documentElement.dataset.sidebar).toBe('expanded');
      expect(window.localStorage.getItem('havefolio:sidebar:v1')).toBe('expanded');
      expect(toggle).toHaveAccessibleName('Collapse sidebar');
    });

    it('starts collapsed from the saved preference', () => {
      document.documentElement.dataset.sidebar = 'collapsed';
      render(<AppNavigation />);
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('names collapsed links in a tooltip on keyboard focus only while collapsed', async () => {
      const user = userEvent.setup();
      render(<AppNavigation />);
      await user.tab();
      await user.tab();
      await user.tab();
      expect(within(desktop()).getByRole('link', { name: 'Home' })).toHaveFocus();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      // The toggle sits at the top, so the first destination follows it.
      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
      await user.tab();
      expect(within(desktop()).getByRole('link', { name: 'Home' })).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Home');
    });

    it('toggles with Ctrl or Cmd+B on desktop, but not while typing or on mobile', async () => {
      const user = userEvent.setup();
      viewport(true);
      render(
        <>
          <AppNavigation />
          <input aria-label="Search" />
        </>,
      );
      await user.keyboard('{Control>}b{/Control}');
      expect(document.documentElement.dataset.sidebar).toBe('collapsed');
      await user.keyboard('{Meta>}b{/Meta}');
      expect(document.documentElement.dataset.sidebar).toBe('expanded');

      await user.click(screen.getByRole('textbox', { name: 'Search' }));
      await user.keyboard('{Control>}b{/Control}');
      expect(document.documentElement.dataset.sidebar).toBe('expanded');

      await user.click(document.body);
      viewport(false);
      await user.keyboard('{Control>}b{/Control}');
      await waitFor(() => expect(document.documentElement.dataset.sidebar).toBe('expanded'));
    });
  });
});
