"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="centered-state">
      <strong>The frontend could not render this screen</strong>
      <p>
        Your input is still stored in this tab. Try rendering the screen again.
      </p>
      <button className="button secondary" type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
