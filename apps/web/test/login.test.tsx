import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../components/login-form';
const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function submit(): void {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a synthetic long password' },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
}
describe('owner sign-in', () => {
  it('uses same-origin HttpOnly session login and navigates only on success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetcher);
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/store'));
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({ credentials: 'same-origin', method: 'POST' }),
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
  it('displays a generic failure without navigating or disclosing server details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to sign in');
    expect(push).not.toHaveBeenCalled();
  });
  it('blocks duplicate submits while the request is pending', () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    submit();
    const button = screen.getByRole('button', { name: 'Signing in…' });
    fireEvent.submit(button.closest('form')!);
    expect(button).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('lets the owner reveal and hide the password without changing it', () => {
  render(<LoginForm />);
  const input = screen.getByLabelText('Password');
  fireEvent.change(input, { target: { value: 'a synthetic long password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(input).toHaveAttribute('type', 'text');
  expect(input).toHaveValue('a synthetic long password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(input).toHaveAttribute('type', 'password');
});

it('announces a connection failure and leaves the form retryable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic network failure')));
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});
