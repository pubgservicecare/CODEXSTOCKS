import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  financeSummary,
  installmentLabel,
  PAY_METHOD_LABELS,
  planStatusLabel,
  type Amounts,
  type Debt,
  type PayCurrency,
  type PayMethod,
  type Payment,
  type Receipt,
} from "@codex/shared";
import { EmptyState, Loading, useApp, useLoad } from "../components";
import { Icon } from "../icons";
import { AmountList, day, DebtBadge, EntryBadge, fmt, PlanStatusBadge, Stat, useFinanceData } from "../finance-ui";
import { DebtDetail, DebtDialog } from "./Debts";
import { ReceiptView } from "../receipts/ReceiptView";

type Tab = "overview" | "plans" | "history" | "receive" | "pay" | "receipts";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["plans", "Installment plans"],
  ["history", "Payment history"],
  ["receive", "Money to receive"],
  ["pay", "Money to pay"],
  ["receipts", "Receipts"],
];

const lower = (s: string | null | undefined) => (s ?? "").toLowerCase();

export function PaymentsPage() {
  const { tab: raw } = useParams();
  const tab = (TABS.some(([k]) => k === raw) ? raw : "overview") as Tab;
  const nav = useNavigate();
  const { data, error, loading } = useFinanceData();
  const summary = useMemo(() => (data ? financeSummary({ plans: data.plans, payments: data.payments, debts: data.debts }) : null), [data]);
  const [newDebt, setNewDebt] = useState<"receive" | "pay" | null>(null);

  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Payments</h1>
          <p>Installment plans, money you receive and pay, and receipts. Collecting a plan's advance or qist is not new profit — the sale was counted once when it was made.</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setNewDebt("receive")}><Icon name="arrowDown" size={15} /> Money to receive</button>
        <button className="btn" onClick={() => setNewDebt("pay")}><Icon name="arrowUp" size={15} /> Money to pay</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Payments sections">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => nav(k === "overview" ? "/payments" : `/payments/${k}`)}>
            {label}
            {k === "plans" && summary ? <span className="n">{summary.activePlans}</span> : null}
            {k === "overview" && summary?.overdue.count ? <span className="n bad-n">{summary.overdue.count}</span> : null}
          </button>
        ))}
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && summary && (
        <>
          {tab === "overview" && <Overview s={summary} />}
          {tab === "plans" && <Plans s={summary} />}
          {tab === "history" && <History payments={data.payments} s={summary} />}
          {(tab === "receive" || tab === "pay") && <Debts direction={tab} s={summary} onNew={() => setNewDebt(tab)} />}
          {tab === "receipts" && <Receipts s={summary} payments={data.payments} />}
        </>
      )}
      {newDebt && <DebtDialog direction={newDebt} onClose={() => setNewDebt(null)} onSaved={() => nav(`/payments/${newDebt}`)} />}
    </>
  );
}

type Summary = ReturnType<typeof financeSummary>;

function Overview({ s }: { s: Summary }) {
  const plan = (id: string) => `/payments/plans/${id}`;
  return (
    <>
      <div className="grid grid-4 fin-grid">
        <Stat icon={<Icon name="arrowDown" size={15} />} label="Money owed to you" value={<AmountList amounts={s.owedToMe} empty="Nothing" />} sub="Unpaid plan balances + money to receive" />
        <Stat icon={<Icon name="arrowUp" size={15} />} label="Money you owe" value={<AmountList amounts={s.iOwe} empty="Nothing" />} sub="Money to pay" />
        <Stat icon={<Icon name="alert" size={15} />} tone={s.overdue.count ? "bad" : undefined} label="Overdue" value={s.overdue.count ? <AmountList amounts={s.overdue.amounts} /> : "None"} sub={`${s.overdue.count} installment${s.overdue.count === 1 ? "" : "s"} incl. late fines`} />
        <Stat icon={<Icon name="calendar" size={15} />} label="Due in the next 7 days" value={s.upcoming.count ? <AmountList amounts={s.upcoming.amounts} /> : "None"} sub={`${s.upcoming.count} installment${s.upcoming.count === 1 ? "" : "s"}`} />
      </div>
      <div className="grid grid-4 fin-grid" style={{ marginTop: 12 }}>
        <Stat label="Received today" value={<AmountList amounts={s.receivedToday.amounts} empty="0" />} sub={`${s.receivedToday.count} payment${s.receivedToday.count === 1 ? "" : "s"}`} />
        <Stat label="Received this month" value={<AmountList amounts={s.receivedMonth.amounts} empty="0" />} sub={<>{s.receivedMonth.count} payment{s.receivedMonth.count === 1 ? "" : "s"} · paid out <AmountList amounts={s.paidOutMonth.amounts} empty="0" total={false} /></>} />
        <Stat label="Daily Extra" value={<AmountList amounts={s.extraCollected} empty="0" />} sub={<>collected · expected <AmountList amounts={s.extraExpected} empty="0" total={false} /></>} />
        <Stat label="Late fines" value={<AmountList amounts={s.finesCollected} empty="0" />} sub={<>collected · outstanding <AmountList amounts={s.finesOutstanding} empty="0" total={false} /></>} />
      </div>
      <div className="split" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <span className="icon-tile"><Icon name="alert" size={16} /></span>
            <h2>Overdue installments</h2>
            <span className="spacer" />
            <span className="small faint">{s.activePlans} active plan{s.activePlans === 1 ? "" : "s"}</span>
          </div>
          {!s.overdue.items.length ? (
            <div className="empty small">Nothing is overdue.</div>
          ) : (
            <div className="feed">
              {s.overdue.items.slice(0, 8).map((x) => (
                <Link key={`${x.plan.id}-${x.entry.n}`} to={plan(x.plan.id)} className="feed-item" style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="icon-tile" style={{ color: "var(--bad)" }}><Icon name="calendar" size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{x.plan.customer_name} · {x.entry.n === 0 ? "Advance" : installmentLabel(x.plan.interval_days, x.entry.n)}</div>
                    <div className="s">{x.plan.account_title} · due {day(x.entry.due_on)}{x.entry.fine ? ` · fine ${fmt(x.entry.fine_remaining, x.plan.currency)}` : ""}</div>
                  </div>
                  <b className="num">{fmt(x.amount, x.plan.currency)}</b>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <span className="icon-tile"><Icon name="calendar" size={16} /></span>
            <h2>Coming up</h2>
            <span className="spacer" />
            <Link to="/payments/plans" className="small">All plans</Link>
          </div>
          {!s.upcoming.items.length ? (
            <div className="empty small">No installments due in the next 7 days.</div>
          ) : (
            <div className="feed">
              {s.upcoming.items.slice(0, 8).map((x) => (
                <Link key={`${x.plan.id}-${x.entry.n}`} to={plan(x.plan.id)} className="feed-item" style={{ color: "inherit", textDecoration: "none" }}>
                  <span className="icon-tile"><Icon name="calendar" size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{x.plan.customer_name} · {x.entry.n === 0 ? "Advance" : installmentLabel(x.plan.interval_days, x.entry.n)}</div>
                    <div className="s">{x.plan.account_title} · {day(x.entry.due_on)}</div>
                  </div>
                  <b className="num">{fmt(x.amount, x.plan.currency)}</b>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      {Object.values(s.customerCredit).some(Boolean) && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Customer credit (overpayments held for customers, not income): <AmountList amounts={s.customerCredit} />
        </p>
      )}
    </>
  );
}

function Filters({ q, setQ, cur, setCur, st, setSt, statuses, from, setFrom, to, setTo }: {
  q: string; setQ: (v: string) => void; cur: string; setCur: (v: string) => void; st: string; setSt: (v: string) => void; statuses: [string, string][];
  from?: string; setFrom?: (v: string) => void; to?: string; setTo?: (v: string) => void;
}) {
  return (
    <div className="toolbar fin-filters">
      <div className="search">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, account, receipt…" aria-label="Search" />
      </div>
      <select value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Currency"><option value="all">All currencies</option><option>PKR</option><option>USD</option><option>USDT</option></select>
      <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status">{statuses.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {setFrom && <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From" />}
      {setTo && <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To" />}
    </div>
  );
}

function Plans({ s }: { s: Summary }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState("all");
  const [st, setSt] = useState("all");
  const rows = s.plans
    .map((r) => ({ ...r, label: planStatusLabel(r.plan, r.state) }))
    .filter((r) => (cur === "all" || r.plan.currency === cur) && (st === "all" || r.label === st))
    .filter((r) => !q || [r.plan.customer_name, r.plan.account_title, r.plan.customer_phone, r.plan.customer_whatsapp, r.plan.agreement_ref].some((x) => lower(x).includes(q.toLowerCase())))
    .sort((a, b) => (a.state.next?.due_on ?? "9999").localeCompare(b.state.next?.due_on ?? "9999"));
  return (
    <>
      <Filters q={q} setQ={setQ} cur={cur} setCur={setCur} st={st} setSt={setSt} statuses={[["all", "All statuses"], ["Active", "Active"], ["Overdue", "Overdue"], ["Paid", "Paid"], ["Restructured", "Restructured"], ["Cancelled", "Cancelled"]]} />
      <div className="table-wrap">
        <table className="fin-table">
          <thead>
            <tr><th>Customer</th><th>Account</th><th className="num">Original price</th><th className="num">Advance</th><th className="num">Installments</th><th className="num">Total scheduled</th><th className="num">Collected</th><th className="num">Remaining</th><th>Next due</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map(({ plan, state, label }) => {
              const c = plan.currency;
              const paidCount = state.entries.slice(1).filter((e) => e.status === "paid").length;
              return (
                <tr key={plan.id} className="clickable" onClick={() => nav(`/payments/plans/${plan.id}`)}>
                  <td><Link to={`/payments/plans/${plan.id}`} onClick={(e) => e.stopPropagation()}><b>{plan.customer_name}</b></Link><div className="small faint">{plan.customer_whatsapp ?? plan.customer_phone ?? ""}</div></td>
                  <td className="small">{plan.account_title}</td>
                  <td className="num">{fmt(plan.original_minor, c)}</td>
                  <td className="num">{plan.advance_minor ? <>{fmt(plan.advance_minor, c)} {state.advance_paid ? <Icon name="check" size={13} style={{ color: "var(--ok)" }} /> : <span className="badge warn">pending</span>}</> : <span className="faint">—</span>}</td>
                  <td className="num">{paidCount}/{state.entries.length - 1}</td>
                  <td className="num">{fmt(state.totals.grand_total, c)}</td>
                  <td className="num">{fmt(state.totals.collected, c)}</td>
                  <td className="num"><b>{fmt(state.totals.remaining_total, c)}</b></td>
                  <td className="small">{state.next ? <>{day(state.next.due_on)} <EntryBadge status={state.next.status} /></> : <span className="faint">—</span>}</td>
                  <td><PlanStatusBadge label={label} /></td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={10}><EmptyState icon="calendar" title="No installment plans" body="Choose Mark as Sold → Installments on an account to create a plan." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = { advance: "Advance", installment: "Installment", settlement: "Settlement", receive: "Money received", pay: "Money paid" };

function History({ payments, s }: { payments: Payment[]; s: Summary }) {
  const { svc } = useApp();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState("all");
  const [st, setSt] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<Payment | null>(null);
  const plans = new Map(s.plans.map((p) => [p.plan.id, p.plan]));
  const debts = new Map(s.debts.map((d) => [d.debt.id, d.debt]));
  const rows = payments
    .filter((p) => !p.deleted)
    .filter((p) => (cur === "all" || p.currency === cur) && (st === "all" || (st === "reversed" ? p.status === "reversed" : st === "plan" ? p.target === "plan" : p.kind === st)))
    .filter((p) => (!from || p.paid_on >= from) && (!to || p.paid_on <= to))
    .filter((p) => {
      if (!q) return true;
      const pl = p.plan_id ? plans.get(p.plan_id) : null;
      const d = p.debt_id ? debts.get(p.debt_id) : null;
      return [p.receipt_no, p.reference, pl?.customer_name, pl?.account_title, d?.party_name, d?.description].some((x) => lower(x).includes(q.toLowerCase()));
    })
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
  const { data: receipt } = useLoad(async () => (open?.plan_id ? (await svc.list("receipts", { payment_id: open.id }))[0] ?? null : null), [open?.id]);
  return (
    <>
      <Filters q={q} setQ={setQ} cur={cur} setCur={setCur} st={st} setSt={setSt} from={from} setFrom={setFrom} to={to} setTo={setTo}
        statuses={[["all", "All payments"], ["plan", "Installment plans"], ["receive", "Money received"], ["pay", "Money paid"], ["reversed", "Reversed"]]} />
      <div className="table-wrap">
        <table className="fin-table">
          <thead><tr><th>Date</th><th>Receipt</th><th>From / to</th><th>For</th><th>Type</th><th className="num">Amount</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const pl = p.plan_id ? plans.get(p.plan_id) : null;
              const d = p.debt_id ? debts.get(p.debt_id) : null;
              return (
                <tr key={p.id} className={`clickable ${p.status === "reversed" ? "reversed" : ""}`} onClick={() => setOpen(p)}>
                  <td className="small">{day(p.paid_on)}</td>
                  <td className="mono small">{p.receipt_no}</td>
                  <td>{pl ? pl.customer_name : d ? d.party_name : "—"}</td>
                  <td className="small">{pl ? pl.account_title : d ? d.description || (d.direction === "receive" ? "Money to receive" : "Money to pay") : "—"}</td>
                  <td className="small">{KIND_LABEL[p.kind] ?? p.kind}{p.installment_no ? ` · #${p.installment_no}` : ""}</td>
                  <td className="num"><b>{fmt(p.amount_minor, p.currency as PayCurrency)}</b>{p.rate_micro ? <div className="small faint">credited {fmt(p.credited_minor, (pl?.currency ?? d?.currency ?? p.currency) as PayCurrency)}</div> : null}</td>
                  <td className="small">{PAY_METHOD_LABELS[p.method as PayMethod] ?? p.method}</td>
                  <td>{p.status === "reversed" ? <span className="badge bad">Reversed</span> : <span className="badge ok">Recorded</span>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8}><EmptyState icon="wallet" title="No payments" body="Payments you record for plans and for money to receive or pay appear here." /></td></tr>}
          </tbody>
        </table>
      </div>
      {open && open.plan_id && receipt && <ReceiptView receipt={receipt} reversed={open.status === "reversed"} onClose={() => setOpen(null)} />}
      {open && open.debt_id && debts.get(open.debt_id) && <DebtDetail debt={debts.get(open.debt_id)!} onClose={() => setOpen(null)} />}
    </>
  );
}

function Debts({ direction, s, onNew }: { direction: "receive" | "pay"; s: Summary; onNew: () => void }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState("all");
  const [st, setSt] = useState("active");
  const [open, setOpen] = useState<Debt | null>(null);
  const list = s.debts.filter((x) => x.debt.direction === direction);
  const rows = list
    .filter((x) => (cur === "all" || x.debt.currency === cur) && (st === "all" || (st === "active" ? x.state.status !== "settled" && x.state.status !== "cancelled" : x.state.status === st)))
    .filter((x) => !q || [x.debt.party_name, x.debt.description, x.debt.party_contact].some((v) => lower(v).includes(q.toLowerCase())))
    .sort((a, b) => (a.debt.due_on ?? "9999").localeCompare(b.debt.due_on ?? "9999"));
  const total: Amounts = {};
  for (const x of list) if (x.state.status !== "cancelled") total[x.debt.currency] = (total[x.debt.currency] ?? 0) + x.state.remaining;
  const receive = direction === "receive";
  return (
    <>
      <div className="grid grid-3 fin-grid" style={{ marginBottom: 14 }}>
        <Stat label={receive ? "Still to receive" : "Still to pay"} value={<AmountList amounts={total} empty="Nothing" />} sub={`${list.filter((x) => x.state.status !== "settled" && x.state.status !== "cancelled").length} open record(s)`} />
        <Stat label="Overdue" tone={list.some((x) => x.state.status === "overdue") ? "bad" : undefined} value={String(list.filter((x) => x.state.status === "overdue").length)} sub="past their due date" />
        <Stat label="Settled" value={String(list.filter((x) => x.state.status === "settled").length)} sub="fully received / paid" />
      </div>
      <div className="toolbar">
        <Filters q={q} setQ={setQ} cur={cur} setCur={setCur} st={st} setSt={setSt} statuses={[["active", "Open & part paid"], ["all", "All"], ["overdue", "Overdue"], ["settled", "Settled"], ["cancelled", "Cancelled"]]} />
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}><Icon name="plus" size={15} /> {receive ? "Money to receive" : "Money to pay"}</button>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>
        {receive
          ? "Personal or business money owed to you (not account sales). Getting the amount back is not profit; only interest or service charges are."
          : "Personal or business money you owe. Paying it back is not an expense; only interest or service charges are."}
      </p>
      <div className="table-wrap">
        <table className="fin-table">
          <thead><tr><th>{receive ? "From" : "To"}</th><th>Reason</th><th className="num">Amount</th><th>Date</th><th>Due</th><th className="num">{receive ? "Received" : "Paid"}</th><th className="num">Remaining</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(({ debt, state }) => (
              <tr key={debt.id} className="clickable" onClick={() => setOpen(debt)}>
                <td><b>{debt.party_name}</b>{debt.party_contact && <div className="small faint">{debt.party_contact}</div>}</td>
                <td className="small">{debt.description || "—"}</td>
                <td className="num">{fmt(state.owed, debt.currency)}{state.charges ? <div className="small faint">incl. charges {fmt(state.charges, debt.currency)}</div> : null}</td>
                <td className="small">{day(debt.txn_on)}</td>
                <td className="small">{debt.due_on ? day(debt.due_on) : "—"}</td>
                <td className="num">{fmt(state.paid, debt.currency)}</td>
                <td className="num"><b>{fmt(state.remaining, debt.currency)}</b></td>
                <td><DebtBadge status={state.status} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><EmptyState icon={receive ? "arrowDown" : "arrowUp"} title={receive ? "Nothing to receive" : "Nothing to pay"} body={receive ? "Record money someone owes you — loans, pending amounts, anything that is not an account sale." : "Record money you owe — and every partial payment you make."} /></td></tr>}
          </tbody>
        </table>
      </div>
      {open && <DebtDetail debt={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Receipts({ s, payments }: { s: Summary; payments: Payment[] }) {
  const { svc } = useApp();
  const { data, error, loading } = useLoad(() => svc.list("receipts"), []);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<Receipt | null>(null);
  const plans = new Map(s.plans.map((p) => [p.plan.id, p.plan]));
  const pays = new Map(payments.map((p) => [p.id, p]));
  const rows = (data ?? [])
    .filter((r) => kind === "all" || r.kind === kind)
    .filter((r) => {
      if (!q) return true;
      const pl = r.plan_id ? plans.get(r.plan_id) : null;
      return [r.receipt_no, pl?.customer_name, pl?.account_title].some((x) => lower(x).includes(q.toLowerCase()));
    })
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  return (
    <>
      <div className="toolbar">
        <div className="search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt no., customer, account…" aria-label="Search receipts" /></div>
        <div className="seg" role="group" aria-label="Receipt type">
          {([["all", "All"], ["plan", "Payment plans"], ["payment", "Payments received"]] as const).map(([k, l]) => (
            <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table className="fin-table">
            <thead><tr><th>Receipt</th><th>Type</th><th>Customer</th><th>Account</th><th>Issued</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const pl = r.plan_id ? plans.get(r.plan_id) : null;
                const pay = r.payment_id ? pays.get(r.payment_id) : null;
                return (
                  <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                    <td className="mono small"><b>{r.receipt_no}</b></td>
                    <td className="small">{r.kind === "plan" ? `Payment plan · rev ${r.revision ?? 0}` : "Payment received"}</td>
                    <td>{pl?.customer_name ?? "—"}</td>
                    <td className="small">{pl?.account_title ?? "—"}</td>
                    <td className="small">{new Date(r.issued_at).toLocaleDateString()}</td>
                    <td className="num">{pay ? fmt(pay.amount_minor, pay.currency as PayCurrency) : pl ? fmt(pl.original_minor, pl.currency) : "—"}</td>
                    <td>{pay?.status === "reversed" ? <span className="badge bad">Reversed</span> : <Icon name="receipt" size={15} className="faint" />}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={7}><EmptyState icon="receipt" title="No receipts yet" body="A Payment Plan receipt is issued when a plan is created, and a Payment Received receipt for every payment." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReceiptView receipt={open} reversed={open.payment_id ? pays.get(open.payment_id)?.status === "reversed" : false} onClose={() => setOpen(null)} />}
    </>
  );
}
