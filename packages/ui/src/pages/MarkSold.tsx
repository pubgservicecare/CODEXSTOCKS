import { useEffect, useState } from "react";
import {
  convertMinor,
  convertUsdPkr,
  CURRENCIES,
  formatMoney,
  formatRate,
  formatUsdPkr,
  FX_MAX_AUTO_AGE_HOURS,
  FX_SOURCE_MANUAL,
  fxAgeHours,
  newId,
  otherCurrency,
  parseMoney,
  parseUsdPkr,
  saleRateFromUsdPkr,
  SALE_CHANNELS,
  type Account,
  type Currency,
  type FxQuote,
  type Sale,
} from "@codex/shared";
import { errMsg, Field, Modal, Money, Notice, useApp } from "../components";
import { Icon } from "../icons";
import { fmtFxTime, FxRateLine, useFx } from "../fx-ui";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", website: "Website", direct: "Direct / in person", other: "Other" };

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function canMarkSold(a: Pick<Account, "status" | "deleted">): boolean {
  return !a.deleted && (a.status === "available" || a.status === "reserved");
}

/**
 * Expected profit of this one sale: amount received minus the purchase cost, with the cost converted
 * into the sale currency at the rate the owner enters (same rule as costInSaleCurrency in reports).
 * Returns null when it cannot be calculated honestly (no rate for a cross-currency sale).
 */
export function expectedProfit(a: Pick<Account, "purchase_cost_minor" | "purchase_currency">, amountMinor: number, currency: Currency, rateMicro: number | null): number | null {
  if (currency === a.purchase_currency) return amountMinor - a.purchase_cost_minor;
  if (!rateMicro) return null;
  return amountMinor - convertMinor(a.purchase_cost_minor, rateMicro);
}

export type SaleFx = Pick<Sale, "exchange_rate_micro" | "fx_usd_pkr_micro" | "fx_source" | "fx_at" | "fx_override_reason">;

/**
 * The exchange-rate snapshot saved with a sale. A rate is needed whenever USD is involved (sale or
 * purchase currency). The reference quote is used as-is; any other typed rate is a MANUAL override and
 * needs a reason. A quote older than FX_MAX_AUTO_AGE_HOURS (e.g. cached on an offline PC) needs an
 * explicit confirmation. The saved values are exactly what the owner saw — never recalculated later.
 */
export function resolveSaleFx(o: {
  purchase: Currency;
  sale: Currency;
  rateInput: string;
  quote: FxQuote | null;
  reason: string;
  staleConfirmed: boolean;
  now: Date;
}): SaleFx {
  const needsRate = o.sale === "USD" || o.purchase === "USD";
  if (!needsRate) {
    // PKR sale of a PKR purchase: no conversion involved; the reference rate is kept for information only.
    return o.quote
      ? { exchange_rate_micro: null, fx_usd_pkr_micro: o.quote.usd_pkr_micro, fx_source: o.quote.source, fx_at: o.quote.effective_at ?? o.quote.retrieved_at, fx_override_reason: null }
      : { exchange_rate_micro: null, fx_usd_pkr_micro: null, fx_source: null, fx_at: null, fx_override_reason: null };
  }
  if (!o.rateInput.trim()) throw new Error("Enter the USD/PKR exchange rate (PKR per 1 USD) for this sale");
  const micro = parseUsdPkr(o.rateInput);
  const manual = !o.quote || micro !== o.quote.usd_pkr_micro;
  let snap: Pick<SaleFx, "fx_source" | "fx_at" | "fx_override_reason">;
  if (manual) {
    if (o.reason.trim().length < 3) throw new Error("Give a reason for the exchange rate you entered (for example, the rate you were actually paid at)");
    snap = { fx_source: FX_SOURCE_MANUAL, fx_at: o.now.toISOString(), fx_override_reason: o.reason.trim() };
  } else {
    const q = o.quote!;
    if (fxAgeHours(q, o.now) > FX_MAX_AUTO_AGE_HOURS && !o.staleConfirmed)
      throw new Error(`The saved reference rate is from ${fmtFxTime(q)}. Confirm that you want to use it, or enter the rate you actually used.`);
    snap = { fx_source: q.source, fx_at: q.effective_at ?? q.retrieved_at, fx_override_reason: null };
  }
  return { exchange_rate_micro: saleRateFromUsdPkr(o.purchase, o.sale, micro), fx_usd_pkr_micro: micro, ...snap };
}

interface Draft {
  amount: string;
  currency: Currency;
  rate: string;
  soldAt: string;
  channel: string;
  buyer_name: string;
  buyer_contact: string;
  reference: string;
  notes: string;
  reason: string;
  staleConfirmed: boolean;
}

/**
 * Mark as Sold: the owner enters the ACTUAL amount received (never pre-filled from the listing price),
 * reviews cost and profit, then confirms. One atomic recordSale command saves the sale, marks the
 * account sold, unpublishes it and writes the audit event — on the desktop offline too (synced later).
 */
export function MarkSoldDialog({ account: a, onClose, onSold }: { account: Account; onClose: () => void; onSold?: () => void }) {
  const { svc, toast } = useApp();
  // One id per dialog: a repeated or retried submission can never create a second sale.
  const [saleId] = useState(newId);
  const [step, setStep] = useState<"form" | "review">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Draft>({
    amount: "",
    currency: (a.list_currency ?? a.purchase_currency) as Currency,
    rate: "",
    soldAt: nowLocal(),
    channel: "whatsapp",
    buyer_name: "",
    buyer_contact: "",
    reference: "",
    notes: "",
    reason: "",
    staleConfirmed: false,
  });
  const up = (p: Partial<Draft>) => setF((x) => ({ ...x, ...p }));
  const cross = f.currency !== a.purchase_currency;
  const { quote } = useFx();
  const needsRate = f.currency === "USD" || a.purchase_currency === "USD";
  // Pre-fill the rate with the reference quote once it is known.
  useEffect(() => {
    if (quote) setF((x) => (x.rate ? x : { ...x, rate: formatRate(quote.usd_pkr_micro) }));
  }, [quote]);
  let typedMicro: number | null = null;
  try {
    typedMicro = f.rate.trim() ? parseUsdPkr(f.rate) : null;
  } catch {
    typedMicro = null;
  }
  const manual = needsRate && typedMicro !== null && (!quote || typedMicro !== quote.usd_pkr_micro);
  const old = !!quote && !manual && fxAgeHours(quote, new Date()) > FX_MAX_AUTO_AGE_HOURS;

  const parse = () => {
    if (!f.amount.trim()) throw new Error("Enter the actual amount you received");
    const amount_minor = parseMoney(f.amount, f.currency);
    if (amount_minor <= 0) throw new Error("The sold amount must be greater than zero");
    if (!f.soldAt || Number.isNaN(new Date(f.soldAt).getTime())) throw new Error("Enter a valid sale date and time");
    const fx = resolveSaleFx({ purchase: a.purchase_currency, sale: f.currency, rateInput: f.rate, quote, reason: f.reason, staleConfirmed: f.staleConfirmed, now: new Date() });
    return { amount_minor, rate: fx.exchange_rate_micro, fx };
  };

  let parsed: { amount_minor: number; rate: number | null; fx: SaleFx } | null = null;
  try {
    parsed = step === "review" ? parse() : null;
  } catch {
    parsed = null;
  }

  const review = () => {
    setErr(null);
    try {
      parse();
      setStep("review");
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const confirm = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const { amount_minor, fx } = parse();
      try {
        await svc.exec("recordSale", {
          id: saleId,
          account_id: a.id,
          sold_at: new Date(f.soldAt).toISOString(),
          amount_minor,
          currency: f.currency,
          ...fx,
          channel: f.channel,
          buyer_name: f.buyer_name.trim() || null,
          buyer_contact: f.buyer_contact.trim() || null,
          reference: f.reference.trim() || null,
          notes: f.notes.trim() || null,
        });
      } catch (e) {
        // The first attempt was saved but its response was lost: this exact sale already exists.
        if ((e as { code?: string })?.code !== "exists") throw e;
      }
      toast(svc.kind === "desktop" ? "Sale recorded · account marked sold (syncs automatically)" : "Sale recorded · account marked sold");
      onSold?.();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  const profit = parsed ? expectedProfit(a, parsed.amount_minor, f.currency, parsed.rate) : null;
  const costInSale = parsed && cross && parsed.rate ? convertMinor(a.purchase_cost_minor, parsed.rate) : null;

  return (
    <Modal title={step === "form" ? "Mark as Sold" : "Confirm sale"} icon="sales" onClose={busy ? () => undefined : onClose}>
      <div className="sold-account">
        <b>{a.title}</b>
        <span className="small muted">
          Listing price <Money minor={a.list_price_minor} currency={a.list_currency} /> · Purchase cost <Money minor={a.purchase_cost_minor} currency={a.purchase_currency} />
        </span>
      </div>

      {step === "form" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <div className="form-grid">
            <Field label="Actual sold amount *" hint="The money you actually received. The listing price is shown above for reference only.">
              <input value={f.amount} onChange={(e) => up({ amount: e.target.value })} inputMode="decimal" placeholder="Amount received" autoFocus required />
            </Field>
            <Field label="Sale currency *">
              <select value={f.currency} onChange={(e) => up({ currency: e.target.value as Currency })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
            {needsRate && (
              <div className="full sale-fx">
                <Field
                  label="Exchange rate * · PKR per 1 USD"
                  hint={
                    quote ? (
                      <>Reference: <FxRateLine quote={quote} />. Saved with this sale and never changed later.</>
                    ) : (
                      "No reference rate available (offline and none saved yet). Enter the rate you actually used."
                    )
                  }
                >
                  <input value={f.rate} onChange={(e) => up({ rate: e.target.value, staleConfirmed: false })} inputMode="decimal" placeholder="e.g. 278.50" />
                </Field>
                {manual && (
                  <Field label="Reason for this rate *" hint="Required when you use a rate other than the reference rate. Kept with the sale and in its history.">
                    <input value={f.reason} onChange={(e) => up({ reason: e.target.value })} maxLength={500} placeholder="e.g. Buyer paid at the open-market rate" />
                  </Field>
                )}
                {manual && quote && (
                  <button type="button" className="btn sm ghost" onClick={() => up({ rate: formatRate(quote.usd_pkr_micro), reason: "" })}>Use reference rate</button>
                )}
                {old && (
                  <label className="check">
                    <input type="checkbox" checked={f.staleConfirmed} onChange={(e) => up({ staleConfirmed: e.target.checked })} />
                    This saved rate is from {fmtFxTime(quote!)} — use it anyway
                  </label>
                )}
              </div>
            )}
            <AmountFx amount={f.amount} currency={f.currency} usdPkrMicro={typedMicro} />
            <Field label="Sale date and time">
              <input type="datetime-local" value={f.soldAt} onChange={(e) => up({ soldAt: e.target.value })} />
            </Field>
            <Field label="Sold via">
              <select value={f.channel} onChange={(e) => up({ channel: e.target.value })}>{SALE_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c] ?? c}</option>)}</select>
            </Field>
            <Field label="Buyer name" optional><input value={f.buyer_name} onChange={(e) => up({ buyer_name: e.target.value })} maxLength={200} autoComplete="off" /></Field>
            <Field label="Buyer WhatsApp / contact" optional><input value={f.buyer_contact} onChange={(e) => up({ buyer_contact: e.target.value })} maxLength={100} inputMode="tel" autoComplete="off" /></Field>
            <Field label="Payment method / reference" optional className="full"><input value={f.reference} onChange={(e) => up({ reference: e.target.value })} maxLength={200} placeholder="e.g. JazzCash, bank transfer, transaction ID" /></Field>
            <Field label="Sale notes" optional className="full"><textarea rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} maxLength={4000} /></Field>
          </div>
          {err && <Notice kind="bad">{err}</Notice>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary"><Icon name="chevronRight" size={15} /> Review sale</button>
          </div>
        </form>
      ) : (
        <>
          <dl className="kv sale-review">
            <dt>Listing price</dt><dd><Money minor={a.list_price_minor} currency={a.list_currency} /></dd>
            <dt>Purchase cost</dt><dd><Money minor={a.purchase_cost_minor} currency={a.purchase_currency} /></dd>
            <dt>Actual sold amount</dt><dd><b className="big"><Money minor={parsed?.amount_minor ?? null} currency={f.currency} /></b></dd>
            <dt>Sale currency</dt><dd>{f.currency}</dd>
            {needsRate && parsed?.fx.fx_usd_pkr_micro ? (
              <>
                <dt>Exchange rate</dt>
                <dd>
                  {formatUsdPkr(parsed.fx.fx_usd_pkr_micro)}{" "}
                  <span className="small faint">
                    · {parsed.fx.fx_source === FX_SOURCE_MANUAL ? `manual — ${parsed.fx.fx_override_reason}` : `${parsed.fx.fx_source}${quote ? `, ${fmtFxTime(quote)}` : ""}`}
                  </span>
                </dd>
                <dt>In {otherCurrency(f.currency)}</dt>
                <dd>
                  {formatMoney(convertUsdPkr(parsed.amount_minor, f.currency, otherCurrency(f.currency), parsed.fx.fx_usd_pkr_micro), otherCurrency(f.currency))}{" "}
                  <span className="small faint">at this rate</span>
                </dd>
              </>
            ) : null}
            <dt>Sold on</dt><dd>{new Date(f.soldAt).toLocaleString()}</dd>
            {f.buyer_name || f.buyer_contact ? (<><dt>Buyer</dt><dd>{[f.buyer_name, f.buyer_contact].filter(Boolean).join(" · ")}</dd></>) : null}
            <dt>Expected {profit !== null && profit < 0 ? "loss" : "profit"}</dt>
            <dd>
              {profit === null ? <span className="faint">Cannot be calculated</span> : <b className={`big ${profit < 0 ? "neg" : "pos"}`}>{formatMoney(profit, f.currency)}</b>}
            </dd>
          </dl>
          <p className="small muted profit-how">
            <Icon name="info" size={13} /> Profit = actual sold amount − purchase cost
            {costInSale !== null ? ` (${formatMoney(a.purchase_cost_minor, a.purchase_currency)} converted at your rate = ${formatMoney(costInSale, f.currency)})` : ""}.
            Business expenses and any later refund are counted separately in your reports. After confirming, the account is marked SOLD and removed from the website.
          </p>
          {err && <Notice kind="bad">{err}</Notice>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => (setStep("form"), setErr(null))} disabled={busy}><Icon name="chevronLeft" size={15} /> Back</button>
            <button type="button" className="btn primary confirm-sale" onClick={() => void confirm()} disabled={busy}>
              <Icon name="check" size={16} /> {busy ? "Saving sale…" : "CONFIRM SALE"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** "≈ Rs 2,786,000.00 PKR at 1 USD = 278.6 PKR" under the amount, using the rate in the dialog. */
function AmountFx({ amount, currency, usdPkrMicro }: { amount: string; currency: Currency; usdPkrMicro: number | null }) {
  let m: number | null = null;
  try {
    m = amount.trim() ? parseMoney(amount, currency) : null;
  } catch {
    m = null;
  }
  if (m === null || usdPkrMicro === null) return null;
  const to = otherCurrency(currency);
  return (
    <div className="full fx-preview small">
      ≈ {formatMoney(convertUsdPkr(m, currency, to, usdPkrMicro), to)} {to} at {formatUsdPkr(usdPkrMicro)}
    </div>
  );
}
