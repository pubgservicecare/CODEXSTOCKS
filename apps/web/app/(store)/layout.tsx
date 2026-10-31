import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LogoMark } from "@codex/ui/icons";
import "@codex/ui/fonts.css";
import "./store.css";
import { MobileMenu } from "./MobileMenu";
import { CurrencySwitch } from "./CurrencySwitch";
import { displayCurrency } from "../../lib/currency";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL || "https://codexstocks.org"),
  title: { default: "CODE X STOCKS — PUBG Mobile accounts", template: "%s · CODE X STOCKS" },
  description: "Browse hand-checked PUBG Mobile accounts and enquire directly on WhatsApp.",
  openGraph: { type: "website", siteName: "CODE X STOCKS" },
};

export const viewport: Viewport = { themeColor: "#08090c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { currency } = await displayCurrency();
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
            <CurrencySwitch current={currency} />
            <Link href="/#accounts" className="btn sm top-cta">Browse accounts</Link>
            <MobileMenu />
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
              photo. Currency conversions are approximate; <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
