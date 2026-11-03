import type { Metadata, Viewport } from "next";
import "@codex/ui/styles.css";
import "./admin-web.css";
import { display, hud } from "../fonts/fonts";

export const metadata: Metadata = {
  title: "CODE X STOCKS · Admin",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#060607", width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "dark" };

/** The admin website. `cxw` switches on the website-only theme (admin-web.css); the desktop app never loads it. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`cxw ${display.variable} ${hud.variable}`}>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
