import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap section">
      <div className="state">
        <p className="kicker">404 · Not listed</p>
        <b>This account isn&apos;t listed.</b>
        <span>It may have been sold, or the link is wrong.</span>
        <Link className="btn btn-red" href="/accounts">Browse available accounts</Link>
      </div>
    </main>
  );
}
