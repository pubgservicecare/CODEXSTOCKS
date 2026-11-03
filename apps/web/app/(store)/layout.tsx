import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { whatsappLink } from "@codex/shared";
import "@codex/ui/fonts.css";
import "./store.css";
import { display, hud } from "../fonts/fonts";
import { BRAND } from "./art";
import { CurrencySwitch } from "./CurrencySwitch";
import { Intro, INTRO_BOOT } from "./Intro";
import { MobileMenu } from "./MobileMenu";
import { Motion } from "./Motion";
import { Ticker } from "./Ticker";
import { Glyph } from "./glyph";
import { WhatsAppIcon } from "./ui";
import { displayCurrency } from "../../lib/currency";
import { settings } from "../../lib/public";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_SITE_URL || "https://codexstocks.org"),
  title: { default: "CODE X STOCKS — Premium PUBG Mobile accounts", template: "%s · CODE X STOCKS" },
  description: "Hand-checked PUBG Mobile accounts. Browse what's in stock and deal directly with the owner on WhatsApp.",
  openGraph: { type: "website", siteName: "CODE X STOCKS" },
};

export const viewport: Viewport = { themeColor: "#050506", width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "dark" };

const SIGNAL = ["Premium PUBG accounts", "New inventory", "Browse available accounts", "Secure enquiries", "Direct WhatsApp contact", "CODE X STOCKS marketplace"];

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [{ currency }, store] = await Promise.all([displayCurrency(), settings().catch(() => null)]);
  const wa = whatsappLink(store?.whatsapp ?? null, "Hi CODE X STOCKS, I'd like to ask about your PUBG Mobile accounts.");
  return (
    <html lang="en" className={`${display.variable} ${hud.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Intro />
        <header className="site-head">
          <div className="wrap head-row">
            <Link href="/" className="brand" aria-label="CODE X STOCKS — home">
              <img className="brand-x" src={BRAND.x} alt="" width={34} height={37} />
              <span className="brand-type">
                <img className="brand-word" src={BRAND.word} alt="CODE X" width={82} height={24} />
                <span className="brand-stocks">Stocks</span>
              </span>
            </Link>
            <nav className="head-nav" aria-label="Main">
              <Link href="/accounts">Accounts</Link>
              <Link href="/#how">How it works</Link>
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer">Contact</a>}
            </nav>
            <span className="head-gap" />
            <Link href="/accounts#search" className="icon-btn head-search" aria-label="Search accounts">
              <Glyph name="search" size={19} />
            </Link>
            <CurrencySwitch current={currency} />
            <Link href="/accounts" className="btn btn-red btn-sm head-cta">Browse</Link>
            <MobileMenu wa={wa} />
          </div>
        </header>
        <Ticker variant="signal" items={SIGNAL} seconds={34} label="CODE X STOCKS highlights" />
        <div id="main">{children}</div>
        <footer className="site-foot">
          <div className="wrap foot-grid">
            <div className="foot-brand">
              <img src={BRAND.x} alt="" width={44} height={48} />
              <div>
                <img src={BRAND.word} alt="CODE X" width={110} height={32} />
                <p>Hand-checked PUBG Mobile accounts. Enquiries on WhatsApp; every sale is confirmed personally by the owner.</p>
              </div>
            </div>
            <nav className="foot-links" aria-label="Footer">
              <Link href="/accounts">All accounts</Link>
              <Link href="/#how">How it works</Link>
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon size={16} /> WhatsApp
                </a>
              )}
            </nav>
          </div>
          <div className="wrap foot-legal">
            <p>
              © {new Date().getFullYear()} CODE X STOCKS. PUBG Mobile is a trademark of its respective owners; this site is not affiliated with or
              endorsed by them. Outfit artwork on this site is shown for illustration and does not show any account for sale unless marked as a photo.
              Currency conversions are approximate;{" "}
              <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates By Exchange Rate API</a>.
            </p>
          </div>
        </footer>
        <Motion />
      </body>
    </html>
  );
}
