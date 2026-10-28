import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LogoMark } from "@codex/ui/icons";
import "@codex/ui/fonts.css";
import "./store.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL || "https://codexstocks.org"),
  title: { default: "CODE X STOCKS — PUBG Mobile accounts", template: "%s · CODE X STOCKS" },
  description: "Browse hand-checked PUBG Mobile accounts and enquire directly on WhatsApp.",
  openGraph: { type: "website", siteName: "CODE X STOCKS" },
};

export const viewport: Viewport = { themeColor: "#08090c", width: "device-width", initialScale: 1 };

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="logo" aria-label="CODE X STOCKS home">
              <LogoMark size={32} />
              <span>CODE X STOCKS</span>
            </Link>
            <nav className="topnav" aria-label="Main">
              <Link href="/#accounts">Accounts</Link>
              <Link href="/#how">How it works</Link>
            </nav>
            <span className="spacer" />
            <Link href="/#accounts" className="btn sm">Browse accounts</Link>
          </div>
        </header>
        <div id="main">{children}</div>
        <footer className="site-foot">
          <div className="wrap">
            <div className="foot-brand">
              <LogoMark size={28} />
              <div>
                <b>CODE X STOCKS</b>
                <span>Hand-checked PUBG Mobile accounts. Enquiries on WhatsApp; every sale is confirmed personally by the owner.</span>
              </div>
            </div>
            <p className="legal">
              © {new Date().getFullYear()} CODE X STOCKS. PUBG Mobile is a trademark of its respective owners; this site is not affiliated
              with or endorsed by them. Artwork on this site is original illustration and does not show any account for sale unless marked as a
              photo.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
