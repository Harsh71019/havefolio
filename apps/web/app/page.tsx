import type { ReactElement } from 'react';

const foundations = [
  'A private inventory of what you already own',
  'Honest spending totals based on what you actually paid',
  'A calm pause before a planned purchase',
] as const;

export default function HomePage(): ReactElement {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Havefolio</p>
        <h1 id="page-title">Shop your own home first.</h1>
        <p className="lede">
          A private place to rediscover what you own, understand what you have spent, and make your
          next purchase intentionally.
        </p>

        <ul className="foundation-list" aria-label="Havefolio foundations">
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>

        <p className="status" role="status">
          Workspace ready. Product journeys arrive in the next tickets.
        </p>
      </section>
    </main>
  );
}
