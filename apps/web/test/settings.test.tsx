import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsOverview } from '@havefolio/contracts';
import { SettingsView } from '../components/settings-view';

const mockOverview: SettingsOverview = {
  preferences: {
    defaultCurrency: 'INR',
    notifyInApp: true,
    notifyNtfy: true,
    revision: 1,
    updatedAt: '2026-10-18T10:00:00.000Z',
  },
  sessions: [
    {
      id: 'session-1',
      isCurrent: true,
      createdAt: '2026-10-18T09:00:00.000Z',
      lastUsedAt: '2026-10-18T10:00:00.000Z',
      idleExpiresAt: '2026-10-18T18:00:00.000Z',
    },
    {
      id: 'session-2',
      isCurrent: false,
      createdAt: '2026-10-17T12:00:00.000Z',
      lastUsedAt: '2026-10-17T14:00:00.000Z',
      idleExpiresAt: '2026-10-17T22:00:00.000Z',
    },
  ],
  privacy: {
    storageType: 'authenticated_cloudinary',
    storageDescription:
      'Item photos, receipts, and warranties are securely stored in private authenticated storage folders.',
    accessType: 'authenticated_proxy',
    accessDescription: 'Media is served only through authenticated Havefolio API proxy routes.',
    publicSharing: false,
    sharingDescription:
      'Havefolio is a personal inventory and decision aid. It has no marketplace or public storefront.',
    registrationLock: {
      locked: true,
      reason: 'Single owner configured. Additional registrations are blocked.',
    },
  },
  demoStatus: {
    demoItemCount: 6,
    genuineItemCount: 3,
    triedDemo: true,
    removedDemo: false,
  },
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
    if (url.includes('/api/v1/settings/overview') || url.endsWith('/api/v1/settings')) {
      return Promise.resolve(jsonResponse(mockOverview));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsView (PER-34)', () => {
  it('renders all settings sections: currency, notifications, sessions, demo data, and privacy', async () => {
    render(<SettingsView />);

    // Check loading indicator first
    expect(screen.getByRole('status', { name: 'Loading settings' })).toBeInTheDocument();

    // Wait for content
    expect(await screen.findByTestId('settings-view')).toBeInTheDocument();

    // Section headings / titles
    expect(screen.getByText('Defaults & Reminders')).toBeInTheDocument();
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('Demo Inventory')).toBeInTheDocument();
    expect(screen.getByText('Privacy & Security')).toBeInTheDocument();

    // Currency explanation
    expect(
      screen.getByText(
        /Applied to new item and desire entries. Historical purchases and existing goal allocations retain their original recorded currencies and are never converted./,
      ),
    ).toBeInTheDocument();

    // Notification switches
    expect(screen.getByRole('switch', { name: 'Toggle in-app review reminders' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Toggle push notifications' })).toBeChecked();

    // Sessions
    expect(screen.getByText('Current device')).toBeInTheDocument();
    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out other sessions/ })).toBeInTheDocument();

    // Privacy cards
    expect(screen.getByText('Registration lock')).toBeInTheDocument();
    expect(screen.getByText('Private media storage')).toBeInTheDocument();
    expect(screen.getByText('Authenticated session delivery')).toBeInTheDocument();
    expect(screen.getByText('Zero public sharing & no trackers')).toBeInTheDocument();

    // Taxonomy link
    expect(screen.getByRole('link', { name: /Manage/ })).toHaveAttribute(
      'href',
      '/settings/taxonomy',
    );
  });

  it('updates default currency successfully', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByTestId('settings-view');

    fetchMock.mockImplementationOnce((input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return Promise.resolve(
        jsonResponse({
          ...mockOverview.preferences,
          defaultCurrency: body.defaultCurrency,
          revision: 2,
        }),
      );
    });

    const currencyCombo = screen.getByRole('combobox', {
      name: 'Default entry and display currency',
    });
    currencyCombo.focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: /USD/ }));

    // Click "Save preferences"
    const saveButton = screen.getByRole('button', { name: 'Save preferences' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            revision: 1,
            defaultCurrency: 'USD',
            notifyInApp: true,
            notifyNtfy: true,
          }),
        }),
      );
    });

    expect(await screen.findByText('Preferences saved successfully.')).toBeInTheDocument();
  });

  it('toggles notification channels and saves update', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByTestId('settings-view');

    fetchMock.mockImplementationOnce((input, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      return Promise.resolve(
        jsonResponse({
          ...mockOverview.preferences,
          notifyNtfy: body.notifyNtfy,
          revision: 2,
        }),
      );
    });

    const pushSwitch = screen.getByRole('switch', { name: 'Toggle push notifications' });
    expect(pushSwitch).toBeChecked();

    await user.click(pushSwitch);

    const saveButton = screen.getByRole('button', { name: 'Save preferences' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            revision: 1,
            defaultCurrency: 'INR',
            notifyInApp: true,
            notifyNtfy: false,
          }),
        }),
      );
    });

    expect(await screen.findByText('Preferences saved successfully.')).toBeInTheDocument();
  });

  it('handles stale revision conflict by alerting the owner to refresh', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByTestId('settings-view');

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse(
          {
            statusCode: 409,
            message: 'STALE_SETTINGS_REVISION',
          },
          409,
        ),
      ),
    );

    const inAppSwitch = screen.getByRole('switch', { name: 'Toggle in-app review reminders' });
    await user.click(inAppSwitch);

    const saveButton = screen.getByRole('button', { name: 'Save preferences' });
    await user.click(saveButton);

    expect(
      await screen.findByText(
        'Settings were modified elsewhere. Latest preferences have been loaded.',
      ),
    ).toBeInTheDocument();
  });

  it('allows revoking an individual other session', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByTestId('settings-view');

    fetchMock.mockImplementationOnce((input) => {
      const url = typeof input === 'string' ? input : '';
      if (url.includes('/api/v1/settings/sessions/session-2')) {
        return Promise.resolve(jsonResponse({ revoked: true }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const revokeBtn = screen.getByRole('button', { name: 'Revoke session' });
    await user.click(revokeBtn);

    // Confirmation dialog appears
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Revoke this session?')).toBeInTheDocument();

    const confirmBtn = within(dialog).getByRole('button', { name: 'Revoke session' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings/sessions/session-2',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    // Session-2 is removed from the list
    expect(screen.queryByRole('button', { name: 'Revoke session' })).not.toBeInTheDocument();
  });

  it('allows revoking all other sessions', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await screen.findByTestId('settings-view');

    fetchMock.mockImplementationOnce((input) => {
      const url = typeof input === 'string' ? input : '';
      if (url.endsWith('/api/v1/settings/sessions')) {
        return Promise.resolve(jsonResponse({ revokedCount: 1 }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const revokeAllBtn = screen.getByRole('button', { name: /Sign out other sessions/ });
    await user.click(revokeAllBtn);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Sign out of other devices?')).toBeInTheDocument();

    const confirmBtn = within(dialog).getByRole('button', { name: 'Sign out other devices' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/settings/sessions',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    expect(screen.queryByRole('button', { name: 'Revoke session' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Sign out other sessions/ }),
    ).not.toBeInTheDocument();
  });
});
