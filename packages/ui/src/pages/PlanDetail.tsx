import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  installmentLabel,
  localDate,
  newId,
  PAY_METHOD_LABELS,
  parseWaivers,
  planCore,
  planRef,
  planStatusLabel,
  computePlanState,
  type AuditEvent,
  type PayCurrency,
  type PayMethod,
  type Payment,
  type Receipt,
} from "@codex/shared";
import { AuditDetails, errMsg, Loading, Notice, useApp, useLoad } from "../components";
import { Icon } from "../icons";
import { day, EntryBadge, fmt, PlanStatusBadge, Stat } from "../finance-ui";
import { humanAction } from "./Dashboard";
import { ReverseButton } from "./Debts";
import { CancelPlanDialog, PaymentDialog, PlanInfoDialog, ReviseDialog, WaiveDialog } from "./PlanDialogs";
import { ReceiptView } from "../receipts/ReceiptView";

type Dialog = null | "pay" | "revise" | "waive" | "cancel" | "info";

export function PlanDetail() {
  const { id } = useParams() as { id: string };
  const { svc, toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useLoad(async () => {
    const [plans, payments, receipts, events] = await Promise.all([
      svc.list("installment_plans"),
      svc.list("payments", { plan_id: id }),
      svc.list("receipts", { plan_id: id }),
      svc.audit().catch(() => [] as AuditEvent[]),
    ]);
    const plan = plans.find((p) => p.id === id) ?? null;
    return { plan, payments, receipts, events: plan ? events.filter((e) => e.entity_id === id || e.details.includes(id)) : [] };
  }, [id]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [issuing, setIssuing] = useState(false);

  // After creating a plan or recording a payment, open the receipt that was just issued.
  useEffect(() => {
    if (!data) return;
    const want = params.get("receipt");
    if (!want) return;
    const r =
      want === "plan"
        ? [...data.receipts].filter((x) => x.kind === "plan").sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0]
        : data.receipts.find((x) => x.payment_id === want);
    if (r) setReceipt(r);
    params.delete("receipt");
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return <Loading error={error} loading={loading} />;
  const plan = data.plan;
  if (!plan) return <Notice kind="warn">Plan not found. <Link to="/payments/plans">All plans</Link></Notice>;
  const core = planCore(plan, data.payments);
  const s = computePlanState(core, localDate());
  const c = plan.currency;
  const label = planStatusLabel(plan, s);
  const active = plan.status === "active";
  const payments = [...data.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
  const waivers = parseWaivers(plan);
  const receiptOf = (p: Payment) => data.receipts.find((r) => r.payment_id === p.id) ?? null;
  const done = () => (setDialog(null), reload());

  const issuePlanReceipt = async () => {
    setIssuing(true);
    try {
      const rid = newId();
      await svc.exec("issuePlanReceipt", { id: rid, plan_id: plan.id, issued_on: localDate() });
      toast("Payment plan receipt issued");
      const fresh = await svc.list("receipts", { plan_id: plan.id });
      setReceipt(fresh.find((r) => r.id === rid) ?? null);
      reload();
    } catch (e) {
      toast(errMsg(e), "bad");
    } finally {
      setIssuing(false);
    }
  };
  const latestPlanReceipt = [...data.receipts].filter((r) => r.kind === "plan").sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0] ?? null;

  return (
    <>
      <div className="cx-page-head">
        <div>
          <div className="crumbs small"><Link to="/payments/plans">Installment plans</Link> / {planRef(plan)}</div>
          <h1>{plan.customer_name} <PlanStatusBadge label={label} /></h1>
          <p>
            <Link to={`/accounts/${plan.account_id}`}>{plan.account_title}</Link> · started {day(plan.start_on)} · {plan.currency}
            {plan.revision > 0 ? ` · revision ${plan.revision}` : ""}
            {plan.customer_whatsapp || plan.customer_phone ? ` · ${plan.customer_whatsapp ?? plan.customer_phone}` : ""}
          </p>
        </div>
        <span className="spacer" />
        {active && s.status !== "paid" && <button className="btn primary" onClick={() => setDialog("pay")}><Icon name="plus" size={15} /> Record payment</button>}
        <button className="btn" onClick={() => (latestPlanReceipt && plan.revision === (latestPlanReceipt.revision ?? 0) ? setReceipt(latestPlanReceipt) : void issuePlanReceipt())} disabled={issuing}>
          <Icon name="receipt" size={15} /> Payment plan
        </button>
      </div>

      {plan.status === "cancelled" && <Notice kind="info">Cancelled on {day(plan.cancelled_on)}: {plan.cancel_reason}</Notice>}

      <div className="grid grid-4 fin-grid">
        <Stat label="Original price" value={fmt(plan.original_minor, c)} sub={plan.advance_minor ? <>advance {fmt(plan.advance_minor, c)} · {s.advance_paid ? <span style={{ color: "var(--ok)" }}>paid</span> : "pending"}</> : "no advance"} />
        <Stat label="Collected" value={fmt(s.totals.collected, c)} sub={s.totals.credit ? `+ ${fmt(s.totals.credit, c)} customer credit` : `of ${fmt(s.totals.grand_total, c)} scheduled`} />
        <Stat label="Remaining" tone={s.status === "overdue" ? "bad" : undefined} value={fmt(s.totals.remaining_total, c)} sub={`qist ${fmt(s.totals.remaining_principal, c)} · extra ${fmt(s.totals.remaining_extra, c)}${s.totals.remaining_fine ? ` · fines ${fmt(s.totals.remaining_fine, c)}` : ""}`} />
        <Stat label="Next due" value={s.next ? fmt(s.next.remaining + s.next.fine_remaining, c) : "Fully paid"} sub={s.next ? <>{s.next.n === 0 ? "Advance" : installmentLabel(plan.interval_days, s.next.n)} · {day(s.next.due_on)} <EntryBadge status={s.next.status} /></> : s.settled_on ? `settled ${day(s.settled_on)}` : undefined} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <span className="icon-tile"><Icon name="calendar" size={16} /></span>
          <h2>Installments</h2>
          <span className="spacer" />
          {active && (
            <>
              <button className="btn sm" onClick={() => setDialog("revise")}><Icon name="edit" size={14} /> Change schedule</button>
              {s.totals.remaining_fine > 0 && <button className="btn sm ghost" onClick={() => setDialog("waive")}>Waive fine</button>}
            </>
          )}
        </div>
        <div className="table-wrap">
          <table className="fin-table schedule-table">
            <thead><tr><th>#</th><th>Due</th><th className="num">Qist</th><th className="num">Daily Extra</th><th className="num">Late fine</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Remaining</th><th>Paid on</th><th>Status</th></tr></thead>
            <tbody>
              {s.entries.map((e) => (e.n === 0 && !e.principal ? null : (
                <tr key={e.n} className={e.status === "overdue" ? "overdue" : ""}>
                  <td>{e.n === 0 ? "Advance" : installmentLabel(plan.interval_days, e.n)}</td>
                  <td className="small">{day(e.due_on)}{e.period_from && <div className="faint">{day(e.period_from)} – {day(e.due_on)}</div>}</td>
                  <td className="num">{fmt(e.principal, c)}</td>
                  <td className="num">{e.n === 0 ? "—" : plan.extra_rate_minor && !e.extra ? <span className="maaf">0 / Maaf</span> : e.extra ? <>{fmt(e.extra, c)}<div className="small faint">{e.extra_days} day{e.extra_days === 1 ? "" : "s"}</div></> : "—"}</td>
                  <td className="num">{e.fine ? <>{fmt(e.fine, c)}{e.fine_waived ? <div className="small" style={{ color: "var(--ok)" }}>waived {fmt(e.fine_waived, c)}</div> : <div className="small faint">{e.late_days} day{e.late_days === 1 ? "" : "s"} late</div>}</> : "—"}</td>
                  <td className="num"><b>{fmt(e.due_total + e.fine - e.fine_waived, c)}</b></td>
                  <td className="num">{fmt(e.paid_principal + e.paid_extra + e.paid_fine, c)}</td>
                  <td className="num">{fmt(e.remaining + e.fine_remaining, c)}</td>
                  <td className="small">{e.cleared_on ? day(e.cleared_on) : e.last_paid_on ? `part · ${day(e.last_paid_on)}` : "—"}</td>
                  <td><EntryBadge status={e.status} /></td>
                </tr>
              )))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><b>Totals</b></td>
                <td className="num"><b>{fmt(s.totals.principal, c)}</b></td>
                <td className="num"><b>{fmt(s.totals.extra, c)}</b></td>
                <td className="num"><b>{fmt(s.totals.fine - s.totals.fine_waived, c)}</b></td>
                <td className="num"><b>{fmt(s.totals.grand_total, c)}</b></td>
                <td className="num"><b>{fmt(s.totals.collected, c)}</b></td>
                <td className="num"><b>{fmt(s.totals.remaining_total, c)}</b></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Daily Extra {plan.extra_rate_minor ? `${fmt(plan.extra_rate_minor, c)}/day after ${plan.extra_free_days} free days, added to the next installment` : "none"} · late fine{" "}
          {plan.fine_minor ? `${fmt(plan.fine_minor, c)} ${plan.fine_mode === "per_day" ? "per day" : "once"} after ${plan.fine_grace_days} grace day(s)` : "none"}.
        </p>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><span className="icon-tile"><Icon name="wallet" size={16} /></span><h2>Payment history</h2></div>
          <div className="table-wrap">
            <table className="fin-table">
              <thead><tr><th>Date</th><th>Receipt</th><th>Type</th><th className="num">Amount</th><th>Method</th><th>Status</th><th /></tr></thead>
              <tbody>
                {payments.map((p) => {
                  const r = receiptOf(p);
                  return (
                    <tr key={p.id} className={p.status === "reversed" ? "reversed" : ""}>
                      <td className="small">{day(p.paid_on)}</td>
                      <td className="mono small">{r ? <button className="link-btn" onClick={() => setReceipt(r)}>{p.receipt_no}</button> : p.receipt_no}</td>
                      <td className="small">{p.kind}{p.installment_no ? ` · #${p.installment_no}` : ""}</td>
                      <td className="num"><b>{fmt(p.amount_minor, p.currency as PayCurrency)}</b>{p.rate_micro ? <div className="small faint">= {fmt(p.credited_minor, c)}</div> : null}</td>
                      <td className="small">{PAY_METHOD_LABELS[p.method as PayMethod] ?? p.method}{p.reference ? <div className="faint">{p.reference}</div> : null}</td>
                      <td>{p.status === "reversed" ? <span className="badge bad" title={p.reversal_reason ?? ""}>Reversed</span> : <span className="badge ok">Recorded</span>}</td>
                      <td>{p.status === "recorded" && active && <ReverseButton id={p.id} onDone={reload} />}</td>
                    </tr>
                  );
                })}
                {!payments.length && <tr><td colSpan={7} className="small faint">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {waivers.length > 0 && (
            <>
              <h3 className="fin-sub">Fine waivers</h3>
              <ul className="plain-list small">
                {waivers.map((w) => (
                  <li key={w.id}>
                    {installmentLabel(plan.interval_days, w.n)} · {fmt(w.minor, c)} — {w.reason} {w.undone_at ? <span className="badge">undone: {w.undo_reason}</span> : active && <UndoWaiver planId={plan.id} waiverId={w.id} onDone={reload} />}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="card">
          <div className="card-head"><span className="icon-tile"><Icon name="user" size={16} /></span><h2>Customer & agreement</h2><span className="spacer" />{active && <button className="btn sm ghost" onClick={() => setDialog("info")}><Icon name="edit" size={14} /> Edit</button>}</div>
          <dl className="kv small">
            <dt>Customer</dt><dd>{plan.customer_name}</dd>
            <dt>Phone</dt><dd>{plan.customer_phone ?? "—"}</dd>
            <dt>WhatsApp</dt><dd>{plan.customer_whatsapp ?? "—"}</dd>
            <dt>Account ref</dt><dd>{plan.account_ref ?? "—"}</dd>
            <dt>Agreement ref</dt><dd>{plan.agreement_ref ?? "—"}</dd>
            <dt>Duration</dt><dd>{plan.duration_months ? `${plan.duration_months} months` : plan.duration_days ? `${plan.duration_days} days` : "—"}</dd>
            <dt>Interval</dt><dd>{plan.interval_days ? `${plan.interval_days} days` : "custom dates"}</dd>
            <dt>Notes</dt><dd>{plan.payment_notes || plan.agreement_notes || "—"}</dd>
          </dl>
          <h3 className="fin-sub">Receipts</h3>
          <ul className="plain-list small">
            {[...data.receipts].sort((a, b) => b.issued_at.localeCompare(a.issued_at)).map((r) => (
              <li key={r.id}><button className="link-btn" onClick={() => setReceipt(r)}><Icon name="receipt" size={13} /> {r.receipt_no}</button> · {r.kind === "plan" ? `payment plan (rev ${r.revision ?? 0})` : "payment received"} · {new Date(r.issued_at).toLocaleDateString()}</li>
            ))}
          </ul>
          {active && (
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button className="btn sm" onClick={() => void issuePlanReceipt()} disabled={issuing}>Issue updated payment plan</button>
              <button className="btn sm ghost danger-text" onClick={() => setDialog("cancel")}>Cancel plan</button>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><span className="icon-tile"><Icon name="history" size={16} /></span><h2>Plan history & revisions</h2></div>
        {!data.events.length ? (
          <div className="empty small">No history yet (it appears after the next sync on this device).</div>
        ) : (
          <div className="table-wrap">
            <table className="fin-table">
              <thead><tr><th>When</th><th>What</th><th>Details</th></tr></thead>
              <tbody>
                {data.events.slice(0, 60).map((e) => (
                  <tr key={e.id}><td className="small">{new Date(e.at).toLocaleString()}</td><td className="small"><b>{humanAction(e.action)}</b></td><td><AuditDetails details={e.details} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog === "pay" && (
        <PaymentDialog
          plan={plan}
          core={core}
          onClose={() => setDialog(null)}
          onSaved={(pid) => {
            setDialog(null);
            reload();
            nav(`/payments/plans/${plan.id}?receipt=${pid}`, { replace: true });
          }}
        />
      )}
      {dialog === "revise" && <ReviseDialog plan={plan} core={core} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "waive" && <WaiveDialog plan={plan} core={core} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "cancel" && <CancelPlanDialog plan={plan} hasPayments={data.payments.some((p) => p.status === "recorded")} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog === "info" && <PlanInfoDialog plan={plan} onClose={() => setDialog(null)} onSaved={done} />}
      {receipt && <ReceiptView receipt={receipt} reversed={receipt.payment_id ? data.payments.find((p) => p.id === receipt.payment_id)?.status === "reversed" : false} onClose={() => setReceipt(null)} />}
    </>
  );
}

function UndoWaiver({ planId, waiverId, onDone }: { planId: string; waiverId: string; onDone: () => void }) {
  const { svc, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className="btn ghost sm" onClick={() => setOpen(true)}>Undo</button>;
  return (
    <span className="reverse-inline">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
      <button
        className="btn sm"
        disabled={reason.trim().length < 3}
        onClick={async () => {
          try {
            await svc.exec("undoFineWaiver", { plan_id: planId, waiver_id: waiverId, reason });
            toast("Waiver undone");
            onDone();
          } catch (e) {
            toast(errMsg(e), "bad");
          }
        }}
      >
        Undo waiver
      </button>
    </span>
  );
}
