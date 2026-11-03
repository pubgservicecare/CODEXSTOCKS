"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient } from "@codex/api-client";
import { AdminApp, Field, Icon, Notice, setCardArt, type AdminPresentation } from "@codex/ui";
import { BRAND, CARD_ART, STORY } from "../(store)/art";
import { webService } from "./WebService";
import { WebDashboard } from "./WebDashboard";
import { WebShell } from "./WebShell";

const PRESENTATION: AdminPresentation = { shell: WebShell, dashboard: WebDashboard };
// The website's screens use the owner's PUBG artwork for accounts without a photo (the desktop keeps its own set).
setCardArt(CARD_ART);

/** Website sign-in frame: full-height artwork with the brand on one side, the form in a glass panel. */
function WebAuth({ children }: { children: ReactNode }) {
  return (
    <div className="wl">
      <div className="wl-art" aria-hidden="true">
        <img src={STORY.ice} alt="" />
        <div className="wl-art-copy">
          <span className="wl-kicker">Private · owner only</span>
          <b>Command your stock.</b>
          <span>Inventory, encrypted login details and PKR/USD books — the same data as your desktop app.</span>
        </div>
        <span className="art-note">Illustrative artwork</span>
      </div>
      <main className="wl-panel">
        <div className="wl-card">
          <div className="wl-brand">
            <img className="wl-x" src={BRAND.x} alt="" />
            <div>
              <img src={BRAND.word} alt="CODE X" />
              <span>Stocks · Admin</span>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Login() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <WebAuth>
      <div className="auth-eyebrow"><Icon name="lock" size={13} /> Private · owner only</div>
      <h1>Owner sign in</h1>
      <p className="lede">The private admin for codexstocks.org. Same inventory, books and vault as your desktop app.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await new ApiClient({ baseUrl: window.location.origin, credentials: "same-origin" }).login({ username: u, password: p, client: "web" });
            window.location.reload();
          } catch (e2) {
            const status = (e2 as { status?: number })?.status;
            setErr(status === 0 ? "Cannot reach the server. Check your internet connection and try again." : e2 instanceof Error ? e2.message : String(e2));
            setBusy(false);
          }
        }}
      >
        <Field label="Owner username"><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus /></Field>
        <Field label="Login password"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
        {err && <Notice kind="bad">{err}</Notice>}
        <button className="btn primary lg" disabled={busy} style={{ width: "100%" }}><Icon name="lock" size={16} /> {busy ? "Signing in…" : "Sign In"}</button>
      </form>
      <p className="small faint" style={{ marginTop: 16 }}>
        Stored game-account passwords stay encrypted until you unlock the vault with your vault passphrase in this browser tab.
      </p>
    </WebAuth>
  );
}

export function AdminRoot({ username, unavailable }: { username: string | null; unavailable: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const svc = useMemo(() => (mounted && username ? webService(username) : null), [mounted, username]);
  const unavailableView = unavailable && (
    <WebAuth>
      <h1>Temporarily unavailable</h1>
      <Notice kind="bad">The service is temporarily unavailable. Please try again shortly.</Notice>
    </WebAuth>
  );
  // Idle lock: sign out (which also wipes the vault key) after N minutes without input — same rule as the desktop app.
  useEffect(() => {
    if (!svc) return;
    let last = Date.now();
    let minutes = 10;
    const bump = () => (last = Date.now());
    const evs = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const load = () => void svc.prefs?.().then((p) => (minutes = p.idle_minutes));
    load();
    const off = svc.subscribe(load);
    const t = setInterval(() => {
      if (Date.now() - last > minutes * 60_000) void svc.logout();
    }, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
      off();
    };
  }, [svc]);
  if (unavailableView) return unavailableView;
  if (!username) return <Login />;
  if (!svc) return <div className="wx-boot" aria-busy="true"><img src={BRAND.x} alt="" /></div>;
  // On admin.codexstocks.org the URL is "/accounts"; on localhost development it is "/admin/accounts".
  const basename = window.location.pathname.startsWith("/admin") ? "/admin" : undefined;
  return <AdminApp svc={svc} router="browser" basename={basename} presentation={PRESENTATION} />;
}
