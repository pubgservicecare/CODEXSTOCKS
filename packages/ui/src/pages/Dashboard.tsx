import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  computeConsolidated,
  consolidatedMonthlyFlow,
  convertUsdPkr,
  CURRENCIES,
  displayFlow,
  formatMoney,
  type AuditEvent,
  type Currency,
  type CurrencyReport,
  type DisplayBucket,
  type Expense,
  type Refund,
  type Sale,
} from "@codex/shared";
import { FxRateLine, useFx } from "../fx-ui";
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

interface Flow {
  sales: Sale[];
  refunds: Refund[];
  expenses: Expense[];
  accounts: AccountListItem[];
}

export function lastMonths(n = 6, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1) + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short" }) };
  });
}

/** One chart of the shared series. Bar heights come from the canonical PKR series, so both charts match exactly. */
function FlowChart({ title, sub, currency, rows, heights }: { title: string; sub: string; currency: Currency; rows: DisplayBucket[]; heights: { in: number; out: number }[] }) {
  const months = lastMonths(rows.length);
  return (
    <div className="flow-chart" data-testid={`flow-${currency}`}>
      <div className="flow-head">
        <span className="ccy">{currency}</span>
        <b>{title}</b>
        <span className="small faint">{sub}</span>
      </div>
      <div className="chart" style={{ ["--n" as string]: rows.length }} role="img" aria-label={`${title}: monthly money in and out`}>
        {rows.map((d, i) => (
          <div className="col" key={d.key} title={`${months[i].label}: in ${formatMoney(d.in, currency)} · out ${formatMoney(d.out, currency)}`}>
            <div className="bars">
              <span className="b in" style={{ height: `${heights[i].in}%` }} />
              <span className="b out" style={{ height: `${heights[i].out}%` }} />
            </div>
            <span className="m">{months[i].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Last six months, ALL currencies together. Every transaction is converted into PKR with the rate
 * recorded on it (one shared series); the PKR and USD charts are both drawn from that series, the USD one
 * scaled by ONE display rate for the whole period — so they always rise and fall together.
 */
function MonthlyChart({ flow }: { flow: Flow }) {
  const { quote } = useFx();
  const months = useMemo(() => lastMonths(6), []);
  const { buckets, excluded } = useMemo(() => consolidatedMonthlyFlow(flow, months.map((m) => m.key)), [flow, months]);
  const pkr = displayFlow(buckets, "PKR", null)!;
  const usd = displayFlow(buckets, "USD", quote?.usd_pkr_micro ?? null);
  const max = Math.max(1, ...buckets.flatMap((b) => [b.in, b.out]));
  const heights = buckets.map((b) => ({ in: (b.in / max) * 100, out: (b.out / max) * 100 }));
  const empty = buckets.every((d) => !d.in && !d.out);
  const left = excluded.sales + excluded.refunds + excluded.purchases + excluded.expenses;
  return (
    <div className="card">
      <div className="card-head">
        <span className="icon-tile gold"><Icon name="sales" size={16} /></span>
        <h2>Last 6 months · all currencies</h2>
      </div>
      {empty ? (
        <div className="empty small" style={{ padding: "48px 12px" }}>No transactions in the last six months yet.</div>
      ) : (
        <>
          <div className="flow-pair">
            <FlowChart title="PKR equivalent" sub="at each transaction's recorded rate" currency="PKR" rows={pkr} heights={heights} />
            {usd ? (
              <FlowChart title="USD equivalent" sub="at the current reference rate" currency="USD" rows={usd} heights={heights} />
            ) : (
              <div className="flow-chart empty small">No USD/PKR reference rate available, so the USD view cannot be shown.</div>
            )}
          </div>
          <div className="legend">
            <span><i style={{ background: "var(--accent)" }} />Sales received</span>
            <span><i style={{ background: "rgba(255,255,255,0.3)" }} />Purchases, expenses & refunds</span>
          </div>
          <p className="small faint" style={{ margin: "10px 0 0" }}>
            Both charts show the same transactions. USD amounts are first converted to PKR at the rate saved with each transaction; the USD chart
            then uses one rate for the whole period{quote ? <> (<FxRateLine quote={quote} />)</> : null}, so it is an equivalent, not the amounts actually paid in USD.
          </p>
          {left > 0 && (
            <p className="small" style={{ margin: "6px 0 0", color: "var(--warn)" }}>
              {left} USD record(s) have no saved exchange rate and are not included in these charts (see the native USD figures above).
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Combined books in PKR (each transaction at its recorded rate), with a USD equivalent at the display rate. */
function ConsolidatedCard({ flow }: { flow: Flow }) {
  const { quote } = useFx();
  const r = useMemo(() => computeConsolidated(flow), [flow]);
  const usd = (v: number) => (quote ? formatMoney(convertUsdPkr(v, "PKR", "USD", quote.usd_pkr_micro), "USD") : "—");
  const left = r.excluded.sales + r.excluded.refunds + r.excluded.costs + r.excluded.purchases + r.excluded.expenses;
  const rows: [string, number][] = [
    ["Incoming · sales received", r.incoming],
    ["Outgoing · purchases, expenses, refunds", r.outgoing],
    ["Net cash", r.netCash],
    ["Unsold inventory at cost", r.inventoryValue],
  ];
  return (
    <div className="card money-card" data-testid="consolidated">
      <div className="card-head">
        <span className="ccy">ALL</span>
        <h2>Combined net profit</h2>
        <span className="spacer" />
        <span className="small faint">PKR and USD together, each at its recorded rate</span>
      </div>
      <div className={`figure ${r.netProfit < 0 ? "neg" : ""}`}>{formatMoney(r.netProfit, "PKR")}</div>
      <div className="small faint" style={{ marginTop: -6 }}>≈ {usd(r.netProfit)} at the current reference rate</div>
      <div className="money-rows">
        {rows.map(([k, v]) => (
          <div className="money-row" key={k}><span className="k">{k}</span><span className="v">{formatMoney(v, "PKR")} <span className="faint small">≈ {usd(v)}</span></span></div>
        ))}
      </div>
      {left > 0 && <p className="small" style={{ margin: "10px 0 0", color: "var(--warn)" }}>{left} USD record(s) without a saved exchange rate are not included.</p>}
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
            Native PKR and USD books stay separate; the combined view converts each transaction at its recorded rate.
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

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {CURRENCIES.map((c) => <MoneyCard key={c} c={c} r={byCurrency[c]} />)}
        <ConsolidatedCard flow={data.flow} />
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
          <table className="keep-table">
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
          <table className="keep-table">
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
