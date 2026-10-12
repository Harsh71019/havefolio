'use client';
import { useEffect, type ReactElement } from 'react';
import { captureRenderError } from '../instrumentation-client';
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  useEffect(() => captureRenderError(error), [error]);
  return (
    <html lang="en">
      <body>
        <main>
          <h1>We could not open this page.</h1>
          <p>Your data has not been changed. Try loading the page again.</p>
          <button onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
