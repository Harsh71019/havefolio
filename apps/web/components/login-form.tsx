'use client';

import { useRef, useState, type ReactElement, type FormEvent } from 'react';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@havefolio/ui/components/button';
import { Input } from '@havefolio/ui/components/input';
import { Label } from '@havefolio/ui/components/label';

export function LoginForm(): ReactElement {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Too many attempts. Please try again later.'
            : 'Unable to sign in. Check your details and try again.',
        );
        return;
      }
      form.reset();
      router.push('/store');
      router.refresh();
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="mt-8 space-y-5"
      aria-busy={pending}
      aria-describedby={error ? 'login-error' : undefined}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          disabled={pending}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            minLength={15}
            maxLength={128}
            disabled={pending}
            className="h-12 pr-12"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1.5"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            disabled={pending}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </Button>
        </div>
      </div>
      {error && (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-12 w-full gap-2">
        {pending ? 'Signing in…' : 'Sign in'}
        {!pending && <ArrowRight aria-hidden="true" className="size-4" />}
      </Button>
    </form>
  );
}
