import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import type { TaxonomySnapshot } from '@havefolio/contracts';
import { TaxonomyManagement } from '../components/taxonomy-management';
import { CategorySelector, TagSelector } from '../components/taxonomy-selectors';

export const fixture: TaxonomySnapshot = {
  categories: [
    { id: 'root', name: 'Electronics', position: 0, isDemo: true, retiredAt: null, itemCount: 2 },
    {
      id: 'retired',
      name: 'Old hobbies',
      position: 1,
      isDemo: false,
      retiredAt: '2026-01-01T00:00:00.000Z',
      itemCount: 1,
    },
    { id: 'active', name: 'Books', position: 2, isDemo: false, retiredAt: null, itemCount: 0 },
  ],
  subcategories: [
    {
      id: 'child',
      categoryId: 'root',
      name: 'Audio',
      position: 0,
      isDemo: false,
      retiredAt: null,
      itemCount: 2,
    },
  ],
  tags: [{ id: 'tag', name: 'Daily use', itemCount: 2 }],
  defaultsSeeded: true,
};
const response = (body: unknown = fixture, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('private taxonomy management', () => {
  it('announces loading, owner-authentication failure and sign-in without showing private records', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'AUTH_REQUIRED' }, 401));
    render(<TaxonomyManagement />);
    expect(screen.getByRole('status', { name: 'Loading categories and tags' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Electronics')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
  it('shows default/custom/retired entries, affected-item counts and accessible reorder controls', async () => {
    render(<TaxonomyManagement />);
    expect(await screen.findByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Demo/default')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Electronics up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Electronics down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add subcategory to Old hobbies' })).toBeDisabled();
  });
  it('supports keyboard opening, validation errors, conflicts and focus restoration after rename', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManagement />);
    const trigger = await screen.findByRole('button', { name: 'Rename Electronics' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Rename category' });
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
    await user.clear(within(dialog).getByLabelText('Name'));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Name'), 'Books');
    fetchMock.mockResolvedValueOnce(response({ message: 'NAME_ALREADY_EXISTS' }, 409));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Devices');
    fetchMock.mockResolvedValueOnce(
      response({
        ...fixture,
        categories: fixture.categories.map((row) =>
          row.id === 'root' ? { ...row, name: 'Devices' } : row,
        ),
      }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rename Devices' })).toHaveFocus(),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/taxonomy/categories/root',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Devices' }) }),
    );
  });
  it('requires a replacement for affected items, explains child removal and sends explicit consent', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManagement />);
    await user.click(await screen.findByRole('button', { name: 'Delete Electronics' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete category' });
    expect(within(dialog).getByText(/deletes 1 child subcategories/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Reassign items and delete' }),
    ).toBeDisabled();
    const combo = within(dialog).getByRole('combobox', { name: 'Replacement category' });
    combo.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'Books' }));
    fetchMock.mockResolvedValueOnce(
      response({ ...fixture, categories: fixture.categories.slice(1), subcategories: [] }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reassign items and delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/taxonomy/categories/root',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ replacementId: 'active', removeSubcategories: true }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create category' })).toHaveFocus(),
    );
  });
  it('confirms tag relationship removal explicitly and keeps affected-item copy', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManagement />);
    await user.click(await screen.findByRole('button', { name: 'Delete Daily use' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete tag' });
    expect(within(dialog).getByText(/removes this tag from 2 items/)).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete tag and remove assignments' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/taxonomy/tags/tag',
        expect.objectContaining({ body: JSON.stringify({ removeRelationships: true }) }),
      ),
    );
  });
  it('reorders with buttons and preserves keyboard focus on the moved entry', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManagement />);
    const button = await screen.findByRole('button', { name: 'Move Electronics down' });
    await user.click(button);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/taxonomy/categories/order',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ ids: ['retired', 'root', 'active'] }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rename Electronics' })).toHaveFocus(),
    );
  });
  it('supports empty states, retry after server failure, and explicit example admission', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 503));
    render(<TaxonomyManagement />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    fetchMock.mockResolvedValueOnce(
      response({ categories: [], subcategories: [], tags: [], defaultsSeeded: false }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText(/No categories yet/)).toBeInTheDocument();
    expect(screen.getByText(/No tags yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add example categories' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Add example categories' }),
      ).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/taxonomy/defaults',
      expect.objectContaining({ method: 'POST' }),
    );
  });
  it('preserves a mutation dialog after connection failure and returns expired sessions to sign-in', async () => {
    const user = userEvent.setup();
    render(<TaxonomyManagement />);
    await user.click(await screen.findByRole('button', { name: 'Create tag' }));
    await user.type(screen.getByLabelText('Name'), 'Travel');
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
    fetchMock.mockResolvedValueOnce(response({}, 401));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Electronics')).not.toBeInTheDocument();
  });
});

describe('reusable taxonomy selectors', () => {
  it('displays retired assignments clearly while excluding them from new choices', async () => {
    const user = userEvent.setup();
    render(<CategorySelector taxonomy={fixture} categoryId="retired" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Subcategory (optional)' })).toBeDisabled();
    const combo = screen.getByRole('combobox', { name: 'Category' });
    combo.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Old hobbies (retired)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Books' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');
  });
  it('clears the subcategory when changing root and lets keyboard users toggle reusable tags', async () => {
    function Selectors(): ReactElement {
      const [assignment, setAssignment] = useState<{ categoryId?: string; subcategoryId?: string }>(
        { categoryId: 'root', subcategoryId: 'child' },
      );
      const [tags, setTags] = useState<string[]>([]);
      return (
        <>
          <CategorySelector
            taxonomy={fixture}
            {...assignment}
            onChange={(categoryId, subcategoryId) =>
              setAssignment({
                ...(categoryId ? { categoryId } : {}),
                ...(subcategoryId ? { subcategoryId } : {}),
              })
            }
          />
          <TagSelector taxonomy={fixture} selectedIds={tags} onChange={setTags} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Selectors />);
    const combo = screen.getByRole('combobox', { name: 'Category' });
    combo.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Books' }));
    expect(screen.getByRole('combobox', { name: 'Subcategory (optional)' })).toHaveTextContent(
      'No subcategory',
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Daily use' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
    fireEvent.blur(checkbox);
  });
});
