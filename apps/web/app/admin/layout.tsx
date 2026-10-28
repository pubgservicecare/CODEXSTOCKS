import type { Metadata } from "next";
import "@codex/ui/styles.css";

export const metadata: Metadata = {
  title: "CODE X STOCKS · Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
