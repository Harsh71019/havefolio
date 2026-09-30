import type { ReactElement } from 'react';

export default function Loading(): ReactElement {
  return (
    <main className="shell" aria-busy="true" aria-live="polite">
      <p className="status">Preparing your home inventory…</p>
    </main>
  );
}
