import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserRouter, HashRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AppCtx, errMsg, Field, Modal, Notice, useLoad } from "./components";
import { Icon, LogoMark, type IconName } from "./icons";
import { ART } from "./art";
import type { DataService, SyncSummary } from "./service";
import { Dashboard } from "./pages/Dashboard";
import { AccountsPage } from "./pages/Accounts";
import { AccountDetail } from "./pages/AccountDetail";
import { AccountForm } from "./pages/AccountForm";
import { SalesPage } from "./pages/Sales";
import { ExpensesPage } from "./pages/Expenses";
import { SyncPage } from "./pages/Sync";
import { DevicesPage } from "./pages/Devices";
import { SettingsPage } from "./pages/Settings";
import { BackupPage } from "./pages/Backup";
import { HistoryPage } from "./pages/History";
import { FxProvider } from "./fx-ui";

export function Brand({ sub }: { sub?: string }) {
  return (
    <div className="cx-brand">
      <LogoMark />
      <div>
        <b>CODE X STOCKS</b>
        <small>{sub ?? "Inventory"}</small>
      </div>
    </div>
  );
}

/**
 * Split sign-in / setup layout used by the desktop app and the admin website:
 * restrained original artwork on the left, the form on the right.
 */
export function AuthShell({ children, steps, step, sub = "Secure inventory", art = "dusk" }: { children: ReactNode; steps?: number; step?: number; sub?: string; art?: "dusk" | "snow" }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-art">
        <img src={art === "snow" ? ART.loginSnow : ART.loginDusk} alt="" />
        <Brand sub={sub} />
        <blockquote>
          <b>Every account, every code, every rupee — in one place.</b>
          <span>Inventory, encrypted credentials and PKR/USD books for your PUBG Mobile accounts. Works offline, syncs when you're online.</span>
        </blockquote>
        <span className="art-note">Original illustration</span>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          {steps ? (
            <div className="steps" aria-label={`Step ${(step ?? 0) + 1} of ${steps}`}>
              {Array.from({ length: steps }, (_, i) => <span key={i} className={i <= (step ?? 0) ? "on" : ""} />)}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}

function UnlockDialog({ svc, onDone }: { svc: DataService; onDone: (ok: boolean) => void }) {
  const [mode, setMode] = useState<"pass" | "recovery">("pass");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "pass") await svc.unlockVault(value);
      else await svc.unlockVaultWithRecoveryKey(value);
      setValue("");
      onDone(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Unlock credential vault" icon="lock" onClose={() => onDone(false)}>
      <p className="muted" style={{ marginTop: 0 }}>
        Passwords and backup codes are encrypted on your devices. Unlocking decrypts them in this app's memory only; the server never sees
        your vault passphrase.
      </p>
      <form onSubmit={submit}>
        {mode === "pass" ? (
          <Field label="Vault passphrase" error={error}>
            <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          </Field>
        ) : (
          <Field label="Recovery key" hint="52 characters, e.g. ABCD-EFGH-…" error={error}>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="mono" autoComplete="off" />
          </Field>
        )}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setMode(mode === "pass" ? "recovery" : "pass")}>
            {mode === "pass" ? "Use recovery key" : "Use passphrase"}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
          <button className="btn primary" disabled={busy || !value}>{busy ? "Unlocking…" : "Unlock"}</button>
        </div>
      </form>
    </Modal>
  );
}

function SyncBadge({ s }: { s: SyncSummary | null }) {
  if (!s) return null;
  const issues = s.failed + s.rejected + s.conflicts + s.failedImages;
  const queued = s.pending + s.queuedImages;
  let cls = "ok";
  let text = "All changes synced";
  let icon: IconName = "cloud";
  if (s.phase === "unpaired") (cls = ""), (text = "Local only"), (icon = "devices");
  else if (s.phase === "cloud") (cls = s.conflicts ? "bad" : "ok"), (text = s.conflicts ? `${s.conflicts} open conflict${s.conflicts > 1 ? "s" : ""}` : "Cloud online");
  else if (s.phase === "syncing") (cls = "info"), (text = "Syncing…"), (icon = "sync");
  else if (s.phase === "auth") (cls = "bad"), (text = "Cloud sign-in needed"), (icon = "alert");
  else if (s.phase === "offline") (cls = "warn"), (text = `Offline${queued ? ` · ${queued} queued` : ""}`), (icon = "cloudOff");
  else if (issues) (cls = "bad"), (text = `${issues} sync issue${issues > 1 ? "s" : ""}`), (icon = "alert");
  else if (queued) (cls = "warn"), (text = `${queued} waiting to sync`), (icon = "sync");
  return (
    <NavLink to="/sync" className={`status-pill ${cls}`} title="Sync status" aria-label={`Sync status: ${text}`}>
      <Icon name={icon} size={15} />
      <span className="pill-text">{text}</span>
    </NavLink>
  );
}

const NAV: { group: string; items: [string, string, IconName][] }[] = [
  { group: "Inventory", items: [["/", "Dashboard", "dashboard"], ["/accounts", "Accounts", "accounts"]] },
  { group: "Money", items: [["/sales", "Sales & refunds", "sales"], ["/expenses", "Expenses", "expenses"]] },
  { group: "Records", items: [["/history", "History", "history"], ["/sync", "Sync & conflicts", "sync"]] },
  { group: "System", items: [["/devices", "Devices", "devices"], ["/settings", "Settings", "settings"], ["/backup", "Backup", "backup"]] },
];

/**
 * On phones, wide tables are shown as stacked cards (CSS). Each cell gets its column name as a
 * data-label so no column is hidden; this fills the labels for every table in the page.
 */
function useTableLabels(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const label = () => {
      for (const table of el.querySelectorAll<HTMLTableElement>(".table-wrap table")) {
        const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        for (const tr of table.querySelectorAll("tbody tr"))
          [...tr.children].forEach((td, i) => {
            if (!td.hasAttribute("data-label") && heads[i]) td.setAttribute("data-label", heads[i]);
          });
      }
    };
    label();
    const obs = new MutationObserver(label);
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [root]);
}

const TABS: [string, string, IconName][] = [["/", "Home", "dashboard"], ["/accounts", "Accounts", "accounts"], ["/accounts/new", "New", "plus"], ["/sales", "Sales", "sales"]];

function Shell({ children, svc }: { children: ReactNode; svc: DataService }) {
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useTableLabels(mainRef);
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [drawer]);
  const [unlocked, setUnlocked] = useState(svc.vaultUnlocked());
  const { data: conflicts } = useLoad(() => svc.conflicts().catch(() => []), []);
  useEffect(() => {
    const refresh = () => {
      setUnlocked(svc.vaultUnlocked());
      svc.syncStatus?.().then(setSync).catch(() => undefined);
    };
    refresh();
    const off = svc.subscribe(refresh);
    const t = setInterval(refresh, 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [svc]);
  const user = svc.username() ?? "owner";
  return (
    <div className={`cx-shell ${drawer ? "drawer-open" : ""}`}>
      {drawer && <div className="cx-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside className="cx-side" id="cx-drawer" aria-label="Navigation">
        <div className="cx-side-head">
          <Brand sub={svc.kind === "desktop" ? "Windows desktop" : "Admin website"} />
          <button className="btn ghost icon-only cx-drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="x" size={18} /></button>
        </div>
        <nav className="cx-nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="cx-nav-label">{g.group}</div>
              {g.items.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === "/"}>
                  <Icon name={icon} size={17} />
                  {label}
                  {to === "/sync" && conflicts?.length ? <span className="count" aria-label={`${conflicts.length} conflicts`}>{conflicts.length}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="cx-side-foot">
          <span className="cx-avatar" aria-hidden="true">{user.slice(0, 1)}</span>
          <span className="who">
            <b>{user}</b>
            <small>Owner</small>
          </span>
          <button className="btn ghost sm icon-only" onClick={() => void svc.logout()} title="Sign out" aria-label="Sign out">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </aside>
      <main className="cx-main" ref={mainRef}>
        <div className="cx-top">
          <button className="btn ghost icon-only cx-menu" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="cx-drawer">
            <Icon name="menu" size={20} />
          </button>
          <span className="cx-top-logo"><LogoMark size={26} /></span>
          <SyncBadge s={sync} />
          <span className="spacer" />
          {unlocked ? (
            <button className="status-pill vault-btn unlocked" onClick={() => svc.lockVault()} title="Clear decrypted keys from memory" aria-label="Vault unlocked. Lock now">
              <Icon name="unlock" size={15} /> <span className="pill-text">Vault unlocked · Lock now</span>
            </button>
          ) : (
            <span className="status-pill vault-btn" title="Stored passwords and backup codes are encrypted" aria-label="Vault locked">
              <Icon name="lock" size={15} /> <span className="pill-text">Vault locked</span>
            </span>
          )}
          <button className="btn sm ghost cx-top-signout" onClick={() => void svc.logout()}>
            <Icon name="logout" size={15} /> Sign out
          </button>
        </div>
        <div className="cx-page">{children}</div>
      </main>
      <nav className="cx-tabbar" aria-label="Quick navigation">
        {TABS.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end className={to === "/accounts/new" ? "tab-new" : undefined}>
            <Icon name={icon} size={to === "/accounts/new" ? 22 : 20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="cx-drawer">
          <Icon name="menu" size={20} />
          <span>Menu</span>
          {conflicts?.length ? <span className="count" aria-label={`${conflicts.length} conflicts`}>{conflicts.length}</span> : null}
        </button>
      </nav>
    </div>
  );
}

export function AdminApp({ svc, router = "hash", basename }: { svc: DataService; router?: "hash" | "browser"; basename?: string }) {
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: "ok" | "bad" }[]>([]);
  const [unlockReq, setUnlockReq] = useState<((ok: boolean) => void) | null>(null);

  useEffect(() => svc.subscribe(() => setVersion((v) => v + 1)), [svc]);

  const toast = useCallback((msg: string, kind: "ok" | "bad" = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 7000 : 3500);
  }, []);

  const requireVault = useCallback(
    () =>
      svc.vaultUnlocked()
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => setUnlockReq(() => resolve)),
    [svc],
  );

  const ctx = useMemo(() => ({ svc, toast, requireVault, version }), [svc, toast, requireVault, version]);
  const Router = router === "browser" ? BrowserRouter : HashRouter;

  return (
    <AppCtx.Provider value={ctx}>
      <FxProvider svc={svc}>
      <Router basename={router === "browser" ? basename : undefined}>
        <Shell svc={svc}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/new" element={<AccountForm />} />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route path="/accounts/:id/edit" element={<AccountForm />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </Router>
      </FxProvider>
      {unlockReq && (
        <UnlockDialog
          svc={svc}
          onDone={(ok) => {
            unlockReq(ok);
            setUnlockReq(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "bad" ? "alert" : "check"} size={16} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
