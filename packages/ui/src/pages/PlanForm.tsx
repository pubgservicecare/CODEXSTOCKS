import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addDays,
  addMonths,
  autoSchedule,
  computePlanState,
  CURRENCIES,
  DAILY_EXTRA_PRESETS,
  daysBetween,
  DURATION_PRESETS,
  extraStartDate,
  formatRate,
  fxAgeHours,
  FX_MAX_AUTO_AGE_HOURS,
  installmentLabel,
  INTERVAL_PRESETS,
  isCalendarDate,
  localDate,
  minorToDecimalString,
  newId,
  parseMoney,
  parseUsdPkr,
  PAY_METHOD_LABELS,
  PAY_METHODS,
  SALE_CHANNELS,
  splitPrincipal,
  validatePlan,
  type Account,
  type Currency,
  type ExtraEnd,
  type FineMode,
  type PayMethod,
  type PlanCore,
  type PlanTerms,
  type ScheduleItem,
} from "@codex/shared";
import { errMsg, Field, Loading, Notice, useApp, useLoad } from "../components";
import { Icon } from "../icons";
import { fmtFxTime, FxRateLine, useFx } from "../fx-ui";
import { day, fmt } from "../finance-ui";
import { canMarkSold, resolveSaleFx } from "./MarkSold";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", website: "Website", direct: "Direct / in person", other: "Other" };

interface Draft {
  customer_name: string;
  customer_phone: string;
  customer_whatsapp: string;
  account_ref: string;
  price: string;
  currency: Currency;
  rate: string;
  rateReason: string;
  staleConfirmed: boolean;
  channel: string;
  start_on: string;
  advance: string;
  advance_on: string;
  advance_received: boolean;
  advance_method: PayMethod;
  advance_reference: string;
  mode: "auto" | "manual";
  duration: string; // "3" | "6" | "9" | "12" | "custom"
  duration_days: string;
  count: string;
  countTouched: boolean;
  interval: string; // preset or "custom"
  interval_custom: string;
  first_due_on: string;
  firstTouched: boolean;
  manual: { due_on: string; amount: string }[];
  extra: string; // preset number, "0" or "custom"
  extra_custom: string;
  extra_free_days: string;
  extra_end: ExtraEnd;
  extra_end_on: string;
  extra_days: string;
  fine: string;
  fine_mode: FineMode;
  fine_grace_days: string;
  payment_notes: string;
  agreement_ref: string;
  agreement_notes: string;
}

const money = (s: string, c: Currency) => (s.trim() ? parseMoney(s, c) : 0);

/** Everything the preview and the save need, or an error message. */
function build(f: Draft) {
  const c = f.currency;
  const original = money(f.price, c);
  if (original <= 0) throw new Error("Enter the original account price");
  const advance = money(f.advance, c);
  if (!isCalendarDate(f.start_on)) throw new Error("Enter the plan start date");
  const interval = f.interval === "custom" ? Number(f.interval_custom) : Number(f.interval);
  const rest = original - advance;
  let schedule: ScheduleItem[];
  if (f.mode === "auto") {
    const count = Number(f.count);
    if (!Number.isInteger(count) || count < 1) throw new Error("Enter the number of installments");
    if (!Number.isInteger(interval) || interval < 1) throw new Error("Choose the interval between installments");
    if (!isCalendarDate(f.first_due_on)) throw new Error("Enter the first due date");
    if (rest <= 0) throw new Error("The advance must be less than the price");
    schedule = autoSchedule({ first_due_on: f.first_due_on, count, interval_days: interval, principal_minor: rest });
  } else {
    if (!f.manual.length) throw new Error("Add the installments");
    schedule = f.manual.map((r, i) => {
      if (!isCalendarDate(r.due_on)) throw new Error(`Installment ${i + 1}: enter its date`);
      return { n: i + 1, due_on: r.due_on, principal_minor: money(r.amount, c) };
    });
  }
  const extraRate = f.extra === "custom" ? money(f.extra_custom, c) : Number(f.extra) * 100;
  const terms: PlanTerms = {
    original_minor: original,
    advance_minor: advance,
    start_on: f.start_on,
    extra_rate_minor: extraRate,
    extra_free_days: Number(f.extra_free_days || 0),
    extra_end: f.extra_end,
    extra_end_on: f.extra_end === "date" ? f.extra_end_on || null : null,
    extra_days: f.extra_end === "days" ? Number(f.extra_days || 0) : null,
    fine_minor: money(f.fine, c),
    fine_mode: f.fine_mode,
    fine_grace_days: Number(f.fine_grace_days || 0),
  };
  validatePlan(terms, schedule);
  const core: PlanCore = { terms, advance_due_on: advance ? f.advance_on || f.start_on : null, schedule, payments: [], waivers: [], cancelled_on: null };
  return { terms, schedule, interval: f.mode === "auto" ? interval : Number.isInteger(interval) && interval > 0 ? interval : null, state: computePlanState(core, f.start_on) };
}

export function PlanForm() {
  const { accountId } = useParams() as { accountId: string };
  const { svc } = useApp();
  const { data: account, error, loading } = useLoad(() => svc.bundle(accountId).then((b) => b?.account ?? null), [accountId]);
  if (!account) return <Loading error={error ?? (!loading ? "Account not found" : null)} loading={loading} />;
  if (!canMarkSold(account))
    return <Notice kind="warn">This account is {account.status}; only available or reserved accounts can be sold. <Link to={`/accounts/${account.id}`}>Back to the account</Link></Notice>;
  return <PlanFormInner account={account} />;
}

function PlanFormInner({ account: a }: { account: Account }) {
  const { svc, toast } = useApp();
  const nav = useNavigate();
  const { quote } = useFx();
  const [ids] = useState(() => ({ sale: newId(), plan: newId(), receipt: newId(), advance: newId() }));
  const today = localDate();
  const [f, setF] = useState<Draft>({
    customer_name: "",
    customer_phone: "",
    customer_whatsapp: "",
    account_ref: a.id.slice(-8).toUpperCase(),
    price: "",
    currency: (a.list_currency ?? a.purchase_currency) as Currency,
    rate: "",
    rateReason: "",
    staleConfirmed: false,
    channel: "whatsapp",
    start_on: today,
    advance: "",
    advance_on: today,
    advance_received: true,
    advance_method: "cash",
    advance_reference: "",
    mode: "auto",
    duration: "3",
    duration_days: "90",
    count: "3",
    countTouched: false,
    interval: "30",
    interval_custom: "",
    first_due_on: addDays(today, 30),
    firstTouched: false,
    manual: [{ due_on: addDays(today, 30), amount: "" }],
    extra: "0",
    extra_custom: "",
    extra_free_days: "30",
    extra_end: "final_due",
    extra_end_on: "",
    extra_days: "",
    fine: "",
    fine_mode: "flat",
    fine_grace_days: "0",
    payment_notes: "",
    agreement_ref: "",
    agreement_notes: "",
  });
  const up = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }));
  const [step, setStep] = useState<"form" | "review">("form");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const interval = f.interval === "custom" ? Number(f.interval_custom) : Number(f.interval);
  const durationDays = f.duration === "custom" ? Number(f.duration_days) : daysBetween(f.start_on, addMonths(f.start_on, Number(f.duration)));
  // Suggested count and first date follow duration/interval until the owner types their own.
  useEffect(() => {
    if (!f.countTouched && interval > 0 && durationDays > 0) setF((x) => ({ ...x, count: String(Math.max(1, Math.floor(durationDays / interval))) }));
    if (!f.firstTouched && interval > 0 && isCalendarDate(f.start_on)) setF((x) => ({ ...x, first_due_on: addDays(x.start_on, interval) }));
  }, [interval, durationDays, f.start_on, f.countTouched, f.firstTouched]);
  useEffect(() => {
    if (quote) setF((x) => (x.rate ? x : { ...x, rate: formatRate(quote.usd_pkr_micro) }));
  }, [quote]);

  const needsRate = f.currency === "USD" || a.purchase_currency === "USD";
  let built: ReturnType<typeof build> | null = null;
  let buildErr: string | null = null;
  try {
    built = build(f);
  } catch (e) {
    buildErr = errMsg(e);
  }
  const c = f.currency;

  const manualDiff = useMemo(() => {
    try {
      const rest = money(f.price, c) - money(f.advance, c);
      return rest - f.manual.reduce((s, r) => s + money(r.amount, c), 0);
    } catch {
      return null;
    }
  }, [f.manual, f.price, f.advance, c]);

  const fillEqual = () => {
    try {
      const rest = money(f.price, c) - money(f.advance, c);
      const parts = splitPrincipal(rest, f.manual.length);
      up({ manual: f.manual.map((r, i) => ({ ...r, amount: minorToDecimalString(parts[i], c) })) });
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const review = () => {
    setErr(null);
    try {
      if (!f.customer_name.trim()) throw new Error("Enter the customer's name");
      build(f);
      resolveSaleFx({ purchase: a.purchase_currency, sale: f.currency, rateInput: f.rate, quote, reason: f.rateReason, staleConfirmed: f.staleConfirmed, now: new Date() });
      setStep("review");
      window.scrollTo?.({ top: 0 });
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const save = async () => {
    if (busy || !built) return;
    setBusy(true);
    setErr(null);
    try {
      const fx = resolveSaleFx({ purchase: a.purchase_currency, sale: f.currency, rateInput: f.rate, quote, reason: f.rateReason, staleConfirmed: f.staleConfirmed, now: new Date() });
      const startAt = new Date(`${f.start_on}T${new Date().toTimeString().slice(0, 8)}`);
      const t = built.terms;
      try {
        await svc.exec("createInstallmentSale", {
          sale: { id: ids.sale, account_id: a.id, sold_at: startAt.toISOString(), ...fx, channel: f.channel, reference: f.agreement_ref.trim() || "Installment plan", notes: null },
          currency: f.currency,
          plan_id: ids.plan,
          receipt_id: ids.receipt,
          issued_on: localDate(),
          plan: {
            customer_name: f.customer_name,
            customer_phone: f.customer_phone || null,
            customer_whatsapp: f.customer_whatsapp || null,
            account_ref: f.account_ref || null,
            original_minor: t.original_minor,
            advance_minor: t.advance_minor,
            advance_due_on: t.advance_minor ? f.advance_on : null,
            start_on: f.start_on,
            duration_months: f.duration === "custom" ? null : Number(f.duration),
            duration_days: f.duration === "custom" ? Number(f.duration_days) || null : null,
            schedule_mode: f.mode,
            interval_days: built.interval,
            first_due_on: built.schedule[0].due_on,
            schedule: built.schedule,
            extra_rate_minor: t.extra_rate_minor,
            extra_free_days: t.extra_free_days,
            extra_end: t.extra_end,
            extra_end_on: t.extra_end_on,
            extra_days: t.extra_days,
            fine_minor: t.fine_minor,
            fine_mode: t.fine_mode,
            fine_grace_days: t.fine_grace_days,
            payment_notes: f.payment_notes,
            agreement_ref: f.agreement_ref || null,
            agreement_notes: f.agreement_notes,
          },
          advance_payment:
            t.advance_minor > 0 && f.advance_received
              ? { id: ids.advance, paid_on: f.advance_on, amount_minor: t.advance_minor, currency: f.currency, method: f.advance_method, reference: f.advance_reference || null, notes: null, pkr_micro: f.currency === "USD" ? (fx.fx_usd_pkr_micro ?? null) : null, pkr_source: f.currency === "USD" && fx.fx_usd_pkr_micro ? (fx.fx_source ?? "manual") : null, pkr_at: f.currency === "USD" && fx.fx_usd_pkr_micro ? (fx.fx_at ?? null) : null }
              : null,
        });
      } catch (e) {
        if ((e as { code?: string }).code !== "exists") throw e;
      }
      toast(svc.kind === "desktop" ? "Installment plan saved · account sold (syncs automatically)" : "Installment plan saved · account sold");
      nav(`/payments/plans/${ids.plan}?receipt=plan`, { replace: true });
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  const preview = built ? <SchedulePreview built={built} currency={c} intervalDays={built.interval} /> : <Notice kind="info">{buildErr}</Notice>;

  if (step === "review" && built)
    return (
      <>
        <div className="cx-page-head">
          <div>
            <h1>Confirm installment plan</h1>
            <p>{a.title}. Check everything with the customer — the plan is saved exactly as shown and only you can change it later (every change is kept in the plan history).</p>
          </div>
        </div>
        <div className="split">
          <div className="card">
            <dl className="kv">
              <dt>Customer</dt><dd><b>{f.customer_name}</b> {[f.customer_phone, f.customer_whatsapp].filter(Boolean).join(" · ")}</dd>
              <dt>Original price</dt><dd><b>{fmt(built.terms.original_minor, c)}</b></dd>
              <dt>Advance</dt><dd>{built.terms.advance_minor ? `${fmt(built.terms.advance_minor, c)} · ${f.advance_received ? `received ${day(f.advance_on)} (${PAY_METHOD_LABELS[f.advance_method]})` : `pending, due ${day(f.advance_on)}`}` : "None"}</dd>
              <dt>Remaining</dt><dd>{fmt(built.terms.original_minor - built.terms.advance_minor, c)} in {built.schedule.length} installment(s)</dd>
              <dt>Daily Extra</dt><dd>{built.terms.extra_rate_minor ? `${fmt(built.terms.extra_rate_minor, c)}/day after ${built.terms.extra_free_days} free days (from ${day(extraStartDate(built.terms))})` : "None"}</dd>
              <dt>Late fine</dt><dd>{built.terms.fine_minor ? `${fmt(built.terms.fine_minor, c)} ${built.terms.fine_mode === "per_day" ? "per day" : "once"} after ${built.terms.fine_grace_days} grace day(s)` : "None"}</dd>
              <dt>Grand total</dt><dd><b className="big">{fmt(built.state.totals.grand_total, c)}</b> <span className="small faint">price + Daily Extra (late fines only if late)</span></dd>
            </dl>
            <label className="check" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I agreed this plan with the customer. Saving marks the account SOLD at the original price (counted once) and removes it from the website.
            </label>
            {err && <Notice kind="bad">{err}</Notice>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setStep("form")} disabled={busy}><Icon name="chevronLeft" size={15} /> Back</button>
              <button className="btn primary confirm-sale" disabled={!confirmed || busy} onClick={() => void save()}><Icon name="check" size={16} /> {busy ? "Saving…" : "CONFIRM PLAN"}</button>
            </div>
          </div>
          <div className="card">{preview}</div>
        </div>
      </>
    );

  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Sell on installments</h1>
          <p>
            <b>{a.title}</b> · listing price {a.list_price_minor !== null && a.list_currency ? fmt(a.list_price_minor, a.list_currency) : "—"} · purchase cost {fmt(a.purchase_cost_minor, a.purchase_currency)}
          </p>
        </div>
        <span className="spacer" />
        <Link className="btn ghost" to={`/accounts/${a.id}`}>Cancel</Link>
      </div>
      <form className="plan-form" onSubmit={(e) => (e.preventDefault(), review())}>
        <section className="card form-card">
          <h2>Customer</h2>
          <div className="form-grid">
            <Field label="Customer name *"><input value={f.customer_name} onChange={(e) => up({ customer_name: e.target.value })} maxLength={200} autoFocus autoComplete="off" /></Field>
            <Field label="Phone" optional><input value={f.customer_phone} onChange={(e) => up({ customer_phone: e.target.value })} maxLength={40} inputMode="tel" autoComplete="off" /></Field>
            <Field label="WhatsApp" optional hint="Used to send receipts"><input value={f.customer_whatsapp} onChange={(e) => up({ customer_whatsapp: e.target.value })} maxLength={40} inputMode="tel" autoComplete="off" /></Field>
            <Field label="Account reference" optional><input value={f.account_ref} onChange={(e) => up({ account_ref: e.target.value })} maxLength={100} /></Field>
          </div>
        </section>

        <section className="card form-card">
          <h2>Price & advance</h2>
          <div className="form-grid">
            <Field label="Original account price *" hint="The full agreed price. The advance is part of it.">
              <div className="input-row">
                <input value={f.price} onChange={(e) => up({ price: e.target.value })} inputMode="decimal" placeholder="e.g. 100000" />
                {a.list_price_minor !== null && a.list_currency === f.currency && (
                  <button type="button" className="btn sm ghost" onClick={() => up({ price: minorToDecimalString(a.list_price_minor!, f.currency) })}>Listing price</button>
                )}
              </div>
            </Field>
            <Field label="Price currency *" hint="Every amount of this plan uses this currency.">
              <select value={f.currency} onChange={(e) => up({ currency: e.target.value as Currency })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</select>
            </Field>
            {needsRate && (
              <div className="full sale-fx">
                <Field label="Exchange rate * · PKR per 1 USD" hint={quote ? <>Reference: <FxRateLine quote={quote} />. Saved with the sale.</> : "No reference rate available. Enter the rate you used."}>
                  <input value={f.rate} onChange={(e) => up({ rate: e.target.value, staleConfirmed: false })} inputMode="decimal" />
                </Field>
                {quote && (() => {
                  let typed: number | null = null;
                  try {
                    typed = f.rate.trim() ? parseUsdPkr(f.rate) : null;
                  } catch {
                    typed = null;
                  }
                  const manual = typed !== null && typed !== quote.usd_pkr_micro;
                  return (
                    <>
                      {manual && <Field label="Reason for this rate *"><input value={f.rateReason} onChange={(e) => up({ rateReason: e.target.value })} maxLength={500} /></Field>}
                      {!manual && fxAgeHours(quote, new Date()) > FX_MAX_AUTO_AGE_HOURS && (
                        <label className="check"><input type="checkbox" checked={f.staleConfirmed} onChange={(e) => up({ staleConfirmed: e.target.checked })} /> This saved rate is from {fmtFxTime(quote)} — use it anyway</label>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            <Field label="Plan start date (Day 0) *"><input type="date" value={f.start_on} onChange={(e) => up({ start_on: e.target.value })} /></Field>
            <Field label="Sold via"><select value={f.channel} onChange={(e) => up({ channel: e.target.value })}>{SALE_CHANNELS.map((x) => <option key={x} value={x}>{CHANNEL_LABEL[x] ?? x}</option>)}</select></Field>
            <Field label="Advance amount" optional hint="0 or empty = no advance"><input value={f.advance} onChange={(e) => up({ advance: e.target.value })} inputMode="decimal" placeholder="0" /></Field>
            <Field label="Advance date"><input type="date" value={f.advance_on} onChange={(e) => up({ advance_on: e.target.value })} /></Field>
            {money(f.advance || "0", c) > 0 && (
              <>
                <div className="full">
                  <div className="seg" role="group" aria-label="Advance status">
                    <button type="button" className={f.advance_received ? "on" : ""} aria-pressed={f.advance_received} onClick={() => up({ advance_received: true })}>Received now</button>
                    <button type="button" className={!f.advance_received ? "on" : ""} aria-pressed={!f.advance_received} onClick={() => up({ advance_received: false })}>Pending</button>
                  </div>
                </div>
                {f.advance_received && (
                  <>
                    <Field label="Advance paid by"><select value={f.advance_method} onChange={(e) => up({ advance_method: e.target.value as PayMethod })}>{PAY_METHODS.map((x) => <option key={x} value={x}>{PAY_METHOD_LABELS[x]}</option>)}</select></Field>
                    <Field label="Transaction reference" optional><input value={f.advance_reference} onChange={(e) => up({ advance_reference: e.target.value })} maxLength={200} /></Field>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        <section className="card form-card">
          <h2>Installments</h2>
          <div className="seg" role="group" aria-label="Schedule mode" style={{ marginBottom: 12 }}>
            <button type="button" className={f.mode === "auto" ? "on" : ""} aria-pressed={f.mode === "auto"} onClick={() => up({ mode: "auto" })}>Automatic dates</button>
            <button type="button" className={f.mode === "manual" ? "on" : ""} aria-pressed={f.mode === "manual"} onClick={() => up({ mode: "manual", manual: built ? built.schedule.map((s) => ({ due_on: s.due_on, amount: minorToDecimalString(s.principal_minor, c) })) : f.manual })}>Enter each date</button>
          </div>
          <div className="form-grid">
            <Field label="Duration">
              <div className="input-row">
                <select value={f.duration} onChange={(e) => up({ duration: e.target.value })}>
                  {DURATION_PRESETS.map((m) => <option key={m} value={m}>{m} months</option>)}
                  <option value="custom">Custom (days)</option>
                </select>
                {f.duration === "custom" && <input value={f.duration_days} onChange={(e) => up({ duration_days: e.target.value })} inputMode="numeric" aria-label="Duration in days" style={{ width: 110 }} />}
              </div>
            </Field>
            <Field label="Interval between installments" hint={f.mode === "manual" ? "Used when you later re-space dates" : undefined}>
              <div className="input-row">
                <select value={f.interval} onChange={(e) => up({ interval: e.target.value })}>
                  {INTERVAL_PRESETS.map((d) => <option key={d} value={d}>Every {d} days</option>)}
                  <option value="custom">Custom days</option>
                </select>
                {f.interval === "custom" && <input value={f.interval_custom} onChange={(e) => up({ interval_custom: e.target.value })} inputMode="numeric" aria-label="Interval in days" style={{ width: 90 }} />}
              </div>
            </Field>
            {f.mode === "auto" ? (
              <>
                <Field label="Number of installments *" hint="Separate from the duration (e.g. 3 installments every 20 days)">
                  <input value={f.count} onChange={(e) => up({ count: e.target.value, countTouched: true })} inputMode="numeric" />
                </Field>
                <Field label="First due date *">
                  <input type="date" value={f.first_due_on} min={f.start_on} onChange={(e) => up({ first_due_on: e.target.value, firstTouched: true })} />
                </Field>
              </>
            ) : (
              <div className="full manual-rows">
                {f.manual.map((r, i) => (
                  <div className="manual-row" key={i}>
                    <span className="n">{installmentLabel(interval, i + 1)}</span>
                    <input type="date" value={r.due_on} onChange={(e) => up({ manual: f.manual.map((x, j) => (j === i ? { ...x, due_on: e.target.value } : x)) })} aria-label={`Installment ${i + 1} date`} />
                    <input value={r.amount} onChange={(e) => up({ manual: f.manual.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} inputMode="decimal" placeholder="Amount" aria-label={`Installment ${i + 1} amount`} />
                    <button type="button" className="btn ghost sm icon-only" aria-label="Remove" disabled={f.manual.length === 1} onClick={() => up({ manual: f.manual.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                  </div>
                ))}
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn sm" onClick={() => up({ manual: [...f.manual, { due_on: addDays(f.manual[f.manual.length - 1]?.due_on || f.start_on, interval > 0 ? interval : 30), amount: "" }] })}><Icon name="plus" size={14} /> Add installment</button>
                  <button type="button" className="btn sm ghost" onClick={fillEqual}>Split remaining equally</button>
                  {manualDiff !== null && manualDiff !== 0 && <span className="small" style={{ color: "var(--warn)" }}>Still to allocate: {fmt(manualDiff, c)}</span>}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card form-card">
          <h2>Daily Extra</h2>
          <p className="small muted">A per-day amount added to the NEXT installment (not collected at the end). No day is charged twice; paying everything early stops it.</p>
          <div className="seg" role="group" aria-label="Daily Extra per day">
            <button type="button" className={f.extra === "0" ? "on" : ""} onClick={() => up({ extra: "0" })}>None</button>
            {DAILY_EXTRA_PRESETS.map((v) => <button type="button" key={v} className={f.extra === String(v) ? "on" : ""} onClick={() => up({ extra: String(v) })}>{v}/day</button>)}
            <button type="button" className={f.extra === "custom" ? "on" : ""} onClick={() => up({ extra: "custom" })}>Custom</button>
          </div>
          {f.extra !== "0" && (
            <div className="form-grid" style={{ marginTop: 12 }}>
              {f.extra === "custom" && <Field label={`Per day (${c}) *`}><input value={f.extra_custom} onChange={(e) => up({ extra_custom: e.target.value })} inputMode="decimal" /></Field>}
              <Field label="Free period (days)" hint={isCalendarDate(f.start_on) ? `Charging starts ${day(extraStartDate({ start_on: f.start_on, extra_free_days: Number(f.extra_free_days || 0) }))}` : undefined}>
                <input value={f.extra_free_days} onChange={(e) => up({ extra_free_days: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label="Charged until">
                <select value={f.extra_end} onChange={(e) => up({ extra_end: e.target.value as ExtraEnd })}>
                  <option value="final_due">The final installment date</option>
                  <option value="date">A date</option>
                  <option value="days">A number of days</option>
                  <option value="paid">Fully paid</option>
                </select>
              </Field>
              {f.extra_end === "date" && <Field label="End date *"><input type="date" value={f.extra_end_on} onChange={(e) => up({ extra_end_on: e.target.value })} /></Field>}
              {f.extra_end === "days" && <Field label="Charged for (days) *"><input value={f.extra_days} onChange={(e) => up({ extra_days: e.target.value })} inputMode="numeric" /></Field>}
            </div>
          )}
        </section>

        <section className="card form-card">
          <h2>Late fine</h2>
          <p className="small muted">Separate from Daily Extra. Charged when an installment is not fully paid by its due date + grace days.</p>
          <div className="form-grid">
            <Field label={`Fine (${c})`} optional hint="e.g. 1500"><input value={f.fine} onChange={(e) => up({ fine: e.target.value })} inputMode="decimal" /></Field>
            <Field label="How it is charged">
              <select value={f.fine_mode} onChange={(e) => up({ fine_mode: e.target.value as FineMode })}>
                <option value="flat">Once per late installment</option>
                <option value="per_day">Per day late</option>
              </select>
            </Field>
            <Field label="Grace period (days)"><input value={f.fine_grace_days} onChange={(e) => up({ fine_grace_days: e.target.value })} inputMode="numeric" /></Field>
          </div>
        </section>

        <section className="card form-card">
          <h2>Agreement</h2>
          <div className="form-grid">
            <Field label="Agreement reference" optional><input value={f.agreement_ref} onChange={(e) => up({ agreement_ref: e.target.value })} maxLength={200} /></Field>
            <Field label="Payment notes" optional><input value={f.payment_notes} onChange={(e) => up({ payment_notes: e.target.value })} maxLength={4000} placeholder="e.g. pays by JazzCash" /></Field>
            <Field label="Agreement notes" optional className="full"><textarea rows={2} value={f.agreement_notes} onChange={(e) => up({ agreement_notes: e.target.value })} maxLength={4000} /></Field>
          </div>
        </section>

        <section className="card form-card">
          <h2>Schedule preview</h2>
          {preview}
        </section>

        {err && <Notice kind="bad">{err}</Notice>}
        <div className="action-bar">
          <span className="small muted">{built ? `${built.schedule.length} installment(s) · grand total ${fmt(built.state.totals.grand_total, c)}` : "Complete the plan"}</span>
          <span className="spacer" />
          <button className="btn primary"><Icon name="chevronRight" size={15} /> Review plan</button>
        </div>
      </form>
    </>
  );
}

/** Installment table: qist + Daily Extra (added to the next installment) = total, with the plan totals. */
export function SchedulePreview({ built, currency: c, intervalDays }: { built: ReturnType<typeof build>; currency: Currency; intervalDays: number | null }) {
  const s = built.state;
  return (
    <>
      <div className="table-wrap">
        <table className="fin-table schedule-table">
          <thead><tr><th>#</th><th>Due date</th><th>Period</th><th className="num">Qist</th><th className="num">Daily Extra</th><th className="num">Total</th></tr></thead>
          <tbody>
            {s.entries.slice(1).map((e) => (
              <tr key={e.n}>
                <td>{installmentLabel(intervalDays, e.n)}</td>
                <td>{day(e.due_on)}</td>
                <td className="small muted">{e.period_from ? `${day(e.period_from)} – ${day(e.due_on)}` : ""}</td>
                <td className="num">{fmt(e.principal, c)}</td>
                <td className="num">{built.terms.extra_rate_minor && !e.extra ? <span className="maaf">0 / Maaf</span> : e.extra ? <>{fmt(e.extra, c)}<div className="small faint">{e.extra_days} day{e.extra_days === 1 ? "" : "s"}</div></> : "—"}</td>
                <td className="num"><b>{fmt(e.due_total, c)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="plan-totals">
        <div><span>Total Asal (price)</span><b>{fmt(s.totals.principal, c)}</b></div>
        <div><span>Advance</span><b>{fmt(built.terms.advance_minor, c)}</b></div>
        <div><span>Remaining qist</span><b>{fmt(built.terms.original_minor - built.terms.advance_minor, c)}</b></div>
        <div><span>Extra (Daily Extra)</span><b>{fmt(s.totals.extra, c)}</b></div>
        <div className="grand"><span>Grand total</span><b>{fmt(s.totals.grand_total, c)}</b></div>
      </div>
    </>
  );
}
