// Self-hosted display fonts (SIL Open Font License 1.1 — see OFL-*.txt beside the files). No external requests.
import localFont from "next/font/local";

/** Anton: condensed cinematic headlines and prices. */
export const display = localFont({ src: "./Anton-400.woff2", weight: "400", variable: "--nf-display", display: "swap" });

/** Chakra Petch: HUD labels, tickers, navigation and data. */
export const hud = localFont({
  src: [
    { path: "./ChakraPetch-500.woff2", weight: "500" },
    { path: "./ChakraPetch-600.woff2", weight: "600" },
    { path: "./ChakraPetch-700.woff2", weight: "700" },
  ],
  variable: "--nf-hud",
  display: "swap",
});
