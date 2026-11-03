"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, NAV, SyncBadge, TABS, useFx, useLoad, useTableLabels, type DataService, type SyncSummary } from "@codex/ui";
import { BRAND } from "../(store)/art";

const TITLES: [RegExp, string, string][] = [
  [/^\/$/, "Dashboard", "Overview"],
  [/^\/accounts\/new$/, "New account", "Inventory"],
  [/^\/accounts\/[^/]+\/edit$/, "Edit account", "Inventory"],
  [/^\/accounts\/[^/]+$/, "Account", "Inventory"],
  [/^\/accounts$/, "Inventory", "Inventory"],
  [/^\/sales/, "Sales & refunds", "Money"],
  [/^\/expenses/, "Expenses", "Money"],
  [/^\/history/, "History", "Records"],
  [/^\/sync/, "Sync & conflicts", "Records"],
  [/^\/devices/, "Devices", "System"],
  [/^\/settings/, "Settings", "System"],
  [/^\/backup/, "Backup & restore", "System"],
];

/** The admin website's frame: cinematic sidebar, command bar, phone drawer and tab bar. Website only. */
export function WebShell({ children, svc }: { children: ReactNode; svc: DataService }) {
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [unlocked, setUnlocked] = useState(svc.vaultUnlocked());
  const loc = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const { quote } = useFx();
  useTableLabels(mainRef);
  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [drawer]);
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
  const [, title, group] = TITLES.find(([re]) => re.test(loc.pathname)) ?? [null, "Admin", "CODE X"];
  const conflictCount = conflicts?.length ?? 0;

  return (
    <div className={`wx-shell${drawer ? " is-drawer" : ""}`} data-section={group.toLowerCase()}>
      {drawer && <div className="wx-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside className="wx-side" id="wx-drawer" aria-label="Navigation">
        <div className="wx-brand">
          <img className="wx-brand-x" src={BRAND.x} alt="" />
          <div className="wx-brand-type">
            <img src={BRAND.word} alt="CODE X" />
            <span>Stocks · Admin</span>
          </div>
          <button className="wx-icon-btn wx-drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="x" size={18} /></button>
        </div>
        <nav className="wx-nav" aria-label="Main">
          {NAV.map((g) => (
            <div key={g.group} className="wx-nav-group">
              <div className="wx-nav-label">{g.group}</div>
              {g.items.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === "/"}>
                  <Icon name={icon} size={17} />
                  <span>{label}</span>
                  {to === "/sync" && conflictCount ? <span className="wx-count" aria-label={`${conflictCount} conflicts`}>{conflictCount}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="wx-rate" title="Daily reference rate used for display conversions">
          <span className="wx-rate-k">USD / PKR</span>
          {quote ? (
            <>
              <b>{(quote.usd_pkr_micro / 1_000_000).toFixed(2)}</b>
              <small className={quote.status === "stale" ? "fx-stale" : undefined}>{quote.frequency} reference · {quote.status}</small>
            </>
          ) : (
            <small>No reference rate yet</small>
          )}
        </div>
        <div className="wx-user">
          <span className="wx-avatar" aria-hidden="true">{user.slice(0, 1)}</span>
          <span className="wx-who">
            <b>{user}</b>
            <small>Owner</small>
          </span>
          <button className="wx-icon-btn" onClick={() => void svc.logout()} title="Sign out" aria-label="Sign out"><Icon name="logout" size={17} /></button>
        </div>
      </aside>

      <main className="wx-main" ref={mainRef}>
        <header className="wx-top">
          <button className="wx-icon-btn wx-menu" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="wx-drawer">
            <Icon name="menu" size={20} />
          </button>
          <img className="wx-top-x" src={BRAND.x} alt="" />
          <div className="wx-title">
            <span>{group}</span>
            <b>{title}</b>
          </div>
          <span className="wx-gap" />
          <SyncBadge s={sync} />
          {unlocked ? (
            <button className="status-pill vault-btn unlocked" onClick={() => svc.lockVault()} title="Clear decrypted keys from memory" aria-label="Vault unlocked. Lock now">
              <Icon name="unlock" size={15} /> <span className="pill-text">Vault unlocked · Lock</span>
            </button>
          ) : (
            <span className="status-pill vault-btn" title="Stored passwords and backup codes are encrypted" aria-label="Vault locked">
              <Icon name="lock" size={15} /> <span className="pill-text">Vault locked</span>
            </span>
          )}
          <NavLink to="/accounts/new" className="btn primary wx-new"><Icon name="plus" size={16} /> New account</NavLink>
        </header>
        <div className="cx-page wx-page" key={loc.pathname}>{children}</div>
      </main>

      <nav className="wx-tabbar" aria-label="Quick navigation">
        {TABS.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end className={to === "/accounts/new" ? "wx-tab-new" : undefined}>
            <Icon name={icon} size={to === "/accounts/new" ? 22 : 20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} aria-controls="wx-drawer">
          <Icon name="menu" size={20} />
          <span>Menu</span>
          {conflictCount ? <span className="wx-count" aria-label={`${conflictCount} conflicts`}>{conflictCount}</span> : null}
        </button>
      </nav>
    </div>
  );
}
