/** Shown while a storefront page streams in: a scanning crosshair instead of a blank screen. */
export default function Loading() {
  return (
    <main className="wrap section page-loading" aria-busy="true">
      <div className="scan-loader" aria-hidden="true">
        <i />
      </div>
      <p className="kicker">Loading</p>
    </main>
  );
}
