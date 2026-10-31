import { useState } from "react";
import { Icon } from "../icons";
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  minorToDecimalString,
  parseMoney,
  snapshotFromQuote,
  type Currency,
  type Expense,
  type ExpenseInput,
  type FxQuote,
} from "@codex/shared";
import { FxPreview, useFx } from "../fx-ui";
import { Confirm, EmptyState, errMsg, Field, fmtDate, Loading, Modal, Money, todayIso, useAction, useApp, useLoad } from "../components";

const LABEL: Record<string, string> = {
  advertising: "Advertising",
  hosting_software: "Hosting & software",
  transaction_fees: "Transaction fees",
  account_recovery: "Account recovery",
  equipment: "Equipment",
  salary_services: "Salary & services",
  other: "Other",
};

export function ExpensesPage() {
  const { svc } = useApp();
  const { run } = useAction();
  const { data, error, loading } = useLoad(async () => {
    const [expenses, accounts] = await Promise.all([svc.list("expenses"), svc.listAccounts()]);
    return { expenses: expenses.sort((a, b) => b.incurred_at.localeCompare(a.incurred_at)), accounts };
  }, []);
  const [edit, setEdit] = useState<Expense | "new" | null>(null);
  const [del, setDel] = useState<Expense | null>(null);
  return (
    <>
      <div className="cx-page-head">
        <div><h1>Expenses</h1><p>Each expense keeps its own currency. Edits and deletions are recorded in the audit log.</p></div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEdit("new")}><Icon name="plus" size={16} /> Add expense</button>
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Account</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {data.expenses.map((x) => (
                <tr key={x.id}>
                  <td className="small">{fmtDate(x.incurred_at)}</td>
                  <td>{LABEL[x.category]}</td>
                  <td>{x.description}</td>
                  <td className="small muted">{x.account_id ? data.accounts.find((a) => a.id === x.account_id)?.title ?? "—" : "—"}</td>
                  <td className="num"><b><Money minor={x.amount_minor} currency={x.currency} /></b></td>
                  <td className="num">
                    <button className="btn ghost sm icon-only" title="Edit expense" aria-label="Edit expense" onClick={() => setEdit(x)}><Icon name="edit" size={14} /></button>
                    <button className="btn ghost sm icon-only" title="Delete expense" aria-label="Delete expense" onClick={() => setDel(x)}><Icon name="trash" size={14} /></button>
                  </td>
                </tr>
              ))}
              {!data.expenses.length && <tr><td colSpan={6}><EmptyState icon="expenses" title="No expenses recorded" body="Advertising, fees, recovery costs and other spending. Each expense keeps its own currency." action={<button className="btn sm" onClick={() => setEdit("new")}><Icon name="plus" size={14} /> Add expense</button>} /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {edit && data && <ExpenseForm expense={edit === "new" ? null : edit} accounts={data.accounts} onClose={() => setEdit(null)} />}
      {del && <Confirm danger title="Delete expense?" body="The deletion is kept in the audit history." confirm="Delete" onClose={() => setDel(null)} onYes={() => run(() => svc.exec("deleteExpense", { id: del.id }), "Expense deleted").then(() => undefined)} />}
    </>
  );
}

/**
 * Exchange-rate snapshot for an expense. Only USD expenses need one (PKR is the reporting currency).
 * An edit that keeps the same USD amount keeps the rate recorded originally; otherwise the current
 * reference rate is recorded. Without any rate the expense stays USD-only (left out of PKR totals).
 */
export function expenseFx(input: Pick<ExpenseInput, "amount_minor" | "currency">, prev: Expense | null, quote: FxQuote | null): Pick<ExpenseInput, "fx_usd_pkr_micro" | "fx_source" | "fx_at"> {
  if (input.currency !== "USD") return { fx_usd_pkr_micro: null, fx_source: null, fx_at: null };
  if (prev?.fx_usd_pkr_micro && prev.currency === "USD" && (prev.amount_minor === input.amount_minor || !quote))
    return { fx_usd_pkr_micro: prev.fx_usd_pkr_micro, fx_source: prev.fx_source, fx_at: prev.fx_at };
  if (!quote) return { fx_usd_pkr_micro: null, fx_source: null, fx_at: null };
  const snap = snapshotFromQuote(quote);
  return { fx_usd_pkr_micro: snap.usd_pkr_micro, fx_source: snap.source, fx_at: snap.at };
}

function ExpenseForm({ expense, accounts, onClose }: { expense: Expense | null; accounts: { id: string; title: string }[]; onClose: () => void }) {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const [f, setF] = useState({
    date: expense?.incurred_at ?? todayIso(),
    amount: expense ? minorToDecimalString(expense.amount_minor, expense.currency) : "",
    currency: (expense?.currency ?? "PKR") as Currency,
    category: expense?.category ?? "advertising",
    description: expense?.description ?? "",
    account_id: expense?.account_id ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const { quote } = useFx();
  return (
    <Modal title={expense ? "Edit expense" : "Add expense"} icon="expenses" onClose={onClose}>
      <div className="form-grid">
        <Field label="Date *"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Category *">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Expense["category"] })}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Amount *"><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Currency *">
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <div className="full">
          <FxPreview amount={f.amount} currency={f.currency} label="Expense" />
          {f.currency === "USD" && <small className="hint">The reference rate is saved with this expense for your PKR-equivalent reports.</small>}
        </div>
        <Field label="Description" className="full"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Related account" className="full">
          <select value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
            <option value="">None</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </Field>
      </div>
      {err && <div className="notice bad">{err}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setErr(null);
            try {
              const args = {
                id: expense?.id,
                expected_rev: svc.kind === "web" ? expense?.rev : undefined,
                expense: { incurred_at: f.date, amount_minor: parseMoney(f.amount, f.currency), currency: f.currency, category: f.category, description: f.description, account_id: f.account_id || null, sale_id: expense?.sale_id ?? null },
              };
              Object.assign(args.expense, expenseFx(args.expense, expense, quote));
              const ok = await run(() => svc.exec("saveExpense", args), "Expense saved");
              if (ok !== undefined) onClose();
            } catch (e) {
              setErr(errMsg(e));
            }
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
