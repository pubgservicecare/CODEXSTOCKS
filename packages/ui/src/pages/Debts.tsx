import { useState } from "react";
import {
  computeDebtState,
  localDate,
  minorToDecimalString,
  newId,
  parseCharges,
  parseMoney,
  PAY_CURRENCIES,
  PAY_METHOD_LABELS,
  type Debt,
  type PayCurrency,
  type PayMethod,
} from "@codex/shared";
import { errMsg, Field, Modal, Notice, useApp, useLoad } from "../components";
import { Icon } from "../icons";
import { day, DebtBadge, emptyMoney, fmt, MoneyFields, moneyInput, useDraft, useRates, useRateSources } from "../finance-ui";

/** Create or correct a Money to Receive / Money to Pay record. */
export function DebtDialog({ direction, debt, onClose, onSaved }: { direction: "receive" | "pay"; debt?: Debt; onClose: () => void; onSaved?: (d: Debt) => void }) {
  const { svc, toast } = useApp();
  const [id] = useState(() => debt?.id ?? newId());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, set] = useDraft({
    party_name: debt?.party_name ?? "",
    party_contact: debt?.party_contact ?? "",
    description: debt?.description ?? "",
    amount: debt ? minorToDecimalString(debt.original_minor, debt.currency) : "",
    currency: (debt?.currency ?? "PKR") as PayCurrency,
    txn_on: debt?.txn_on ?? localDate(),
    due_on: debt?.due_on ?? "",
    notes: debt?.notes ?? "",
    reason: "",
  });
  const receive = direction === "receive";
  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!f.party_name.trim()) throw new Error(receive ? "Enter who owes you" : "Enter who you owe");
      const original_minor = parseMoney(f.amount, f.currency);
      if (original_minor <= 0) throw new Error("Enter the amount");
      const saved = await svc.exec<Debt>("saveDebt", {
        id,
        ...(debt ? { expected_rev: debt.rev } : {}),
        debt: { direction, party_name: f.party_name, party_contact: f.party_contact || null, description: f.description, original_minor, currency: f.currency, txn_on: f.txn_on, due_on: f.due_on || null, notes: f.notes },
        reason: f.reason || undefined,
      });
      toast(debt ? "Record corrected" : receive ? "Money to receive recorded" : "Money to pay recorded");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={debt ? "Correct record" : receive ? "Money to receive" : "Money to pay"} icon={receive ? "arrowDown" : "arrowUp"} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <div className="form-grid">
          <Field label={receive ? "Who owes you *" : "Who you owe *"}><input value={f.party_name} onChange={(e) => set({ party_name: e.target.value })} maxLength={200} autoFocus /></Field>
          <Field label="Contact" optional><input value={f.party_contact} onChange={(e) => set({ party_contact: e.target.value })} maxLength={100} inputMode="tel" /></Field>
          <Field label="Reason / description" optional className="full"><input value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} placeholder={receive ? "e.g. Loan to Ali" : "e.g. Account bought on credit"} /></Field>
          <Field label="Amount *"><input value={f.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Currency *"><select value={f.currency} onChange={(e) => set({ currency: e.target.value as PayCurrency })}>{PAY_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Transaction date *"><input type="date" value={f.txn_on} onChange={(e) => set({ txn_on: e.target.value })} /></Field>
          <Field label="Due date" optional><input type="date" value={f.due_on} min={f.txn_on} onChange={(e) => set({ due_on: e.target.value })} /></Field>
          <Field label="Notes" optional className="full"><textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} /></Field>
          {debt && <Field label="Reason for the correction" hint="Required when the amount changes; kept in the history." className="full"><input value={f.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={500} /></Field>}
        </div>
        {err && <Notice kind="bad">{err}</Notice>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy}><Icon name="check" size={15} /> {busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** One record: what is owed, every partial payment, charges, and the actions. */
export function DebtDetail({ debt: initial, onClose }: { debt: Debt; onClose: () => void }) {
  const { svc, toast } = useApp();
  const { data, reload } = useLoad(async () => {
    const [d, payments] = await Promise.all([svc.list("debts"), svc.list("payments", { debt_id: initial.id })]);
    return { debt: d.find((x) => x.id === initial.id) ?? initial, payments };
  }, [initial.id]);
  const debt = data?.debt ?? initial;
  const state = computeDebtState(debt, data?.payments ?? []);
  const [mode, setMode] = useState<"view" | "pay" | "charge" | "edit" | "cancel">("view");
  const receive = debt.direction === "receive";
  const charges = parseCharges(debt);
  const c = debt.currency;

  if (mode === "edit") return <DebtDialog direction={debt.direction} debt={debt} onClose={() => (setMode("view"), reload())} />;

  return (
    <Modal title={`${receive ? "Money to receive" : "Money to pay"} · ${debt.party_name}`} icon={receive ? "arrowDown" : "arrowUp"} onClose={onClose} wide>
      <div className="grid grid-4 fin-grid" style={{ marginBottom: 12 }}>
        <div className="stat"><div className="label">Amount</div><div className="value sm">{fmt(debt.original_minor, c)}</div><div className="sub">{day(debt.txn_on)}</div></div>
        <div className="stat"><div className="label">Charges</div><div className="value sm">{fmt(state.charges - state.discounts, c)}</div><div className="sub">interest / service, separate</div></div>
        <div className="stat"><div className="label">{receive ? "Received" : "Paid"}</div><div className="value sm">{fmt(state.paid, c)}</div><div className="sub">{state.payments.length} payment(s)</div></div>
        <div className="stat"><div className="label">Remaining</div><div className="value sm">{fmt(state.remaining, c)}</div><div className="sub"><DebtBadge status={state.status} /> {debt.due_on ? `due ${day(debt.due_on)}` : ""}</div></div>
      </div>
      {debt.description && <p className="small" style={{ marginTop: 0 }}>{debt.description}</p>}
      {state.overpaid > 0 && <Notice kind="warn">Overpaid by {fmt(state.overpaid, c)} — {receive ? "you received more than was owed" : "you paid more than was owed"}.</Notice>}
      {debt.status === "cancelled" && <Notice kind="info">Cancelled: {debt.cancel_reason}</Notice>}

      {mode === "pay" && <DebtPaymentForm debt={debt} onDone={() => (setMode("view"), reload())} />}
      {mode === "charge" && <ChargeForm debt={debt} onDone={() => (setMode("view"), reload())} />}
      {mode === "cancel" && <CancelDebt debt={debt} onDone={() => (setMode("view"), reload())} />}

      {mode === "view" && debt.status !== "cancelled" && (
        <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 4 }}>
          {state.remaining > 0 && <button className="btn primary" onClick={() => setMode("pay")}><Icon name="plus" size={15} /> {receive ? "Record money received" : "Record payment made"}</button>}
          <button className="btn" onClick={() => setMode("charge")}>Add charge / discount</button>
          <button className="btn ghost" onClick={() => setMode("edit")}><Icon name="edit" size={14} /> Correct</button>
          <button className="btn ghost" onClick={() => setMode("cancel")}>Cancel record</button>
        </div>
      )}

      <h3 className="fin-sub">Payment history</h3>
      <div className="table-wrap">
        <table className="fin-table">
          <thead><tr><th>Date</th><th>Receipt</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data?.payments ?? []).sort((a, b) => b.paid_on.localeCompare(a.paid_on)).map((p) => (
              <tr key={p.id} className={p.status === "reversed" ? "reversed" : ""}>
                <td className="small">{day(p.paid_on)}</td>
                <td className="mono small">{p.receipt_no}</td>
                <td className="num">{fmt(p.amount_minor, p.currency as PayCurrency)}{p.rate_micro ? <div className="small faint">= {fmt(p.credited_minor, c)}</div> : null}</td>
                <td className="small">{PAY_METHOD_LABELS[p.method as PayMethod] ?? p.method}</td>
                <td className="small">{p.reference ?? "—"}</td>
                <td>{p.status === "reversed" ? <span className="badge bad" title={p.reversal_reason ?? ""}>Reversed</span> : <span className="badge ok">Recorded</span>}</td>
                <td>{p.status === "recorded" && <ReverseButton id={p.id} onDone={reload} />}</td>
              </tr>
            ))}
            {!data?.payments.length && <tr><td colSpan={7} className="small faint">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {charges.length > 0 && (
        <>
          <h3 className="fin-sub">Charges & discounts</h3>
          <ul className="plain-list small">
            {charges.map((x) => <li key={x.id}>{day(x.on)} · {x.kind === "charge" ? "Charge" : "Discount"} {fmt(x.minor, c)} — {x.label}</li>)}
          </ul>
        </>
      )}
      <div className="modal-actions"><button className="btn" onClick={() => (toast("Saved records stay in the history"), onClose())}>Close</button></div>
    </Modal>
  );
}

export function ReverseButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { svc, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn ghost sm" onClick={(e) => (e.stopPropagation(), setOpen(true))}>Reverse</button>;
  return (
    <span className="reverse-inline" onClick={(e) => e.stopPropagation()}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={500} autoFocus aria-label="Reason for reversing" />
      <button
        className="btn danger sm"
        disabled={busy || reason.trim().length < 3}
        onClick={async () => {
          setBusy(true);
          try {
            await svc.exec("reversePayment", { id, reason });
            toast("Payment reversed (kept in the history)");
            onDone();
          } catch (e) {
            toast(errMsg(e), "bad");
          } finally {
            setBusy(false);
          }
        }}
      >
        Reverse
      </button>
      <button className="btn ghost sm" onClick={() => setOpen(false)}>Keep</button>
    </span>
  );
}

function DebtPaymentForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { svc, toast } = useApp();
  const rates = useRates();
  const sources = useRateSources();
  const [id] = useState(newId);
  const [d, set] = useDraft(() => emptyMoney(debt.currency));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      await svc.exec("recordDebtPayment", { ...moneyInput(d, debt.currency, { rates, sources }, id), debt_id: debt.id });
      toast(debt.direction === "receive" ? "Money received recorded" : "Payment recorded");
      onDone();
    } catch (e) {
      if ((e as { code?: string }).code === "exists") return onDone();
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <form className="card inset" onSubmit={(e) => (e.preventDefault(), void save())}>
      <div className="form-grid"><MoneyFields d={d} set={set} target={debt.currency} label={debt.direction === "receive" ? "Amount received" : "Amount paid"} /></div>
      {err && <Notice kind="bad">{err}</Notice>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary" disabled={busy}><Icon name="check" size={15} /> {busy ? "Saving…" : "Save payment"}</button>
      </div>
    </form>
  );
}

function ChargeForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { svc, toast } = useApp();
  const [f, set] = useDraft({ kind: "charge" as "charge" | "discount", amount: "", label: "", on: localDate() });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try {
      await svc.exec("addDebtCharge", { debt_id: debt.id, kind: f.kind, minor: parseMoney(f.amount, debt.currency), label: f.label, on: f.on });
      toast(f.kind === "charge" ? "Charge added" : "Discount added");
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <form className="card inset" onSubmit={(e) => (e.preventDefault(), void save())}>
      <div className="form-grid">
        <Field label="Type"><select value={f.kind} onChange={(e) => set({ kind: e.target.value as "charge" | "discount" })}><option value="charge">Interest / service charge</option><option value="discount">Discount</option></select></Field>
        <Field label={`Amount (${debt.currency}) *`}><input value={f.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" autoFocus /></Field>
        <Field label="Description *"><input value={f.label} onChange={(e) => set({ label: e.target.value })} maxLength={200} /></Field>
        <Field label="Date"><input type="date" value={f.on} onChange={(e) => set({ on: e.target.value })} /></Field>
      </div>
      <p className="small muted">Charges are kept separate from the amount: they count as {debt.direction === "receive" ? "income" : "a cost"} only when actually {debt.direction === "receive" ? "received" : "paid"}.</p>
      {err && <Notice kind="bad">{err}</Notice>}
      <div className="modal-actions"><button type="button" className="btn ghost" onClick={onDone}>Cancel</button><button className="btn primary">Add</button></div>
    </form>
  );
}

function CancelDebt({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const { svc, toast } = useApp();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="card inset"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await svc.exec("cancelDebt", { id: debt.id, reason });
          toast("Record cancelled (kept in the history)");
          onDone();
        } catch (x) {
          setErr(errMsg(x));
        }
      }}
    >
      <Field label="Reason for cancelling *"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus /></Field>
      {err && <Notice kind="bad">{err}</Notice>}
      <div className="modal-actions"><button type="button" className="btn ghost" onClick={onDone}>Back</button><button className="btn danger" disabled={reason.trim().length < 3}>Cancel record</button></div>
    </form>
  );
}
