import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyControls } from '../components/privacy-controls';
describe('private-data controls', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('explains metadata-only export and requires both password and exact confirmation', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: 'pending',
          remainingFiles: 1,
          awaitingFinality: 1,
          completedAt: null,
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    render(<PrivacyControls />);
    expect(
      screen.getByText(/Photo and document files are downloaded separately/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByRole('button', { name: 'Confirm permanent deletion' })).toBeDisabled();
    await user.type(screen.getByLabelText('Current password'), 'synthetic-password');
    await user.type(
      screen.getByLabelText('Type DELETE MY ACCOUNT to confirm'),
      'DELETE MY ACCOUNT',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.receipt).toMatch(/^[a-f0-9]{64}$/);
    expect(localStorage.getItem('havefolio.deletion-receipt.v1')).toBe(body.receipt);
    expect(body.confirmation).toBe('DELETE MY ACCOUNT');
    expect(await screen.findByText(/Your normal sessions have been revoked/)).toBeInTheDocument();
  });
  it('keeps the receipt when submission fails and provides a status recovery path', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<PrivacyControls />);
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    await user.type(screen.getByLabelText('Current password'), 'synthetic-password');
    await user.type(
      screen.getByLabelText('Type DELETE MY ACCOUNT to confirm'),
      'DELETE MY ACCOUNT',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(localStorage.getItem('havefolio.deletion-receipt.v1')).toMatch(/^[a-f0-9]{64}$/);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Keep account' }));
    expect(screen.getByRole('button', { name: 'Check deletion status' })).toBeEnabled();
  });
  it('shows uncertain finality honestly and permits status checks without a normal session', async () => {
    const user = userEvent.setup();
    localStorage.setItem('havefolio.deletion-receipt.v1', 'a'.repeat(64));
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: 'awaiting_finality',
          remainingFiles: 0,
          awaitingFinality: 1,
          completedAt: null,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    render(<PrivacyControls />);
    await user.click(screen.getByText('Check deletion status or recover with a saved receipt'));
    await user.click(screen.getByRole('button', { name: 'Check deletion status' }));
    expect(await screen.findByText(/Deletion is pending provider finality/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/privacy/deletion-status');
  });
  it('reports export failure without starting deletion', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 413 }));
    vi.stubGlobal('fetch', fetch);
    render(<PrivacyControls />);
    await user.click(screen.getByRole('button', { name: 'Download private data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('exceeds the export limit');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
