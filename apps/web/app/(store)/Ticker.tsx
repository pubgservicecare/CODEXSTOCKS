/**
 * A continuous right-to-left promotional strip. Two identical groups scroll by exactly one group width, so the
 * loop has no visible jump. Pure CSS (transform only); paused on hover; static for reduced motion. The text is
 * read once by screen readers; the moving copies are decorative.
 */
export function Ticker({ items, variant, seconds, label }: { items: string[]; variant: "signal" | "outline"; seconds: number; label: string }) {
  const group = (
    <span className="ticker-group" aria-hidden="true">
      {[...items, ...items].map((t, i) => (
        <span className={`ticker-item${variant === "outline" && i % 2 ? " is-hollow" : ""}`} key={i}>
          {t}
          <svg className="ticker-x" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16" /></svg>
        </span>
      ))}
    </span>
  );
  return (
    <div className={`ticker ticker--${variant}`} role="region" aria-label={label}>
      <span className="sr-only">{items.join(" · ")}</span>
      <div className="ticker-track" style={{ ["--t" as string]: `${seconds}s` }}>
        {group}
        {group}
      </div>
    </div>
  );
}
