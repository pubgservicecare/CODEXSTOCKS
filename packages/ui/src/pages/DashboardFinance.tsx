import { useMemo } from "react";
import { Link } from "react-router-dom";
import { computeConsolidated, financeSummary, formatUsdtPkr, pkrToUsdt, type ConsolidationInput } from "@codex/shared";
import { Icon } from "../icons";
import { useFx } from "../fx-ui";
import { AmountList, fmt } from "../finance-ui";

function UsdtLine({ pkr }: { pkr: number }) {
  const { usdt } = useFx();
  if (!usdt) return <span className="faint">USDT equivalent unavailable — no USDT rate yet (set your own in Settings).</span>;
  return (
    <span title={`${formatUsdtPkr(usdt.usdt_pkr_micro)} · ${usdt.manual ? "your rate" : usdt.source}`}>
      ≈ {fmt(pkrToUsdt(pkr, usdt.usdt_pkr_micro), "USDT")}
    </span>
  );
}

export function UsdtRateNote() {
  const { usdt } = useFx();
  if (!usdt) return null;
  return (
    <span className="fx-line">
      {formatUsdtPkr(usdt.usdt_pkr_micro)} · {usdt.manual ? `your rate (${new Date(usdt.effective_at ?? usdt.retrieved_at).toLocaleDateString()})` : <>Powered by CoinGecko · {new Date(usdt.effective_at ?? usdt.retrieved_at).toLocaleString()}</>}
      {usdt.status === "stale" && <b className="fx-stale"> · {usdt.manual ? "update your rate" : "stale"}</b>}
    </span>
  );
}

/**
 * ONE net profit for the whole business, in PKR (each transaction at the rate recorded with it), with its
 * actual-USDT equivalent underneath. The two lines are the same profit in two currencies — never added.
 */
export function NetProfitCard({ flow }: { flow: ConsolidationInput }) {
  const r = useMemo(() => computeConsolidated(flow), [flow]);
  const left = r.excluded.sales + r.excluded.refunds + r.excluded.costs + r.excluded.purchases + r.excluded.expenses + r.excluded.payments;
  const rows: [string, number, string?][] = [
    ["Net sales", r.netSales, "Instant Pay and installment sales, each counted once"],
    ["Cost of accounts sold", -r.costOfSold],
    ["Expenses", -r.expenses],
  ];
  if (r.planExtras) rows.push(["Daily Extra collected", r.planExtras]);
  if (r.planFines) rows.push(["Late fines collected", r.planFines]);
  if (r.planWriteOffs) rows.push(["Cancelled plans written off", -r.planWriteOffs]);
  if (r.debtChargesIn) rows.push(["Charges received (money to receive)", r.debtChargesIn]);
  if (r.debtChargesOut) rows.push(["Charges paid (money to pay)", -r.debtChargesOut]);
  return (
    <div className="card money-card net-profit" data-testid="net-profit">
      <div className="card-head">
        <span className="icon-tile gold"><Icon name="sales" size={16} /></span>
        <h2>Net profit</h2>
        <span className="spacer" />
        <span className="small faint">All sales, costs and expenses · PKR at each transaction's recorded rate</span>
      </div>
      <div className={`figure ${r.netProfit < 0 ? "neg" : ""}`}>{fmt(r.netProfit, "PKR")}</div>
      <div className="figure-sub"><UsdtLine pkr={r.netProfit} /></div>
      <div className="money-rows">
        {rows.map(([k, v, hint]) => (
          <div className="money-row" key={k} title={hint}>
            <span className="k">{k}</span>
            <span className={`v ${v < 0 ? "neg" : ""}`}>{v < 0 ? "−" : ""}{fmt(Math.abs(v), "PKR")}</span>
          </div>
        ))}
      </div>
      <p className="small faint" style={{ margin: "10px 0 0" }}>
        Collecting an advance, qist or money owed to you is not counted again as profit. <UsdtRateNote />
      </p>
      {left > 0 && <p className="small" style={{ margin: "6px 0 0", color: "var(--warn)" }}>{left} record(s) in USD/USDT without a saved rate are not included.</p>}
    </div>
  );
}

/** The money-owed / installment summary, kept compact. */
export function FinanceTiles({ flow }: { flow: ConsolidationInput }) {
  const s = useMemo(() => financeSummary({ plans: flow.plans ?? [], payments: flow.payments ?? [], debts: flow.debts ?? [] }), [flow]);
  const tiles: [string, React.ReactNode, React.ReactNode, string?, string?][] = [
    ["Money owed to you", <AmountList amounts={s.owedToMe} empty="Nothing" />, "plans + money to receive", "/payments/receive"],
    ["Money you owe", <AmountList amounts={s.iOwe} empty="Nothing" />, "money to pay", "/payments/pay"],
    ["Overdue", s.overdue.count ? <AmountList amounts={s.overdue.amounts} /> : "None", `${s.overdue.count} installment(s)`, "/payments", s.overdue.count ? "bad" : undefined],
    ["Due in 7 days", s.upcoming.count ? <AmountList amounts={s.upcoming.amounts} /> : "None", `${s.upcoming.count} installment(s)`, "/payments"],
    ["Received today", <AmountList amounts={s.receivedToday.amounts} empty="0" />, <>this month <AmountList amounts={s.receivedMonth.amounts} empty="0" total={false} /></>, "/payments/history"],
    ["Installment balances", <AmountList amounts={s.planOutstanding} empty="0" />, `${s.activePlans} active plan(s)`, "/payments/plans"],
    ["Daily Extra", <AmountList amounts={s.extraCollected} empty="0" />, <>collected · expected <AmountList amounts={s.extraExpected} empty="0" total={false} /></>, "/payments/plans"],
    ["Late fines", <AmountList amounts={s.finesOutstanding} empty="0" />, <>outstanding · collected <AmountList amounts={s.finesCollected} empty="0" total={false} /></>, "/payments/plans"],
  ];
  return (
    <div className="fin-tiles" data-testid="finance-tiles">
      {tiles.map(([label, value, sub, to, tone]) => (
        <Link key={label} to={to ?? "/payments"} className={`fin-tile ${tone ? `tone-${tone}` : ""}`}>
          <span className="label">{label}</span>
          <span className="value">{value}</span>
          <span className="sub">{sub}</span>
        </Link>
      ))}
    </div>
  );
}
