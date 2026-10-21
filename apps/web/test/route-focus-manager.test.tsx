import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteFocusManager } from '../components/route-focus-manager';
import { mainContentId } from '../components/skip-link';
import { setReturnFocusItem } from '../components/navigation-context';

let mockPathname = '/store';
vi.mock('next/navigation', () => ({
  usePathname: (): string => mockPathname,
}));

describe('RouteFocusManager (PER-90)', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPathname = '/store';
    scrollToSpy = vi.fn();
    window.scrollTo = scrollToSpy as unknown as typeof window.scrollTo;
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('does not scroll or move focus on initial mount', () => {
    render(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByTestId('main'));
  });

  it('scrolls to (0,0) and focuses #main-content on forward route change', () => {
    const { rerender } = render(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    mockPathname = '/wants';
    rerender(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(screen.getByTestId('main'));
  });

  it('does not scroll or focus when pathname is unchanged on rerender', () => {
    const { rerender } = render(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    rerender(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByTestId('main'));
  });

  it('does not force focus to #main-content on popstate (browser back/forward)', () => {
    const { rerender } = render(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    // Simulate browser back button triggering popstate before next/navigation update
    window.dispatchEvent(new PopStateEvent('popstate'));

    mockPathname = '/store';
    rerender(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByTestId('main'));
  });

  it('does not force focus to #main-content when returning to /store with a pending return focus item', () => {
    mockPathname = '/items/00000000-0000-4000-a000-000000000001';
    const { rerender } = render(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    setReturnFocusItem('00000000-0000-4000-a000-000000000001');

    mockPathname = '/store';
    rerender(
      <div>
        <div id={mainContentId} tabIndex={-1} data-testid="main">
          Main content
        </div>
        <RouteFocusManager />
      </div>,
    );

    // Should not hijack focus to #main-content so MyStore can restore item card focus
    expect(document.activeElement).not.toBe(screen.getByTestId('main'));
  });
});
