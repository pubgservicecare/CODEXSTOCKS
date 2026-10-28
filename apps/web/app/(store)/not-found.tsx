import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap section">
      <div className="state">
        <h1>This account isn&apos;t listed</h1>
        <p>It may have been sold, or the link is wrong.</p>
        <Link className="btn gold" href="/#accounts">Browse available accounts</Link>
      </div>
    </main>
  );
}
