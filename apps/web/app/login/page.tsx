import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { House, LockKeyhole } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { ThemeToggle } from '@/components/theme-toggle';
import homeImage from '@/public/login-home.webp';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default function LoginPage(): ReactElement {
  return (
    <main className="min-h-svh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        aria-label="Rediscover your home"
        className="relative h-40 overflow-hidden bg-muted sm:h-64 lg:h-auto lg:min-h-svh"
      >
        <Image
          src={homeImage}
          alt="Books, a camera, a travel bag and everyday objects on a home shelf"
          fill
          priority
          unoptimized
          sizes="(min-width: 1024px) 53vw, 100vw"
          className="object-cover object-[center_60%]"
        />
        <div className="absolute inset-0 hidden bg-gradient-to-t from-black/85 via-black/45 to-transparent lg:block" />
        <div className="absolute left-6 top-6 flex items-center gap-2.5 rounded-full bg-white/95 px-4 py-2.5 text-neutral-950 sm:left-10 sm:top-10">
          <House aria-hidden="true" className="size-5" strokeWidth={1.8} />
          <span className="text-lg font-semibold tracking-tight">Havefolio</span>
        </div>
        <div className="absolute bottom-14 left-12 right-12 hidden max-w-lg text-white lg:block">
          <p className="mb-4 text-sm font-medium">Shop your own home</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            There’s more at home
            <br />
            than you remember.
          </h2>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-white/90">
            Keep the things you own in view. Find something useful before looking for something new.
          </p>
        </div>
      </section>
      <section className="relative flex flex-col px-6 pb-8 pt-6 sm:px-10 lg:min-h-svh lg:px-12">
        <div className="absolute right-6 top-6 flex justify-end sm:right-10 lg:static">
          <ThemeToggle />
        </div>
        <div className="mx-auto w-full max-w-sm flex-1 py-8 sm:py-12 lg:flex lg:flex-col lg:justify-center lg:py-16">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Your personal inventory</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Welcome home.</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Sign in to see what you already have.
          </p>
          <LoginForm />
          <p className="mt-7 flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
            Your inventory and photos stay private.
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          A little less buying. A little more using.
        </p>
      </section>
    </main>
  );
}
