'use client';

import type { ReactElement } from 'react';

export default function ErrorPage({ reset }: Readonly<{ reset: () => void }>): ReactElement {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="error-title">
        <p className="eyebrow">Havefolio</p>
        <h1 id="error-title">We could not open this page.</h1>
        <p className="lede">Your data has not been changed. Try loading the page again.</p>
        <button className="retry" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
