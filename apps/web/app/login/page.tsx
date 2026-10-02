import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage(): ReactElement {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold">Sign in to Havefolio</h1>
      <p className="mt-2 text-muted-foreground">Your home inventory stays private.</p>
      <LoginForm />
    </main>
  );
}
