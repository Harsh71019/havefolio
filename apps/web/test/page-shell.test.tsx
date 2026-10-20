import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeading } from '../components/page-heading';
import { PageShell, pageWidths } from '../components/page-shell';

// PER-75: structure only; jsdom has no layout, so rail geometry is covered by e2e/page-shell.spec.ts.
describe('page shell', () => {
  it.each(Object.entries(pageWidths))('pins the %s rail to the left gutter', (width, maxWidth) => {
    const { container } = render(
      <PageShell width={width as keyof typeof pageWidths}>
        <PageHeading title="Settings" />
      </PageShell>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('data-page-shell', width);
    expect(main).toHaveClass('w-full', 'px-4', 'sm:px-6', 'lg:px-8');
    const rail = main.querySelector('[data-page-rail]')!;
    expect(rail).toHaveClass(maxWidth);
    // No centring anywhere in the shell: the rail always starts at the gutter.
    expect(container.innerHTML).not.toMatch(/\bmx-auto\b/);
    expect(within(rail as HTMLElement).getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('passes landmark attributes such as aria-busy to main', () => {
    render(
      <PageShell width="wide" aria-busy="true">
        <p>Loading</p>
      </PageShell>,
    );
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('page heading', () => {
  it('renders only the parts a page provides, with its actions beside the title', () => {
    const { rerender } = render(
      <PageHeading title="My Store" action={<button type="button">Add item</button>} />,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('heading', { level: 1, name: 'My Store' })).toBeVisible();
    expect(header.querySelectorAll('p')).toHaveLength(0);
    expect(within(header).getByRole('button', { name: 'Add item' })).toBeVisible();

    rerender(<PageHeading eyebrow="Goals" title="New goal" description="Name something." />);
    expect(screen.getByText('Goals')).toBeVisible();
    expect(screen.getByText('Name something.')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
