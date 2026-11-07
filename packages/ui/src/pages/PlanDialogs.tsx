import { useMemo, useState } from "react";
import {
  computePlanState,
  convertMinor,
  installmentLabel,
  localDate,
  minorToDecimalString,
  newId,
  parseMoney,
  reviseSchedule,
  settlementQuote,
  suggestAllocation,
  validateAllocation,
  type Allocation,
  type InstallmentPlan,
  type PlanCore,
  type Revision,
} from "@codex/shared";
import { errMsg, Field, Modal, Notice, useApp } from "../components";
import { Icon } from "../icons";
import { day, emptyMoney, fmt, MoneyFields, moneyInput, useDraft, useRates, useRateSources } from "../finance-ui";

const PART: Record<string, string> = { principal: "Qist", extra: "Daily Extra", fine: "Late fine", credit: "Customer credit" };
const allocLabel = (plan: InstallmentPlan, a: Allocation) =>
  a.part === "credit" ? "Customer credit (overpayment)" : a.n === 0 ? "Advance" : `${installmentLabel(plan.interval_days, a.n)} · ${PART[a.part]}`;

/** Record money received for a plan: amount (any of PKR/USD/USDT with an explicit rate), allocation preview, optional manual allocation. */
export function PaymentDialog({ plan, core, onClose, onSaved }: { plan: InstallmentPlan; core: PlanCore; onClose: () => void; onSaved: (paymentId: string) => void }) {
  const { svc, toast } = useApp();
  const rates = useRates();
  const sources = useRateSources();
  const [id] = useState(newId);
  const state = computePlanState(core, localDate());
  const [kind, setKind] = useState<"installment" | "advance" | "settlement">(state.advance_paid || plan.advance_minor === 0 ? "installment" : "advance");
  const [d, set] = useDraft(() => {
    const m = emptyMoney(plan.currency);
    const next = state.next;
    if (next) m.amount = minorToDecimalString(next.remaining + next.fine_remaining, plan.currency);
    return m;
  });
  const [manual, setManual] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = plan.currency;

  let input: ReturnType<typeof moneyInput> | null = null;
  let credited: number | null = null;
  try {
    input = moneyInput(d, c, { rates, sources }, id);
    credited = input.rate_micro ? convertMinor(input.amount_minor, input.rate_micro) : input.amount_minor;
  } catch {
    input = null;
  }
  const quote = useMemo(() => (d.paid_on ? settlementQuote(core, d.paid_on) : null), [core, d.paid_on]);
  const auto = credited && d.paid_on ? suggestAllocation(core, d.paid_on, credited) : null;
  const owed = useMemo(() => {
    const s = computePlanState(core, d.paid_on || localDate());
    const out: Allocation[] = [];
    for (const e of s.entries) {
      if (e.n === 0) {
        if (e.principal - e.paid_principal) out.push({ n: 0, part: "principal", minor: e.principal - e.paid_principal });
        continue;
      }
      if (e.extra - e.paid_extra) out.push({ n: e.n, part: "extra", minor: e.extra - e.paid_extra });
      if (e.principal - e.paid_principal) out.push({ n: e.n, part: "principal", minor: e.principal - e.paid_principal });
      if (e.fine_remaining) out.push({ n: e.n, part: "fine", minor: e.fine_remaining });
    }
    return out;
  }, [core, d.paid_on]);
  const manualAllocs = (): Allocation[] => {
    const out: Allocation[] = [];
    for (const o of [...owed, { n: 0, part: "credit" as const, minor: 0 }]) {
      const v = alloc[`${o.n}:${o.part}`];
      if (v && v.trim()) {
        const minor = parseMoney(v, c);
        if (minor > 0) out.push({ n: o.n, part: o.part, minor });
      }
    }
    return out;
  };

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!input || !credited) throw new Error("Enter the amount received");
      let allocations: Allocation[] | null = null;
      if (manual) {
        allocations = manualAllocs();
        validateAllocation(core, d.paid_on, credited, allocations);
      }
      if (kind === "settlement" && quote && credited < quote.total) throw new Error(`To settle in full on ${day(d.paid_on)} the customer pays ${fmt(quote.total, c)}`);
      await svc.exec("recordPlanPayment", { ...input, plan_id: plan.id, kind, allocations });
      toast("Payment recorded · receipt issued");
      onSaved(id);
    } catch (e) {
      if ((e as { code?: string }).code === "exists") return onSaved(id);
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Record payment" icon="wallet" onClose={busy ? () => undefined : onClose} wide>
      <div className="seg" role="group" aria-label="Payment type" style={{ marginBottom: 12 }}>
        {plan.advance_minor > 0 && !state.advance_paid && <button type="button" className={kind === "advance" ? "on" : ""} onClick={() => setKind("advance")}>Advance</button>}
        <button type="button" className={kind === "installment" ? "on" : ""} onClick={() => setKind("installment")}>Installment / partial</button>
        <button
          type="button"
          className={kind === "settlement" ? "on" : ""}
          onClick={() => {
            setKind("settlement");
            if (quote) set({ amount: minorToDecimalString(quote.total, c), currency: c });
          }}
        >
          Settle in full
        </button>
      </div>
      {kind === "settlement" && quote && (
        <Notice kind="info">
          Paying everything on {day(d.paid_on)}: qist {fmt(quote.principal, c)} + Daily Extra earned so far {fmt(quote.extra, c)}{quote.fine ? ` + late fines ${fmt(quote.fine, c)}` : ""} = <b>{fmt(quote.total, c)}</b>. Daily Extra stops from the next day.
        </Notice>
      )}
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <MoneyFields d={d} set={set} target={c} />
        </div>
        <div className="alloc-box">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>How it will be applied</b>
            <label className="check small"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Allocate manually</label>
          </div>
          {!manual ? (
            auto ? (
              <ul className="alloc-list">
                {auto.allocations.map((a) => (
                  <li key={`${a.n}:${a.part}`} className={a.part === "credit" ? "credit" : ""}><span>{allocLabel(plan, a)}</span><b>{fmt(a.minor, c)}</b></li>
                ))}
              </ul>
            ) : (
              <p className="small faint">Enter the amount to see the allocation.</p>
            )
          ) : (
            <div className="alloc-manual">
              {owed.map((o) => (
                <label key={`${o.n}:${o.part}`}>
                  <span>{allocLabel(plan, o)} <span className="faint small">owed {fmt(o.minor, c)}</span></span>
                  <input value={alloc[`${o.n}:${o.part}`] ?? ""} onChange={(e) => setAlloc({ ...alloc, [`${o.n}:${o.part}`]: e.target.value })} inputMode="decimal" placeholder="0" />
                </label>
              ))}
              <label>
                <span>Customer credit (overpayment)</span>
                <input value={alloc["0:credit"] ?? ""} onChange={(e) => setAlloc({ ...alloc, ["0:credit"]: e.target.value })} inputMode="decimal" placeholder="0" />
              </label>
              <p className="small faint">The parts must add up to exactly {credited ? fmt(credited, c) : "the amount received"}.</p>
            </div>
          )}
          {auto && auto.credit > 0 && !manual && <p className="small" style={{ color: "var(--warn)" }}>{fmt(auto.credit, c)} is more than everything owed: it is kept as customer credit, not income.</p>}
        </div>
        {err && <Notice kind="bad">{err}</Notice>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !input}><Icon name="check" size={15} /> {busy ? "Saving…" : "Save payment & issue receipt"}</button>
        </div>
      </form>
    </Modal>
  );
}

type RevKind = "one" | "following" | "amounts" | "regenerate";

/** Change dates or unpaid amounts, with a before/after preview of dates, qist and Daily Extra, a reason and explicit confirmation. */
export function ReviseDialog({ plan, core, onClose, onSaved }: { plan: InstallmentPlan; core: PlanCore; onClose: () => void; onSaved: () => void }) {
  const { svc, toast } = useApp();
  const asOf = localDate();
  const state = computePlanState(core, asOf);
  const unpaid = state.entries.slice(1).filter((e) => e.status !== "paid");
  const firstUntouched = state.entries.slice(1).find((e) => e.paid_principal + e.paid_extra === 0)?.n ?? null;
  const [kind, setKind] = useState<RevKind>("one");
  const [n, setN] = useState(unpaid[0]?.n ?? 1);
  const [date, setDate] = useState(unpaid[0]?.due_on ?? asOf);
  const [interval, setInterval] = useState(String(plan.interval_days ?? 30));
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(core.schedule.map((s) => [s.n, minorToDecimalString(s.principal_minor, plan.currency)])));
  const [regen, setRegen] = useState({ from: String(firstUntouched ?? ""), count: "2", interval: String(plan.interval_days ?? 30), first: asOf });
  const [reason, setReason] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = plan.currency;

  let revision: Revision | null = null;
  let preview: ReturnType<typeof reviseSchedule> | null = null;
  let previewErr: string | null = null;
  try {
    if (kind === "one" || kind === "following")
      revision = { kind: "move", n, due_on: date, scope: kind, interval_days: kind === "following" && plan.schedule_mode === "auto" && Number(interval) > 0 ? Number(interval) : null };
    else if (kind === "amounts")
      revision = { kind: "amounts", amounts: core.schedule.map((s) => ({ n: s.n, principal_minor: amounts[s.n]?.trim() ? parseMoney(amounts[s.n], c) : s.principal_minor })) };
    else revision = { kind: "regenerate", from_n: Number(regen.from), count: Number(regen.count), interval_days: Number(regen.interval), first_due_on: regen.first };
    preview = reviseSchedule(core, revision, asOf);
  } catch (e) {
    previewErr = errMsg(e);
  }

  const save = async () => {
    if (!revision || !preview) return;
    setBusy(true);
    setErr(null);
    try {
      await svc.exec("revisePlan", { plan_id: plan.id, expected_rev: plan.rev, revision, reason, as_of: asOf });
      toast("Schedule changed · kept in the plan history");
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Change the schedule" icon="calendar" onClose={busy ? () => undefined : onClose} wide>
      <div className="seg" role="group" aria-label="Kind of change" style={{ marginBottom: 12 }}>
        <button type="button" className={kind === "one" ? "on" : ""} onClick={() => setKind("one")}>Only this installment</button>
        <button type="button" className={kind === "following" ? "on" : ""} onClick={() => setKind("following")}>This and following</button>
        <button type="button" className={kind === "amounts" ? "on" : ""} onClick={() => setKind("amounts")}>Unpaid amounts</button>
        <button type="button" className={kind === "regenerate" ? "on" : ""} onClick={() => setKind("regenerate")} disabled={!firstUntouched}>Reschedule unpaid</button>
      </div>
      <div className="form-grid">
        {(kind === "one" || kind === "following") && (
          <>
            <Field label="Installment">
              <select value={n} onChange={(e) => { const v = Number(e.target.value); setN(v); setDate(core.schedule[v - 1]?.due_on ?? date); }}>
                {unpaid.map((e) => <option key={e.n} value={e.n}>{installmentLabel(plan.interval_days, e.n)} · {day(e.due_on)}</option>)}
              </select>
            </Field>
            <Field label="New due date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {kind === "following" && plan.schedule_mode === "auto" && (
              <Field label="Interval for the following installments (days)" hint="Later dates are recalculated from the new date"><input value={interval} onChange={(e) => setInterval(e.target.value)} inputMode="numeric" /></Field>
            )}
            {kind === "following" && plan.schedule_mode === "manual" && <p className="small muted full">Later installments move by the same number of days.</p>}
          </>
        )}
        {kind === "amounts" && (
          <div className="full manual-rows">
            {core.schedule.map((s) => {
              const paid = state.entries[s.n]?.status === "paid";
              return (
                <div className="manual-row" key={s.n}>
                  <span className="n">{installmentLabel(plan.interval_days, s.n)}</span>
                  <span className="small muted">{day(s.due_on)}</span>
                  <input value={amounts[s.n] ?? ""} disabled={paid} onChange={(e) => setAmounts({ ...amounts, [s.n]: e.target.value })} inputMode="decimal" aria-label={`Installment ${s.n} qist`} />
                  {paid ? <span className="badge ok">Paid</span> : <span />}
                </div>
              );
            })}
            <p className="small faint">The total of all installments must stay {fmt(plan.original_minor - plan.advance_minor, c)}.</p>
          </div>
        )}
        {kind === "regenerate" && (
          <>
            <Field label="Reschedule from installment"><input value={regen.from} onChange={(e) => setRegen({ ...regen, from: e.target.value })} inputMode="numeric" /></Field>
            <Field label="New number of installments"><input value={regen.count} onChange={(e) => setRegen({ ...regen, count: e.target.value })} inputMode="numeric" /></Field>
            <Field label="Interval (days)"><input value={regen.interval} onChange={(e) => setRegen({ ...regen, interval: e.target.value })} inputMode="numeric" /></Field>
            <Field label="First new due date"><input type="date" value={regen.first} onChange={(e) => setRegen({ ...regen, first: e.target.value })} /></Field>
          </>
        )}
      </div>

      <h3 className="fin-sub">Preview</h3>
      {previewErr ? (
        <Notice kind="warn">{previewErr}</Notice>
      ) : preview ? (
        <>
          <div className="table-wrap">
            <table className="fin-table diff-table">
              <thead><tr><th>#</th><th>Due date</th><th className="num">Qist</th><th className="num">Daily Extra</th></tr></thead>
              <tbody>
                {preview.diff.map((r) => (
                  <tr key={r.n} className={r.changed ? "changed" : ""}>
                    <td>{installmentLabel(plan.interval_days, r.n)}</td>
                    <td>{r.before?.due_on !== r.after?.due_on ? <><s className="faint">{day(r.before?.due_on)}</s> → <b>{day(r.after?.due_on)}</b></> : day(r.after?.due_on)}</td>
                    <td className="num">{r.before?.principal !== r.after?.principal ? <><s className="faint">{fmt(r.before?.principal ?? 0, c)}</s> → <b>{fmt(r.after?.principal ?? 0, c)}</b></> : fmt(r.after?.principal ?? 0, c)}</td>
                    <td className="num">{r.before?.extra !== r.after?.extra ? <><s className="faint">{fmt(r.before?.extra ?? 0, c)}</s> → <b>{fmt(r.after?.extra ?? 0, c)}</b></> : fmt(r.after?.extra ?? 0, c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Total Daily Extra: {fmt(preview.extra_before, c)} → <b>{fmt(preview.extra_after, c)}</b>. Paid installments, payments and issued receipts are not changed.</p>
        </>
      ) : null}

      <Field label="Reason (kept in the plan history) *"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Customer asked to move the date" /></Field>
      <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> This changes the agreement with the customer. I have agreed it with them.</label>
      {err && <Notice kind="bad">{err}</Notice>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" disabled={busy || !preview || !agree || reason.trim().length < 3} onClick={() => void save()}><Icon name="check" size={15} /> {busy ? "Saving…" : "Save change"}</button>
      </div>
    </Modal>
  );
}

export function WaiveDialog({ plan, core, onClose, onSaved }: { plan: InstallmentPlan; core: PlanCore; onClose: () => void; onSaved: () => void }) {
  const { svc, toast } = useApp();
  const s = computePlanState(core, localDate());
  const fines = s.entries.filter((e) => e.fine_remaining > 0);
  const [n, setN] = useState(fines[0]?.n ?? 0);
  const e = s.entries[n];
  const [amount, setAmount] = useState(e ? minorToDecimalString(e.fine_remaining, plan.currency) : "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Waive a late fine" icon="shieldCheck" onClose={onClose}>
      {!fines.length ? (
        <Notice kind="info">No unpaid late fines on this plan.</Notice>
      ) : (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            try {
              await svc.exec("waiveFine", { plan_id: plan.id, n, minor: parseMoney(amount, plan.currency), reason, as_of: localDate() });
              toast("Fine waived · kept in the history");
              onSaved();
            } catch (x) {
              setErr(errMsg(x));
            }
          }}
        >
          <div className="form-grid">
            <Field label="Installment">
              <select value={n} onChange={(ev) => { const v = Number(ev.target.value); setN(v); setAmount(minorToDecimalString(s.entries[v].fine_remaining, plan.currency)); }}>
                {fines.map((x) => <option key={x.n} value={x.n}>{installmentLabel(plan.interval_days, x.n)} · unpaid fine {fmt(x.fine_remaining, plan.currency)}</option>)}
              </select>
            </Field>
            <Field label="Amount to waive"><input value={amount} onChange={(ev) => setAmount(ev.target.value)} inputMode="decimal" /></Field>
            <Field label="Reason *" className="full"><input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={1000} /></Field>
          </div>
          {err && <Notice kind="bad">{err}</Notice>}
          <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={reason.trim().length < 3}>Waive</button></div>
        </form>
      )}
    </Modal>
  );
}

export function CancelPlanDialog({ plan, hasPayments, onClose, onSaved }: { plan: InstallmentPlan; hasPayments: boolean; onClose: () => void; onSaved: () => void }) {
  const { svc, toast } = useApp();
  const [reason, setReason] = useState("");
  const [on, setOn] = useState(localDate());
  const [undo, setUndo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Cancel installment plan" icon="alert" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>
        The plan and its payments stay in the history. Daily Extra and late fines stop on the cancellation date and the unpaid balance is written off (no longer money to receive).
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await svc.exec("cancelPlan", { plan_id: plan.id, reason, cancelled_on: on, undo_sale: undo });
            toast(undo ? "Plan cancelled and sale undone · account back in stock" : "Plan cancelled");
            onSaved();
          } catch (x) {
            setErr(errMsg(x));
          }
        }}
      >
        <div className="form-grid">
          <Field label="Cancellation date"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field>
          <Field label="Reason *"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={undo} disabled={hasPayments} onChange={(e) => setUndo(e.target.checked)} />
          Recorded by mistake: also undo the sale and put the account back in stock {hasPayments ? "(not possible: payments exist — reverse them first)" : ""}
        </label>
        {err && <Notice kind="bad">{err}</Notice>}
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Back</button><button className="btn danger" disabled={reason.trim().length < 3}>Cancel plan</button></div>
      </form>
    </Modal>
  );
}

export function PlanInfoDialog({ plan, onClose, onSaved }: { plan: InstallmentPlan; onClose: () => void; onSaved: () => void }) {
  const { svc, toast } = useApp();
  const [f, set] = useDraft({
    customer_name: plan.customer_name,
    customer_phone: plan.customer_phone ?? "",
    customer_whatsapp: plan.customer_whatsapp ?? "",
    account_ref: plan.account_ref ?? "",
    agreement_ref: plan.agreement_ref ?? "",
    payment_notes: plan.payment_notes,
    agreement_notes: plan.agreement_notes,
  });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Customer & notes" icon="user" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await svc.exec("updatePlanInfo", { plan_id: plan.id, expected_rev: plan.rev, info: f });
            toast("Saved");
            onSaved();
          } catch (x) {
            setErr(errMsg(x));
          }
        }}
      >
        <div className="form-grid">
          <Field label="Customer name *"><input value={f.customer_name} onChange={(e) => set({ customer_name: e.target.value })} maxLength={200} /></Field>
          <Field label="Phone" optional><input value={f.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} maxLength={40} /></Field>
          <Field label="WhatsApp" optional><input value={f.customer_whatsapp} onChange={(e) => set({ customer_whatsapp: e.target.value })} maxLength={40} /></Field>
          <Field label="Account reference" optional><input value={f.account_ref} onChange={(e) => set({ account_ref: e.target.value })} maxLength={100} /></Field>
          <Field label="Agreement reference" optional><input value={f.agreement_ref} onChange={(e) => set({ agreement_ref: e.target.value })} maxLength={200} /></Field>
          <Field label="Payment notes" optional><input value={f.payment_notes} onChange={(e) => set({ payment_notes: e.target.value })} maxLength={4000} /></Field>
          <Field label="Agreement notes" optional className="full"><textarea rows={2} value={f.agreement_notes} onChange={(e) => set({ agreement_notes: e.target.value })} maxLength={4000} /></Field>
        </div>
        {err && <Notice kind="bad">{err}</Notice>}
        <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
