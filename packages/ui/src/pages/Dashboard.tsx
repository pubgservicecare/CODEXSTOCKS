import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CURRENCIES, formatMoney, type AuditEvent, type Currency, type CurrencyReport } from "@codex/shared";
import { fmtDate, Loading, Notice, useApp, useLoad } from "../components";
import { Icon, type IconName } from "../icons";
import { ART, fallbackArt } from "../art";
import type { AccountListItem } from "../service";

function Row({ label, r, k, hint, strong }: { label: string; r: Record<Currency, CurrencyReport>; k: keyof CurrencyReport; hint?: string; strong?: boolean }) {
  return (
    <tr>
      <td style={strong ? { fontWeight: 620 } : undefined}>
        {label}
        {hint && <div className="small faint">{hint}</div>}
      </td>
      {CURRENCIES.map((c) => {
        const v = r[c][k] as number;
        return (
          <td key={c} className="num" style={{ color: v < 0 ? "var(--bad)" : undefined, fontWeight: strong ? 620 : undefined }}>
            {formatMoney(v, c)}
          </td>
        );
      })}
    </tr>
  );
}

/** One currency's books. USD and PKR are never added together. */
function MoneyCard({ c, r }: { c: Currency; r: CurrencyReport }) {
  const max = Math.max(r.incoming, r.outgoing, 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="card money-card">
      <div className="card-head">
        <span className="ccy">{c}</span>
        <h2>Net profit</h2>
        <span className="spacer" />
        <span className="small faint">Net sales − cost of sold − expenses</span>
      </div>
      <div className={`figure ${r.netProfit < 0 ? "neg" : ""}`}>{formatMoney(r.netProfit, c)}</div>
      <div className="money-rows">
        <div className="money-row">
          <span className="k"><Icon name="arrowDown" size={14} style={{ color: "var(--ok)" }} /> Incoming · sales received</span>
          <span className="v">{formatMoney(r.incoming, c)}</span>
          <div className="bar"><span style={{ width: pct(r.incoming), background: "var(--ok)" }} /></div>
        </div>
        <div className="money-row">
          <span className="k"><Icon name="arrowUp" size={14} style={{ color: "var(--bad)" }} /> Outgoing · purchases, expenses, refunds</span>
          <span className="v">{formatMoney(r.outgoing, c)}</span>
          <div className="bar"><span style={{ width: pct(r.outgoing), background: "rgba(242,85,90,0.75)" }} /></div>
        </div>
        <div className="money-row"><span className="k">Purchases</span><span className="v">{formatMoney(r.purchases, c)}</span></div>
        <div className="money-row"><span className="k">Expenses</span><span className="v">{formatMoney(r.expenses, c)}</span></div>
        <div className="money-row"><span className="k">Unsold inventory at cost</span><span className="v">{formatMoney(r.inventoryValue, c)}</span></div>
      </div>
    </div>
  );
}

interface Flow { sales: { sold_at: string; amount_minor: number; currency: Currency; status: string }[]; refunds: { refunded_at: string; amount_minor: number; currency: Currency }[]; expenses: { incurred_at: string; amount_minor: number; currency: Currency }[]; accounts: AccountListItem[] }

/** Last six months: sales received vs. money out, for one currency, from recorded transactions only. */
function MonthlyChart({ flow }: { flow: Flow }) {
  const [c, setC] = useState<Currency>(() => {
    const usd = flow.sales.filter((s) => s.currency === "USD").length;
    const pkr = flow.sales.filter((s) => s.currency === "PKR").length;
    return usd > pkr ? "USD" : "PKR";
  });
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short" }) };
    });
  }, []);
  const data = useMemo(() => {
    const m = new Map(months.map((x) => [x.key, { in: 0, out: 0 }]));
    const add = (iso: string | null | undefined, k: "in" | "out", v: number) => {
      const e = iso && m.get(iso.slice(0, 7));
      if (e) e[k] += v;
    };
    flow.sales.filter((s) => s.currency === c && s.status !== "voided").forEach((s) => add(s.sold_at, "in", s.amount_minor));
    flow.refunds.filter((r) => r.currency === c).forEach((r) => add(r.refunded_at, "out", r.amount_minor));
    flow.expenses.filter((x) => x.currency === c).forEach((x) => add(x.incurred_at, "out", x.amount_minor));
    flow.accounts.filter((a) => a.purchase_currency === c).forEach((a) => add(a.purchased_at ?? a.created_at, "out", a.purchase_cost_minor));
    return months.map((x) => ({ ...x, ...m.get(x.key)! }));
  }, [flow, c, months]);
  const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out]));
  const empty = data.every((d) => !d.in && !d.out);
  return (
    <div className="card">
      <div className="card-head">
        <span className="icon-tile gold"><Icon name="sales" size={16} /></span>
        <h2>Last 6 months</h2>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Chart currency">
          {CURRENCIES.map((x) => <button key={x} className={x === c ? "on" : ""} onClick={() => setC(x)}>{x}</button>)}
        </div>
      </div>
      {empty ? (
        <div className="empty small" style={{ padding: "48px 12px" }}>No {c} transactions in the last six months yet.</div>
      ) : (
        <>
          <div className="chart" style={{ ["--n" as string]: 6 }} role="img" aria-label={`Monthly ${c} sales received and money out`}>
            {data.map((d) => (
              <div className="col" key={d.key} title={`${d.label}: in ${formatMoney(d.in, c)} · out ${formatMoney(d.out, c)}`}>
                <div className="bars">
                  <span className="b in" style={{ height: `${(d.in / max) * 100}%` }} />
                  <span className="b out" style={{ height: `${(d.out / max) * 100}%` }} />
                </div>
                <span className="m">{d.label}</span>
              </div>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: "var(--accent)" }} />Sales received</span>
            <span><i style={{ background: "rgba(255,255,255,0.3)" }} />Purchases, expenses & refunds</span>
          </div>
        </>
      )}
    </div>
  );
}

const ACTION_ICON: [string, IconName][] = [
  ["account", "accounts"], ["link", "link"], ["password", "key"], ["backup_code", "shieldCheck"], ["sale", "sales"], ["refund", "refund"], ["expense", "expenses"],
];
export function humanAction(a: string): string {
  const s = a.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function actionIcon(a: string): IconName {
  return ACTION_ICON.find(([p]) => a.startsWith(p))?.[1] ?? "history";
}

function Activity({ events, titles }: { events: AuditEvent[]; titles: Map<string, string> }) {
  const acc = (e: AuditEvent) => {
    if (e.entity_type === "accounts") return e.entity_id;
    try {
      return (JSON.parse(e.details) as { account_id?: string }).account_id ?? null;
    } catch {
      return null;
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <span className="icon-tile"><Icon name="history" size={16} /></span>
        <h2>Recent activity</h2>
        <span className="spacer" />
        <Link to="/history" className="small">View all</Link>
      </div>
      {!events.length ? (
        <div className="empty small">Changes you make on any device appear here.</div>
      ) : (
        <div className="feed">
          {events.slice(0, 6).map((e) => {
            const id = acc(e);
            return (
              <div className="feed-item" key={e.id}>
                <span className="icon-tile"><Icon name={actionIcon(e.action)} size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{humanAction(e.action)}</div>
                  <div className="s">{id ? titles.get(id) ?? "Deleted account" : e.actor}</div>
                </div>
                <time dateTime={e.at}>{fmtDate(e.at)}</time>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { svc } = useApp();
  const { data, error, loading } = useLoad(async () => {
    const [dash, accounts, events, sales, refunds, expenses] = await Promise.all([
      svc.dashboard(),
      svc.listAccounts(),
      svc.audit().catch(() => [] as AuditEvent[]),
      svc.list("sales"),
      svc.list("refunds"),
      svc.list("expenses"),
    ]);
    return { ...dash, accounts, events, flow: { sales, refunds, expenses, accounts } as Flow };
  }, []);
  if (!data) return <Loading error={error} loading={loading} rows={5} />;
  const { counts, byCurrency } = data.report;
  const s = data.sync;
  const missing = CURRENCIES.reduce((a, c) => a + byCurrency[c].missingRates, 0);
  const titles = new Map(data.accounts.map((a) => [a.id, a.title]));
  const total = Math.max(1, counts.available + counts.reserved + counts.sold + counts.archived);
  const latest = [...data.accounts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <section className="banner">
        <img src={ART.heroMid} alt="" />
        <div>
          <h1>{greet}{svc.username() ? `, ${svc.username()}` : ""}</h1>
          <p>
            {counts.available} account{counts.available === 1 ? "" : "s"} available · {counts.published} live on codexstocks.org.
            USD and PKR are always reported separately.
          </p>
          <div className="row">
            <Link className="btn primary" to="/accounts/new"><Icon name="plus" size={16} /> New account</Link>
            <Link className="btn" to="/accounts"><Icon name="accounts" size={16} /> Inventory</Link>
          </div>
        </div>
        <span className="art-note">Original illustration</span>
      </section>

      <div className="grid grid-4">
        <div className="stat accent"><div className="label"><Icon name="layers" size={15} />Registered accounts</div><div className="value">{counts.total}</div><div className="sub">{counts.archived} archived</div></div>
        <div className="stat"><div className="label"><Icon name="globe" size={15} />Available / live</div><div className="value">{counts.available}</div><div className="sub">{counts.published} published on website</div></div>
        <div className="stat"><div className="label"><Icon name="tag" size={15} />Reserved</div><div className="value">{counts.reserved}</div><div className="sub">Held for a buyer</div></div>
        <div className="stat"><div className="label"><Icon name="check" size={15} />Sold</div><div className="value">{counts.sold}</div><div className="sub">All time</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head" style={{ marginBottom: 12 }}>
          <h2>Inventory mix</h2>
          <span className="spacer" />
          <span className="small faint">{counts.total} accounts</span>
        </div>
        <div className="meter" aria-hidden="true">
          <span style={{ flexGrow: counts.available / total, background: "var(--ok)" }} />
          <span style={{ flexGrow: counts.reserved / total, background: "var(--warn)" }} />
          <span style={{ flexGrow: counts.sold / total, background: "var(--info)" }} />
          <span style={{ flexGrow: counts.archived / total, background: "var(--faint)" }} />
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--ok)" }} />Available {counts.available}</span>
          <span><i style={{ background: "var(--warn)" }} />Reserved {counts.reserved}</span>
          <span><i style={{ background: "var(--info)" }} />Sold {counts.sold}</span>
          <span><i style={{ background: "var(--faint)" }} />Archived {counts.archived}</span>
        </div>
      </div>

      {missing > 0 && (
        <Notice kind="warn" className="mt">
          {missing} sale(s) are in a different currency from the purchase and have no recorded exchange rate, so their cost is not included in profit.
        </Notice>
      )}

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {CURRENCIES.map((c) => <MoneyCard key={c} c={c} r={byCurrency[c]} />)}
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <MonthlyChart flow={data.flow} />
        <SyncCard s={s} />
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Activity events={data.events} titles={titles} />
        <div className="card">
          <div className="card-head">
            <span className="icon-tile"><Icon name="accounts" size={16} /></span>
            <h2>Latest accounts</h2>
            <span className="spacer" />
            <Link to="/accounts" className="small">All accounts</Link>
          </div>
          {!latest.length ? (
            <div className="empty small">No accounts yet. <Link to="/accounts/new">Add your first account</Link>.</div>
          ) : (
            <div className="feed">
              {latest.map((a) => (
                <Link to={`/accounts/${a.id}`} className="feed-item" key={a.id} style={{ color: "inherit", textDecoration: "none" }}>
                  <img src={a.image_url ? `${a.image_url}?tr=w-120,h-120,fo-auto` : fallbackArt(a.id)} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{a.title}</div>
                    <div className="s">{a.status} · {a.list_price_minor !== null && a.list_currency ? formatMoney(a.list_price_minor, a.list_currency) : "no price"}</div>
                  </div>
                  <Icon name="chevronRight" size={16} className="faint" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <details className="card" style={{ marginTop: 16 }}>
        <summary className="card-head" style={{ cursor: "pointer", marginBottom: 0, listStyle: "none" }}>
          <span className="icon-tile"><Icon name="list" size={16} /></span>
          <h2>Detailed profit & cash breakdown</h2>
          <span className="spacer" />
          <Icon name="chevronDown" size={16} className="faint" />
        </summary>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>Profit view</th>{CURRENCIES.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
            <tbody>
              <Row label="Gross sales (incoming)" r={byCurrency} k="grossSales" />
              <Row label="Refunds" r={byCurrency} k="refunds" />
              <Row label="Net sales" r={byCurrency} k="netSales" />
              <Row label="Cost of accounts sold" r={byCurrency} k="costOfSold" hint="Converted with the rate recorded on each sale" />
              <Row label="Gross profit" r={byCurrency} k="grossProfit" />
              <Row label="Expenses" r={byCurrency} k="expenses" />
              <Row label="Net profit" r={byCurrency} k="netProfit" strong />
            </tbody>
          </table>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Cash view</th>{CURRENCIES.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
            <tbody>
              <Row label="Incoming (sales received)" r={byCurrency} k="incoming" />
              <Row label="Purchases (outgoing)" r={byCurrency} k="purchases" />
              <Row label="Total outgoing" r={byCurrency} k="outgoing" hint="Purchases + expenses + refunds" />
              <Row label="Net cash" r={byCurrency} k="netCash" strong />
              <Row label="Unsold inventory at cost" r={byCurrency} k="inventoryValue" hint="Available + reserved accounts" />
            </tbody>
          </table>
        </div>
        <p className="small faint" style={{ marginTop: 12, marginBottom: 0 }}>
          Profit = net sales − cost of accounts sold − expenses. The cash view counts each purchase once when it was bought; the profit
          view counts its cost only when the account is sold.
        </p>
      </details>
    </>
  );
}

function SyncCard({ s }: { s: Awaited<ReturnType<ReturnType<typeof useApp>["svc"]["dashboard"]>>["sync"] }) {
  if (!s) return <div className="card"><div className="empty small">Sync status unavailable.</div></div>;
  const tiles: [string, string | number, IconName, string?][] = s.cloud
    ? [
        ["Open conflicts", s.cloud.open_conflicts, "alert", s.cloud.open_conflicts ? "var(--warn)" : undefined],
        ["Enrolled devices", s.cloud.active_devices, "devices"],
        ["Last device sync", s.cloud.last_device_sync_at ? fmtDate(s.cloud.last_device_sync_at, true) : "Never", "sync"],
      ]
    : [
        ["Waiting to sync", s.pending, "sync", s.pending ? "var(--warn)" : undefined],
        ["Failed / rejected", s.failed + s.rejected, "alert", s.failed + s.rejected ? "var(--bad)" : undefined],
        ["Images queued", `${s.queuedImages}${s.failedImages ? ` · ${s.failedImages} failed` : ""}`, "image", s.failedImages ? "var(--bad)" : undefined],
        ["Conflicts", s.conflicts, "shield", s.conflicts ? "var(--warn)" : undefined],
      ];
  return (
    <div className="card">
      <div className="card-head">
        <span className="icon-tile"><Icon name="sync" size={16} /></span>
        <h2>{s.cloud ? "Cloud sync" : "Sync & uploads"}</h2>
        <span className="spacer" />
        <Link to="/sync" className="small">Details</Link>
      </div>
      <div className="feed">
        {tiles.map(([k, v, icon, color]) => (
          <div className="feed-item" key={k} style={{ gridTemplateColumns: "32px 1fr auto" }}>
            <span className="icon-tile"><Icon name={icon} size={15} /></span>
            <span className="muted">{k}</span>
            <b style={{ color, fontVariantNumeric: "tabular-nums" }}>{v}</b>
          </div>
        ))}
      </div>
      {s.cloud ? (
        <p className="small faint" style={{ margin: "10px 0 0" }}>Pending, failed and image queues live on each PC (offline work).</p>
      ) : (
        <p className="small faint" style={{ margin: "10px 0 0" }}>Last sync: {s.lastSyncAt ? fmtDate(s.lastSyncAt, true) : "never"}</p>
      )}
    </div>
  );
}
