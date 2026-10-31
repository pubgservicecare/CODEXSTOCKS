import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, Loading, Money, StatusBadge, SyncDot, useApp, useLoad, fmtDate } from "../components";
import { Icon } from "../icons";
import { fallbackArt } from "../art";
import type { AccountListItem } from "../service";
import { canMarkSold, MarkSoldDialog } from "./MarkSold";
import { FxEquivalent } from "../fx-ui";

type SortKey = "title" | "status" | "purchase_cost_minor" | "list_price_minor" | "created_at" | "updated_at";
type View = "grid" | "list";

const VIEW_KEY = "codex.accounts.view";
function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** ImageKit thumbnail of the owner's own photo, or null when none was supplied. */
export function accountThumb(a: { image_url: string | null }, w = 640, h = 360): string | null {
  return a.image_url ? `${a.image_url}?tr=w-${w},h-${h},fo-auto` : null;
}

export function AccountsPage() {
  const { svc } = useApp();
  const nav = useNavigate();
  const { data, error, loading } = useLoad(() => svc.listAccounts(), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [pub, setPub] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [view, setView] = useState<View>(savedView);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created_at", dir: -1 });
  const [selling, setSelling] = useState<AccountListItem | null>(null);

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-device preference only */
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, available: 0, reserved: 0, sold: 0, archived: 0 };
    for (const a of data ?? []) (c.all++, (c[a.status] = (c[a.status] ?? 0) + 1));
    return c;
  }, [data]);

  const rows = useMemo(() => {
    let r: AccountListItem[] = data ?? [];
    const needle = q.trim().toLowerCase();
    if (needle)
      r = r.filter((a) =>
        [a.title, a.description_public, a.internal_notes, a.purchase_reference, a.old_owner_name, a.id]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(needle)),
      );
    if (status !== "all") r = r.filter((a) => a.status === status);
    if (pub !== "all") r = r.filter((a) => (pub === "yes" ? a.published : !a.published));
    if (currency !== "all") r = r.filter((a) => a.purchase_currency === currency || a.list_currency === currency);
    return [...r].sort((a, b) => {
      const x = a[sort.key] ?? "";
      const y = b[sort.key] ?? "";
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [data, q, status, pub, currency, sort]);

  const th = (key: SortKey, label: string, num = false) => (
    <th
      className={`sortable ${num ? "num" : ""}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {label}
      {sort.key === key && <span className="sort">{sort.dir === 1 ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Accounts</h1>
          <p>{data ? `${rows.length} of ${data.length} PUBG Mobile accounts` : "Your PUBG Mobile account inventory"}</p>
        </div>
        <span className="spacer" />
        <Link className="btn primary" to="/accounts/new"><Icon name="plus" size={16} /> New account</Link>
      </div>

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Status">
          {(["all", "available", "reserved", "sold", "archived"] as const).map((k) => (
            <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)} aria-pressed={status === k}>
              {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)}
              <span className="n">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <div className="seg icons" role="group" aria-label="Layout">
          <button className={view === "grid" ? "on" : ""} onClick={() => changeView("grid")} aria-pressed={view === "grid"} title="Grid view" aria-label="Grid view"><Icon name="grid" size={16} /></button>
          <button className={view === "list" ? "on" : ""} onClick={() => changeView("list")} aria-pressed={view === "list"} title="List view" aria-label="List view"><Icon name="list" size={16} /></button>
        </div>
      </div>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input placeholder="Search title, description, notes, reference, ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        </div>
        <select value={pub} onChange={(e) => setPub(e.target.value)} aria-label="Website filter">
          <option value="all">Website: any</option>
          <option value="yes">Published</option>
          <option value="no">Not published</option>
        </select>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency filter">
          <option value="all">Any currency</option>
          <option value="USD">USD</option>
          <option value="PKR">PKR</option>
        </select>
        {view === "grid" && (
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(":"); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }} aria-label="Sort">
            <option value="created_at:-1">Newest first</option>
            <option value="created_at:1">Oldest first</option>
            <option value="list_price_minor:-1">Price: high to low</option>
            <option value="list_price_minor:1">Price: low to high</option>
            <option value="title:1">Title A–Z</option>
          </select>
        )}
      </div>

      <Loading error={error} loading={loading && !data} />
      {data && !rows.length && (
        <div className="card">
          {data.length ? (
            <EmptyState icon="search" title="No matches" body="No accounts match these filters." action={<button className="btn sm" onClick={() => { setQ(""); setStatus("all"); setPub("all"); setCurrency("all"); }}>Clear filters</button>} />
          ) : (
            <EmptyState title="Your inventory is empty" body="Add your first PUBG Mobile account with its login links, password and price." action={<Link className="btn primary" to="/accounts/new"><Icon name="plus" size={16} /> New account</Link>} />
          )}
        </div>
      )}

      {data && rows.length > 0 && view === "grid" && (
        <div className="inv-grid">
          {rows.map((a, i) => {
            const img = accountThumb(a);
            return (
              <div key={a.id} className="inv-card" data-account-row>
                <Link to={`/accounts/${a.id}`} className="inv-link">
                <div className="media">
                  <img src={img ?? fallbackArt(a.id, i)} alt="" loading="lazy" />
                  <StatusBadge status={a.status} className="status-chip chip-solid" />
                  {!img && <span className="art-chip"><Icon name="image" size={12} /> No photo · artwork</span>}
                  {a.sync_state && a.sync_state !== "synced" && (
                    <span className="badge chip-solid sync-chip"><SyncDot state={a.sync_state} />{a.sync_state === "pending" ? "Not synced" : a.sync_state}</span>
                  )}
                </div>
                <div className="body">
                  <div className="title">{a.title}</div>
                  <div className="foot">
                    <div>
                      <div className="price">{a.list_price_minor === null ? <span className="faint" style={{ fontSize: 14, fontWeight: 550 }}>No price set</span> : <Money minor={a.list_price_minor} currency={a.list_currency} />}</div>
                      <FxEquivalent minor={a.list_price_minor} currency={a.list_currency} className="small faint" />
                      <div className="small faint">Cost <Money minor={a.purchase_cost_minor} currency={a.purchase_currency} /></div>
                    </div>
                    {a.published && a.status === "available" ? <span className="badge gold"><Icon name="globe" size={12} /> Live</span> : null}
                  </div>
                  <div className="meta">
                    <span title="Login links"><Icon name="link" size={13} />{a.link_count ? `${a.link_count}/4 links` : <b style={{ color: "var(--bad)" }}>No login link</b>}</span>
                    <span><Icon name="history" size={13} />{fmtDate(a.created_at)}</span>
                  </div>
                </div>
                </Link>
                {canMarkSold(a) && (
                  <div className="inv-actions">
                    <button className="btn sm primary" onClick={() => setSelling(a)}><Icon name="sales" size={14} /> Mark as Sold</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && rows.length > 0 && view === "list" && (
        <div className="table-wrap table-cards">
          <table>
            <thead>
              <tr>
                {th("title", "Account")}
                {th("status", "Status")}
                <th>Website</th>
                <th>Links</th>
                {th("purchase_cost_minor", "Cost", true)}
                {th("list_price_minor", "Price", true)}
                {th("created_at", "Added")}
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const img = accountThumb(a, 160, 100);
                return (
                  <tr key={a.id} className="clickable" onClick={() => nav(`/accounts/${a.id}`)} data-account-row>
                    <td className="cell-main">
                      <div className="cell-media">
                        <img src={img ?? fallbackArt(a.id)} alt="" loading="lazy" style={img ? undefined : { opacity: 0.6 }} />
                        <div className="t">
                          <b>{a.title}</b>
                          <small className="row" style={{ gap: 6 }}><SyncDot state={a.sync_state} />{a.sync_state === "synced" || !a.sync_state ? "" : a.sync_state === "pending" ? "Not synced yet" : a.sync_state}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Status"><StatusBadge status={a.status} /></td>
                    <td data-label="Website">{a.published ? <span className="badge gold">Published</span> : <span className="faint small">Private</span>}</td>
                    <td data-label="Links">{a.link_count ? <span className="small">{a.link_count}/4</span> : <span className="badge bad">None</span>}</td>
                    <td className="num" data-label="Cost"><Money minor={a.purchase_cost_minor} currency={a.purchase_currency} /></td>
                    <td className="num" data-label="Price">
                      <span className="price-cell"><b><Money minor={a.list_price_minor} currency={a.list_currency} /></b><FxEquivalent minor={a.list_price_minor} currency={a.list_currency} className="small faint" /></span>
                    </td>
                    <td className="small muted" data-label="Added">{fmtDate(a.created_at)}</td>
                    <td className="row-actions">
                      {canMarkSold(a) && (
                        <button className="btn sm" onClick={(e) => (e.stopPropagation(), setSelling(a))}><Icon name="sales" size={14} /> Mark as Sold</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selling && <MarkSoldDialog account={selling} onClose={() => setSelling(null)} />}
    </>
  );
}
