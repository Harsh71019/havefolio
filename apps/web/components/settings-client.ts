import type {
  AuthSessionSummary,
  OwnerPreferences,
  SettingsOverview,
  UpdateOwnerPreferencesInput,
} from '@havefolio/contracts';

const messages: Record<string, string> = {
  STALE_SETTINGS_REVISION: 'Settings were modified elsewhere. Latest preferences have been loaded.',
  INVALID_SETTINGS_CURRENCY: 'Please select a valid ISO 4217 currency code.',
  INVALID_SETTINGS_REVISION: 'Invalid settings revision. Reload and try again.',
  CANNOT_REVOKE_CURRENT_SESSION: 'To sign out of this device, use Log out.',
  SESSION_NOT_FOUND: 'This session has already ended or expired.',
  SETTINGS_UNAVAILABLE: 'Settings service is currently unavailable. Please try again.',
  AUTH_REQUIRED: 'Sign in to access your settings.',
};

export class SettingsRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'SettingsRequestError';
  }

  isStale(): boolean {
    return this.code === 'STALE_SETTINGS_REVISION';
  }
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/settings${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new SettingsRequestError(
      0,
      'Unable to connect to the settings service. Check your connection.',
    );
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
    };
    const code = typeof data.message === 'string' ? data.message : data.code;
    const userMessage: string =
      (code ? messages[code] : undefined) ??
      (response.status === 401
        ? 'Sign in to access your settings.'
        : response.status === 409
          ? (messages.STALE_SETTINGS_REVISION ?? 'Settings changed elsewhere.')
          : 'Could not complete the settings request. Try again.');

    throw new SettingsRequestError(response.status, userMessage, code);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

export async function fetchSettingsOverview(): Promise<SettingsOverview> {
  return request<SettingsOverview>('');
}

export async function fetchOwnerPreferences(): Promise<OwnerPreferences> {
  return request<OwnerPreferences>('/preferences');
}

export async function updateOwnerPreferences(
  input: UpdateOwnerPreferencesInput,
): Promise<OwnerPreferences> {
  return request<OwnerPreferences>('', 'PATCH', input);
}

export async function listActiveSessions(): Promise<AuthSessionSummary[]> {
  return request<AuthSessionSummary[]>('/sessions');
}

export async function revokeActiveSession(sessionId: string): Promise<void> {
  return request<void>(`/sessions/${encodeURIComponent(sessionId)}`, 'DELETE');
}

/** Ends this device's session. An already-expired session (401) counts as logged out. */
export async function logoutThisDevice(): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new SettingsRequestError(0, 'Unable to connect. Check your connection and try again.');
  }
  if (!response.ok && response.status !== 401)
    throw new SettingsRequestError(response.status, 'Could not log out. Try again.');
}

export async function revokeOtherSessions(): Promise<{ revokedCount: number }> {
  return request<{ revokedCount: number }>('/sessions', 'DELETE');
}
