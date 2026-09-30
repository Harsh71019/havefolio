import Link from 'next/link';
import type { ReactElement } from 'react';

export default function NotFoundPage(): ReactElement {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="not-found-title">
        <p className="eyebrow">Havefolio</p>
        <h1 id="not-found-title">That page is not in your home.</h1>
        <p className="lede">Check the address and return to the Havefolio home page.</p>
        <Link className="retry" href="/">
          Go home
        </Link>
      </section>
    </main>
  );
}
