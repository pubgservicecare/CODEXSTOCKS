"use client";

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap section">
      <div className="state" role="alert">
        <h1>Something went wrong</h1>
        <p>The page could not be loaded. Please try again.</p>
        <button className="btn gold" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
