"use client";

export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="wrap section">
      <div className="state" role="alert">
        <b>Something went wrong.</b>
        <span>The page could not be loaded. Please try again.</span>
        <button className="btn btn-red" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
