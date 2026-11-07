"use client";

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { computeConsolidated, convertUsdPkr, CURRENCIES, formatMoney, formatUsdtPkr, pkrToUsdt, receiptMoney } from "@codex/shared";
import {
  Activity,
  FinanceTiles,
  Icon,
  Loading,
  MonthlyChart,
  NetProfitCard,
  Notice,
  Row,
  SyncCard,
  useApp,
  useDashboardData,
  useFx,
} from "@codex/ui";
import { BACKDROPS, cardArt } from "../(store)/art";

type Data = NonNullable<ReturnType<typeof useDashboardData>["data"]>;

/**
 * The admin website's dashboard: the same data, reports and charts as the desktop dashboard (shared components and
 * the same consolidated series), arranged as a command view for the web. Figures are never hard-coded.
 */
export function WebDashboard() {
  const { data, error, loading } = useDashboardData();
  if (!data) return <Loading error={error} loading={loading} rows={5} />;
  return <Board data={data} />;
}

function Board({ data }: { data: Data }) {
  const { svc } = useApp();
  const { quote, usdt } = useFx();
  const combined = useMemo(() => computeConsolidated(data.flow), [data.flow]);
  const { counts, byCurrency } = data.report;
  const missing = CURRENCIES.reduce((a, c) => a + byCurrency[c].missingRates, 0);
  const titles = new Map(data.accounts.map((a) => [a.id, a.title]));
  const total = Math.max(1, counts.available + counts.reserved + counts.sold + counts.archived);
  const latest = [...data.accounts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const usd = (v: number) => (quote ? formatMoney(convertUsdPkr(v, "PKR", "USD", quote.usd_pkr_micro), "USD") : null);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const tiles: { k: string; v: string | number; sub: string; icon: "globe" | "tag" | "check" | "layers"; tone: string; share?: number }[] = [
    { k: "Available", v: counts.available, sub: `${counts.published} live on codexstocks.org`, icon: "globe", tone: "ok", share: counts.available / total },
    { k: "Reserved", v: counts.reserved, sub: "Held for a buyer", icon: "tag", tone: "warn", share: counts.reserved / total },
    { k: "Sold", v: counts.sold, sub: "All time", icon: "check", tone: "info", share: counts.sold / total },
    { k: "Stock at cost", v: formatMoney(combined.inventoryValue, "PKR"), sub: usd(combined.inventoryValue) ? `≈ ${usd(combined.inventoryValue)}` : "PKR equivalent", icon: "layers", tone: "red" },
  ];

  return (
    <div className="wd">
      <section className="wd-hero">
        <img className="wd-hero-art" src={BACKDROPS.lineup} alt="" />
        <div className="wd-hero-copy">
          <p className="wd-kicker">Operations · {today}</p>
          <h1>
            {greet}
            {svc.username() ? <span>, {svc.username()}</span> : null}
          </h1>
          <p className="wd-lede">
            {counts.total} account{counts.total === 1 ? "" : "s"} registered · {counts.available} available · {counts.published} live on the storefront.
          </p>
          <div className="wd-actions">
            <Link className="btn primary" to="/accounts/new"><Icon name="plus" size={16} /> New account</Link>
            <Link className="btn" to="/accounts"><Icon name="accounts" size={16} /> Inventory</Link>
            <Link className="btn ghost" to="/payments"><Icon name="wallet" size={16} /> Payments</Link>
          </div>
        </div>
        <div className="wd-profit" data-testid="web-combined-profit">
          <span className="wd-profit-k">Net profit</span>
          <b className={combined.netProfit < 0 ? "neg" : undefined}>{receiptMoney(combined.netProfit, "PKR")}</b>
          <span className="wd-profit-usd">{usdt ? `≈ ${receiptMoney(pkrToUsdt(combined.netProfit, usdt.usdt_pkr_micro), "USDT")}` : "USDT equivalent unavailable (no USDT rate yet)"}</span>
          <span className="wd-profit-note">
            One profit for every sale, cost and expense — the PKR figure and its USDT equivalent, never added together.
            {usdt ? <> {formatUsdtPkr(usdt.usdt_pkr_micro)} · {usdt.manual ? "your rate" : "Powered by CoinGecko"}</> : null}
          </span>
        </div>
        <span className="art-note">Illustrative artwork</span>
      </section>

      <div className="wd-kpis">
        {tiles.map((t, i) => (
          <div className={`wd-kpi tone-${t.tone}`} key={t.k} style={{ ["--i" as string]: i }}>
            <span className="wd-kpi-k"><Icon name={t.icon} size={15} /> {t.k}</span>
            <b>{t.v}</b>
            <span className="wd-kpi-sub">{t.sub}</span>
            {t.share !== undefined && <span className="wd-kpi-bar"><i style={{ width: `${Math.round(t.share * 100)}%` }} /></span>}
          </div>
        ))}
      </div>

      {missing > 0 && (
        <Notice kind="warn" className="mt">
          {missing} sale(s) are in a different currency from the purchase and have no recorded exchange rate, so their cost is not included in profit.
        </Notice>
      )}

      <div className="wd-flow">
        <MonthlyChart flow={data.flow} />
        <div className="wd-native">
          <FinanceTiles flow={data.flow} />
        </div>
      </div>

      <div className="wd-trio">
        <NetProfitCard flow={data.flow} />
        <div className="card">
          <div className="card-head">
            <span className="icon-tile gold"><Icon name="layers" size={16} /></span>
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
        <SyncCard s={data.sync} />
      </div>

      <div className="wd-bottom">
        <div className="card wd-latest">
          <div className="card-head">
            <span className="icon-tile"><Icon name="accounts" size={16} /></span>
            <h2>Latest accounts</h2>
            <span className="spacer" />
            <Link to="/accounts" className="small">All accounts</Link>
          </div>
          {!latest.length ? (
            <div className="empty small">No accounts yet. <Link to="/accounts/new">Add your first account</Link>.</div>
          ) : (
            <div className="wd-tiles">
              {latest.map((a) => (
                <Link to={`/accounts/${a.id}`} className="wd-tile" key={a.id}>
                  <img src={a.image_url ? `${a.image_url}?tr=w-480,h-300,fo-auto` : cardArt(a.id)} alt="" className={a.image_url ? undefined : "is-art"} />
                  <span className="wd-tile-body">
                    <b>{a.title}</b>
                    <small>
                      <span className={`dot ${a.status === "available" ? "ok" : a.status === "reserved" ? "warn" : a.status === "sold" ? "info" : ""}`} />
                      {a.status} · {a.list_price_minor !== null && a.list_currency ? formatMoney(a.list_price_minor, a.list_currency) : "no price"}
                    </small>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <Activity events={data.events} titles={titles} />
      </div>

      <details className="card wd-breakdown">
        <summary className="card-head">
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
          Profit = net sales − cost of accounts sold − expenses. The cash view counts each purchase once when it was bought; the profit view counts
          its cost only when the account is sold.
        </p>
      </details>
    </div>
  );
}
