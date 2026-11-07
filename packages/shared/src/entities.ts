import { z } from "zod";
import { CURRENCIES, MAX_MINOR, PAY_CURRENCIES } from "./money";
import { UUID_RE } from "./ids";
import { EMAIL_RE, PHONE_RE, youtubeId } from "./text";
import { FX_MAX_MICRO, FX_MIN_MICRO, FX_SOURCE_MANUAL } from "./fx";
import { EXTRA_ENDS, FINE_MODES, MAX_INSTALLMENTS, validatePlan, type Allocation, type ScheduleItem } from "./installments";

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const ACCOUNT_STATUSES = ["available", "reserved", "sold", "archived"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const LINK_KINDS = ["social", "phone", "email"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const SOCIAL_PROVIDERS = ["google", "facebook", "apple", "x", "game_center", "whatsapp", "other"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: "Google",
  facebook: "Facebook",
  apple: "Apple",
  x: "X / Twitter",
  game_center: "Game Center",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const LINK_STATUSES = ["active", "inactive", "lost", "pending"] as const;
export const TWO_STEP_METHODS = ["none", "phone", "email", "authenticator", "other"] as const;
export const CODE_STATES = ["unused", "used", "revoked"] as const;
export type CodeState = (typeof CODE_STATES)[number];
export const SALE_STATUSES = ["completed", "refunded", "voided"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];
export const SALE_CHANNELS = ["whatsapp", "website", "direct", "other"] as const;
export const PLAN_STATUSES = ["active", "cancelled"] as const;
export const SCHEDULE_MODES = ["auto", "manual"] as const;
export const PAY_METHODS = ["cash", "bank", "jazzcash", "easypaisa", "usdt", "card", "other"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  cash: "Cash",
  bank: "Bank transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  usdt: "USDT (crypto)",
  card: "Card",
  other: "Other",
};
export const PAYMENT_TARGETS = ["plan", "debt"] as const;
/** advance / installment / settlement belong to plans; receive / pay to money owed to or by the owner. */
export const PAYMENT_KINDS = ["advance", "installment", "settlement", "receive", "pay"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_STATUSES = ["recorded", "reversed"] as const;
export const DEBT_DIRECTIONS = ["receive", "pay"] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];
export const DEBT_STATUSES = ["open", "cancelled"] as const;
export const RECEIPT_KINDS = ["plan", "payment"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
/** "PP-261103-7F3A2C" (payment plan), "PR-..." (payment received), "PM-..." (money to receive / to pay). */
export const RECEIPT_NO_RE = /^(PP|PR|PM)-\d{6}-[0-9A-F]{6}$/;

export const EXPENSE_CATEGORIES = [
  "advertising",
  "hosting_software",
  "transaction_fees",
  "account_recovery",
  "equipment",
  "salary_services",
  "other",
] as const;

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

export const idSchema = z.string().regex(UUID_RE, "Invalid id");
export const isoSchema = z
  .string()
  .max(40)
  .refine((s) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)), "Invalid timestamp");
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
export const currencySchema = z.enum(CURRENCIES);
export const payCurrencySchema = z.enum(PAY_CURRENCIES);
export const minorSchema = z.number().int("Amount must be whole minor units").min(0).max(MAX_MINOR);
export const optText = (max: number) => z.string().max(max).nullable();
export const phoneSchema = z.string().max(30).regex(PHONE_RE, "Enter a valid phone number (digits, optional +)");
export const emailSchema = z.string().max(254).regex(EMAIL_RE, "Enter a valid email address");
/** Ciphertext envelope produced by @codex/crypto. Plaintext can never match this shape by accident. */
export const ciphertextSchema = z
  .string()
  .max(8000)
  .regex(/^cx1\.[A-Za-z0-9_-]{40,}$/, "Value must be encrypted before storage");
export const youtubeUrlSchema = z
  .string()
  .max(500)
  .refine((u) => youtubeId(u) !== null, "Enter a valid YouTube video URL");
export const httpsUrlSchema = z
  .string()
  .max(1000)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an https URL");

/**
 * Exchange-rate snapshot fields (USD/PKR, PKR per 1 USD x1e6) recorded with a transaction.
 * Default null: rows saved before snapshots existed — or sent by an older app version — stay valid.
 */
const fxMicro = z.number().int().min(FX_MIN_MICRO, "Invalid exchange rate").max(FX_MAX_MICRO, "Invalid exchange rate").nullable().default(null);
const fxText = (max: number) => z.string().max(max).nullable().default(null);
function checkFx(ctx: z.RefinementCtx, micro: number | null, source: string | null, at: string | null, path: string) {
  if (micro === null) {
    if (source !== null || at !== null) ctx.addIssue({ code: "custom", path: [path], message: "Exchange-rate source/time without a rate" });
    return;
  }
  if (!source) ctx.addIssue({ code: "custom", path: [path], message: "Record where the exchange rate came from" });
  if (!at || !/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at)))
    ctx.addIssue({ code: "custom", path: [path], message: "Record when the exchange rate applied" });
}

const meta = {
  id: idSchema,
  rev: z.number().int().min(0),
  deleted: z.boolean(),
  created_at: isoSchema,
  updated_at: isoSchema,
};

/* ------------------------------------------------------------------ */
/* Entity row schemas (identical wire format for SQLite and Postgres)  */
/* ------------------------------------------------------------------ */

export const accountSchema = z
  .object({
    ...meta,
    title: z
      .string()
      .max(200)
      .refine((s) => s.trim().length > 0, "Title is required"),
    status: z.enum(ACCOUNT_STATUSES),
    published: z.boolean(),
    purchase_cost_minor: minorSchema,
    purchase_currency: currencySchema,
    purchased_at: dateSchema.nullable(),
    purchase_reference: optText(200),
    list_price_minor: minorSchema.nullable(),
    list_currency: currencySchema.nullable(),
    description_public: z.string().max(20000),
    youtube_url: youtubeUrlSchema.nullable(),
    image_url: httpsUrlSchema.nullable(),
    image_file_id: optText(200),
    old_owner_name: optText(200),
    old_owner_whatsapp: phoneSchema.nullable(),
    show_old_owner_public: z.boolean(),
    internal_notes: z.string().max(20000),
    purchase_fx_micro: fxMicro,
    purchase_fx_source: fxText(100),
    purchase_fx_at: fxText(40),
    /** Public URL name (codexstocks.org/accounts/<slug>). Assigned by the server; clients never choose it. */
    slug: z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid slug").nullable().default(null),
    /** Optional search-result title / description overrides (sensible defaults are generated). */
    seo_title: z.string().max(120).nullable().default(null),
    seo_description: z.string().max(320).nullable().default(null),
  })
  .superRefine((a, ctx) => {
    checkFx(ctx, a.purchase_fx_micro, a.purchase_fx_source, a.purchase_fx_at, "purchase_fx_micro");
    if ((a.list_price_minor === null) !== (a.list_currency === null))
      ctx.addIssue({ code: "custom", path: ["list_currency"], message: "Sale price and sale currency go together" });
    if ((a.image_url === null) !== (a.image_file_id === null))
      ctx.addIssue({ code: "custom", path: ["image_url"], message: "Image URL and file id go together" });
  });
export type Account = z.infer<typeof accountSchema>;

export const loginLinkSchema = z
  .object({
    ...meta,
    account_id: idSchema,
    kind: z.enum(LINK_KINDS),
    provider: z.enum(SOCIAL_PROVIDERS).nullable(),
    identifier: optText(254),
    display_name: optText(200),
    owner_name: optText(200),
    owner_contact: phoneSchema.nullable(),
    owner_notes: optText(4000),
    status: z.enum(LINK_STATUSES),
    credential_id: idSchema.nullable(),
    two_step_enabled: z.boolean(),
    two_step_method: z.enum(TWO_STEP_METHODS),
    two_step_destination: optText(254),
    two_step_accessible: z.boolean().nullable(),
    recovery_info: optText(4000),
  })
  .superRefine((l, ctx) => {
    if (l.kind === "social") {
      if (!l.provider) ctx.addIssue({ code: "custom", path: ["provider"], message: "Choose the social provider" });
      if (l.credential_id)
        ctx.addIssue({
          code: "custom",
          path: ["credential_id"],
          message: "Social links do not store a password",
        });
    } else {
      if (l.provider) ctx.addIssue({ code: "custom", path: ["provider"], message: "Provider is only for social links" });
      if (!l.identifier)
        ctx.addIssue({
          code: "custom",
          path: ["identifier"],
          message: l.kind === "phone" ? "Phone number is required" : "Email address is required",
        });
      else if (l.kind === "phone" && !PHONE_RE.test(l.identifier))
        ctx.addIssue({ code: "custom", path: ["identifier"], message: "Enter a valid phone number" });
      else if (l.kind === "email" && !EMAIL_RE.test(l.identifier))
        ctx.addIssue({ code: "custom", path: ["identifier"], message: "Enter a valid email address" });
    }
    if (!l.two_step_enabled && l.two_step_method !== "none")
      ctx.addIssue({ code: "custom", path: ["two_step_method"], message: "2-Step method must be 'none' when disabled" });
    if (l.two_step_enabled && l.two_step_method === "none")
      ctx.addIssue({ code: "custom", path: ["two_step_method"], message: "Choose the 2-Step Verification method" });
  });
export type LoginLink = z.infer<typeof loginLinkSchema>;

/** One shared password used by the account's phone and email links. Stored only as ciphertext. */
export const credentialSchema = z.object({
  ...meta,
  account_id: idSchema,
  label: z.string().max(100),
  secret_ct: ciphertextSchema,
  secret_updated_at: isoSchema,
});
export type Credential = z.infer<typeof credentialSchema>;

export const backupCodeSetSchema = z.object({
  ...meta,
  account_id: idSchema,
  link_id: idSchema.nullable(),
  label: z.string().max(200),
});
export type BackupCodeSet = z.infer<typeof backupCodeSetSchema>;

export const backupCodeSchema = z
  .object({
    ...meta,
    set_id: idSchema,
    account_id: idSchema,
    position: z.number().int().min(1).max(10),
    code_ct: ciphertextSchema,
    code_tag: z.string().regex(/^[0-9a-f]{64}$/, "Invalid code tag"),
    state: z.enum(CODE_STATES),
    used_at: isoSchema.nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.state === "used" && !c.used_at)
      ctx.addIssue({ code: "custom", path: ["used_at"], message: "Used codes need a used time" });
  });
export type BackupCode = z.infer<typeof backupCodeSchema>;

export const saleSchema = z
  .object({
  ...meta,
  account_id: idSchema,
  sold_at: isoSchema,
  amount_minor: minorSchema,
  currency: currencySchema,
  /** Units of sale currency per 1 unit of the account's purchase currency, x1e6. Required when they differ. */
  exchange_rate_micro: z.number().int().positive().max(1e15).nullable(),
  buyer_name: optText(200),
  buyer_contact: optText(100),
  channel: z.enum(SALE_CHANNELS),
  reference: optText(200),
  notes: optText(4000),
  status: z.enum(SALE_STATUSES),
  /** USD/PKR snapshot used for this sale (cross-currency profit and PKR-equivalent reporting). */
  fx_usd_pkr_micro: fxMicro,
  fx_source: fxText(100),
  fx_at: fxText(40),
  /** Required when the owner typed a rate instead of using the reference quote. */
  fx_override_reason: fxText(500),
  })
  .superRefine((s, ctx) => {
    checkFx(ctx, s.fx_usd_pkr_micro, s.fx_source, s.fx_at, "fx_usd_pkr_micro");
    if (s.fx_source === FX_SOURCE_MANUAL && !(s.fx_override_reason ?? "").trim())
      ctx.addIssue({ code: "custom", path: ["fx_override_reason"], message: "Give a reason for the manual exchange rate" });
  });
export type Sale = z.infer<typeof saleSchema>;

export const refundSchema = z.object({
  ...meta,
  sale_id: idSchema,
  account_id: idSchema,
  refunded_at: isoSchema,
  amount_minor: minorSchema.refine((v) => v > 0, "Refund must be greater than zero"),
  currency: currencySchema,
  reason: optText(1000),
  restock: z.boolean(),
});
export type Refund = z.infer<typeof refundSchema>;

export const expenseSchema = z.object({
  ...meta,
  incurred_at: dateSchema,
  amount_minor: minorSchema.refine((v) => v > 0, "Expense must be greater than zero"),
  currency: currencySchema,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().max(1000),
  account_id: idSchema.nullable(),
  sale_id: idSchema.nullable(),
  fx_usd_pkr_micro: fxMicro,
  fx_source: fxText(100),
  fx_at: fxText(40),
}).superRefine((e, ctx) => checkFx(ctx, e.fx_usd_pkr_micro, e.fx_source, e.fx_at, "fx_usd_pkr_micro"));
export type Expense = z.infer<typeof expenseSchema>;

export const auditEventSchema = z.object({
  ...meta,
  entity_type: z.string().max(40),
  entity_id: idSchema,
  action: z.string().max(60),
  /** JSON object of non-secret details. Never contains plaintext or ciphertext secrets. */
  details: z.string().max(8000),
  actor: z.string().max(100),
  at: isoSchema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const SETTING_KEYS = [
  "store_name",
  "public_whatsapp",
  "default_currency",
  "store_tagline",
  // Admin contact information printed on receipts (public business details only).
  "contact_owner",
  "contact_phone",
  "contact_email",
  "contact_website",
  "contact_address",
  "contact_hours",
  "contact_social",
  "contact_other",
  // USDT/PKR: "provider" (reference rate) or "manual" (the owner's own rate, JSON in usdt_pkr_manual).
  "usdt_rate_mode",
  "usdt_pkr_manual",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export const settingSchema = z.object({
  ...meta,
  key: z.enum(SETTING_KEYS),
  value: z.string().max(2000),
});
export type Setting = z.infer<typeof settingSchema>;

/* ------------------------------------------------------------------ */
/* Installment plans, payments, money owed, receipts                   */
/* ------------------------------------------------------------------ */

function parseJsonArray<T>(text: string): T[] | null {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

export const scheduleItemSchema = z.object({ n: z.number().int().min(1).max(MAX_INSTALLMENTS), due_on: dateSchema, principal_minor: minorSchema });
export const fineWaiverSchema = z.object({
  id: idSchema,
  n: z.number().int().min(1).max(MAX_INSTALLMENTS),
  minor: minorSchema.refine((v) => v > 0, "Waiver must be greater than zero"),
  reason: z.string().max(1000),
  at: isoSchema,
  actor: z.string().max(100),
  undone_at: isoSchema.nullable(),
  undo_reason: z.string().max(1000).nullable(),
});
export type FineWaiverRecord = z.infer<typeof fineWaiverSchema>;
export const allocationSchema = z.object({
  n: z.number().int().min(0).max(MAX_INSTALLMENTS),
  part: z.enum(["principal", "extra", "fine", "credit", "charge"]),
  minor: minorSchema.refine((v) => v > 0, "Allocations must be greater than zero"),
});
export const debtChargeSchema = z.object({
  id: idSchema,
  kind: z.enum(["charge", "discount"]),
  minor: minorSchema.refine((v) => v > 0, "Amount must be greater than zero"),
  label: z.string().max(200),
  on: dateSchema,
  at: isoSchema,
});
export type DebtCharge = z.infer<typeof debtChargeSchema>;

/**
 * An installment sale agreement. The account's sale itself is an ordinary sales row (counted once, at the
 * original price); the plan tracks what is still owed. Daily Extra and late fines are derived from these terms.
 */
export const installmentPlanSchema = z
  .object({
    ...meta,
    account_id: idSchema,
    sale_id: idSchema,
    customer_name: z.string().max(200).refine((s) => s.trim().length > 0, "Customer name is required"),
    customer_phone: optText(40),
    customer_whatsapp: optText(40),
    account_title: z.string().max(200),
    account_ref: optText(100),
    currency: currencySchema,
    original_minor: minorSchema,
    advance_minor: minorSchema,
    advance_due_on: dateSchema.nullable(),
    start_on: dateSchema,
    duration_months: z.number().int().min(1).max(120).nullable(),
    duration_days: z.number().int().min(1).max(3660).nullable(),
    schedule_mode: z.enum(SCHEDULE_MODES),
    interval_days: z.number().int().min(1).max(366).nullable(),
    first_due_on: dateSchema,
    schedule_json: z.string().max(20000),
    extra_rate_minor: minorSchema,
    extra_free_days: z.number().int().min(0).max(3660),
    extra_end: z.enum(EXTRA_ENDS),
    extra_end_on: dateSchema.nullable(),
    extra_days: z.number().int().min(1).max(3660).nullable(),
    fine_minor: minorSchema,
    fine_mode: z.enum(FINE_MODES),
    fine_grace_days: z.number().int().min(0).max(365),
    payment_notes: z.string().max(4000),
    agreement_ref: optText(200),
    agreement_notes: z.string().max(4000),
    status: z.enum(PLAN_STATUSES),
    cancelled_on: dateSchema.nullable(),
    cancel_reason: optText(1000),
    revision: z.number().int().min(0),
    waivers_json: z.string().max(20000),
  })
  .superRefine((p, ctx) => {
    const sched = parseJsonArray<ScheduleItem>(p.schedule_json);
    const items = sched ? z.array(scheduleItemSchema).safeParse(sched) : null;
    if (!items?.success) {
      ctx.addIssue({ code: "custom", path: ["schedule_json"], message: "Invalid installment schedule" });
      return;
    }
    const waivers = parseJsonArray(p.waivers_json);
    if (!waivers || !z.array(fineWaiverSchema).safeParse(waivers).success)
      ctx.addIssue({ code: "custom", path: ["waivers_json"], message: "Invalid fine waivers" });
    try {
      validatePlan(planTerms(p), items.data);
    } catch (e) {
      ctx.addIssue({ code: "custom", path: ["schedule_json"], message: (e as Error).message });
    }
    if (p.status === "cancelled" && (!p.cancelled_on || !(p.cancel_reason ?? "").trim()))
      ctx.addIssue({ code: "custom", path: ["cancel_reason"], message: "A cancelled plan needs a date and a reason" });
  });
export type InstallmentPlan = z.infer<typeof installmentPlanSchema>;

export function planTerms(
  p: Pick<
    InstallmentPlan,
    "original_minor" | "advance_minor" | "start_on" | "extra_rate_minor" | "extra_free_days" | "extra_end" | "extra_end_on" | "extra_days" | "fine_minor" | "fine_mode" | "fine_grace_days"
  >,
) {
  return {
    original_minor: p.original_minor,
    advance_minor: p.advance_minor,
    start_on: p.start_on,
    extra_rate_minor: p.extra_rate_minor,
    extra_free_days: p.extra_free_days,
    extra_end: p.extra_end,
    extra_end_on: p.extra_end_on,
    extra_days: p.extra_days,
    fine_minor: p.fine_minor,
    fine_mode: p.fine_mode,
    fine_grace_days: p.fine_grace_days,
  };
}

/**
 * Money actually received (plan payments, money owed to the owner) or paid out (money the owner owes).
 * Never edited after saving: a mistake is corrected by REVERSING the payment (kept, with a reason).
 */
export const paymentSchema = z
  .object({
    ...meta,
    receipt_no: z.string().regex(RECEIPT_NO_RE, "Invalid receipt number"),
    target: z.enum(PAYMENT_TARGETS),
    plan_id: idSchema.nullable(),
    debt_id: idSchema.nullable(),
    kind: z.enum(PAYMENT_KINDS),
    installment_no: z.number().int().min(0).max(MAX_INSTALLMENTS).nullable(),
    paid_on: dateSchema,
    amount_minor: minorSchema.refine((v) => v > 0, "Amount must be greater than zero"),
    currency: payCurrencySchema,
    /** Amount credited to the plan / record in ITS currency. */
    credited_minor: minorSchema.refine((v) => v > 0, "Amount must be greater than zero"),
    /** Plan/record currency units per 1 unit of the payment currency, x1e6 (null when the same currency). */
    rate_micro: z.number().int().positive().max(1e15).nullable(),
    rate_source: optText(100),
    rate_at: optText(40),
    /** PKR per 1 unit of the payment currency at payment time, x1e6 (null for PKR): used for PKR reports. */
    pkr_micro: z.number().int().positive().max(1e15).nullable(),
    pkr_source: optText(100),
    pkr_at: optText(40),
    method: z.enum(PAY_METHODS),
    reference: optText(200),
    notes: optText(2000),
    allocations_json: z.string().max(20000),
    actor: z.string().max(100),
    status: z.enum(PAYMENT_STATUSES),
    reversed_at: isoSchema.nullable(),
    reversal_reason: optText(1000),
  })
  .superRefine((p, ctx) => {
    if (p.target === "plan" && (!p.plan_id || p.debt_id)) ctx.addIssue({ code: "custom", path: ["plan_id"], message: "A plan payment needs its plan" });
    if (p.target === "debt" && (!p.debt_id || p.plan_id)) ctx.addIssue({ code: "custom", path: ["debt_id"], message: "This payment needs its record" });
    const planKind = p.kind === "advance" || p.kind === "installment" || p.kind === "settlement";
    if ((p.target === "plan") !== planKind) ctx.addIssue({ code: "custom", path: ["kind"], message: "Payment type does not match" });
    const allocs = parseJsonArray<Allocation>(p.allocations_json);
    const parsed = allocs ? z.array(allocationSchema).safeParse(allocs) : null;
    if (!parsed?.success) ctx.addIssue({ code: "custom", path: ["allocations_json"], message: "Invalid allocation" });
    else {
      const parts = new Set(parsed.data.map((a) => a.part));
      if (p.target === "plan" && parts.has("charge")) ctx.addIssue({ code: "custom", path: ["allocations_json"], message: "Invalid allocation" });
      if (p.target === "debt" && (parts.has("extra") || parts.has("fine"))) ctx.addIssue({ code: "custom", path: ["allocations_json"], message: "Invalid allocation" });
      if (parsed.data.reduce((a, x) => a + x.minor, 0) !== p.credited_minor)
        ctx.addIssue({ code: "custom", path: ["allocations_json"], message: "The allocation must add up to the amount credited" });
    }
    if ((p.rate_micro === null) !== (p.rate_source === null)) ctx.addIssue({ code: "custom", path: ["rate_source"], message: "Record where the conversion rate came from" });
    if (p.rate_micro === null && p.amount_minor !== p.credited_minor)
      ctx.addIssue({ code: "custom", path: ["credited_minor"], message: "A conversion rate is needed when the credited amount differs" });
    if (p.currency === "PKR" && p.pkr_micro !== null) ctx.addIssue({ code: "custom", path: ["pkr_micro"], message: "PKR needs no PKR rate" });
    if ((p.pkr_micro === null) !== (p.pkr_source === null)) ctx.addIssue({ code: "custom", path: ["pkr_source"], message: "Record where the PKR rate came from" });
    if (p.status === "reversed" && (!p.reversed_at || !(p.reversal_reason ?? "").trim()))
      ctx.addIssue({ code: "custom", path: ["reversal_reason"], message: "A reversed payment needs a reason" });
  });
export type Payment = z.infer<typeof paymentSchema>;

/** Money to Receive (owed TO the owner) / Money to Pay (owed BY the owner) — personal or business, not sales. */
export const debtSchema = z
  .object({
    ...meta,
    direction: z.enum(DEBT_DIRECTIONS),
    party_name: z.string().max(200).refine((s) => s.trim().length > 0, "Name is required"),
    party_contact: optText(100),
    description: z.string().max(2000),
    original_minor: minorSchema.refine((v) => v > 0, "Amount must be greater than zero"),
    currency: payCurrencySchema,
    txn_on: dateSchema,
    due_on: dateSchema.nullable(),
    notes: z.string().max(4000),
    charges_json: z.string().max(20000),
    status: z.enum(DEBT_STATUSES),
    cancelled_at: isoSchema.nullable(),
    cancel_reason: optText(1000),
  })
  .superRefine((d, ctx) => {
    const charges = parseJsonArray(d.charges_json);
    if (!charges || !z.array(debtChargeSchema).safeParse(charges).success)
      ctx.addIssue({ code: "custom", path: ["charges_json"], message: "Invalid charges" });
    if (d.due_on && d.due_on < d.txn_on) ctx.addIssue({ code: "custom", path: ["due_on"], message: "The due date cannot be before the transaction date" });
    if (d.status === "cancelled" && (!d.cancelled_at || !(d.cancel_reason ?? "").trim()))
      ctx.addIssue({ code: "custom", path: ["cancel_reason"], message: "A cancelled record needs a reason" });
  });
export type Debt = z.infer<typeof debtSchema>;

/** An issued receipt: an immutable snapshot of exactly what was shown, re-rendered as PNG on demand. */
export const receiptSchema = z.object({
  ...meta,
  receipt_no: z.string().regex(RECEIPT_NO_RE, "Invalid receipt number"),
  kind: z.enum(RECEIPT_KINDS),
  plan_id: idSchema.nullable(),
  payment_id: idSchema.nullable(),
  issued_at: isoSchema,
  revision: z.number().int().min(0).nullable(),
  data_json: z.string().max(100_000),
});
export type Receipt = z.infer<typeof receiptSchema>;

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */


export const ENTITIES = [
  "accounts",
  "login_links",
  "credentials",
  "backup_code_sets",
  "backup_codes",
  "sales",
  "refunds",
  "expenses",
  "audit_events",
  "settings",
  "installment_plans",
  "payments",
  "debts",
  "receipts",
] as const;
export type Entity = (typeof ENTITIES)[number];

export interface EntityRowMap {
  accounts: Account;
  login_links: LoginLink;
  credentials: Credential;
  backup_code_sets: BackupCodeSet;
  backup_codes: BackupCode;
  sales: Sale;
  refunds: Refund;
  expenses: Expense;
  audit_events: AuditEvent;
  settings: Setting;
  installment_plans: InstallmentPlan;
  payments: Payment;
  debts: Debt;
  receipts: Receipt;
}
export type AnyRow = EntityRowMap[Entity];

export const ENTITY_SCHEMAS: { [E in Entity]: z.ZodType<EntityRowMap[E]> } = {
  accounts: accountSchema,
  login_links: loginLinkSchema,
  credentials: credentialSchema,
  backup_code_sets: backupCodeSetSchema,
  backup_codes: backupCodeSchema,
  sales: saleSchema,
  refunds: refundSchema,
  expenses: expenseSchema,
  audit_events: auditEventSchema,
  settings: settingSchema,
  installment_plans: installmentPlanSchema,
  payments: paymentSchema,
  debts: debtSchema,
  receipts: receiptSchema,
};

export type FieldType = "text" | "int" | "bool";

/** Column types, used by the SQLite and Postgres adapters to convert values. Order = column order. */
export const ENTITY_FIELDS: { [E in Entity]: Record<keyof EntityRowMap[E] & string, FieldType> } = {
  accounts: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    title: "text", status: "text", published: "bool", purchase_cost_minor: "int", purchase_currency: "text",
    purchased_at: "text", purchase_reference: "text", list_price_minor: "int", list_currency: "text",
    description_public: "text", youtube_url: "text", image_url: "text", image_file_id: "text",
    old_owner_name: "text", old_owner_whatsapp: "text", show_old_owner_public: "bool", internal_notes: "text",
    purchase_fx_micro: "int", purchase_fx_source: "text", purchase_fx_at: "text",
    slug: "text", seo_title: "text", seo_description: "text",
  },
  login_links: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    account_id: "text", kind: "text", provider: "text", identifier: "text", display_name: "text",
    owner_name: "text", owner_contact: "text", owner_notes: "text", status: "text", credential_id: "text",
    two_step_enabled: "bool", two_step_method: "text", two_step_destination: "text",
    two_step_accessible: "bool", recovery_info: "text",
  },
  credentials: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    account_id: "text", label: "text", secret_ct: "text", secret_updated_at: "text",
  },
  backup_code_sets: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    account_id: "text", link_id: "text", label: "text",
  },
  backup_codes: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    set_id: "text", account_id: "text", position: "int", code_ct: "text", code_tag: "text", state: "text",
    used_at: "text",
  },
  sales: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    account_id: "text", sold_at: "text", amount_minor: "int", currency: "text", exchange_rate_micro: "int",
    buyer_name: "text", buyer_contact: "text", channel: "text", reference: "text", notes: "text", status: "text",
    fx_usd_pkr_micro: "int", fx_source: "text", fx_at: "text", fx_override_reason: "text",
  },
  refunds: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    sale_id: "text", account_id: "text", refunded_at: "text", amount_minor: "int", currency: "text",
    reason: "text", restock: "bool",
  },
  expenses: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    incurred_at: "text", amount_minor: "int", currency: "text", category: "text", description: "text",
    account_id: "text", sale_id: "text",
    fx_usd_pkr_micro: "int", fx_source: "text", fx_at: "text",
  },
  audit_events: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    entity_type: "text", entity_id: "text", action: "text", details: "text", actor: "text", at: "text",
  },
  settings: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text", key: "text", value: "text",
  },
  installment_plans: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    account_id: "text", sale_id: "text", customer_name: "text", customer_phone: "text", customer_whatsapp: "text",
    account_title: "text", account_ref: "text", currency: "text", original_minor: "int", advance_minor: "int",
    advance_due_on: "text", start_on: "text", duration_months: "int", duration_days: "int", schedule_mode: "text",
    interval_days: "int", first_due_on: "text", schedule_json: "text", extra_rate_minor: "int", extra_free_days: "int",
    extra_end: "text", extra_end_on: "text", extra_days: "int", fine_minor: "int", fine_mode: "text",
    fine_grace_days: "int", payment_notes: "text", agreement_ref: "text", agreement_notes: "text", status: "text",
    cancelled_on: "text", cancel_reason: "text", revision: "int", waivers_json: "text",
  },
  payments: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    receipt_no: "text", target: "text", plan_id: "text", debt_id: "text", kind: "text", installment_no: "int",
    paid_on: "text", amount_minor: "int", currency: "text", credited_minor: "int", rate_micro: "int",
    rate_source: "text", rate_at: "text", pkr_micro: "int", pkr_source: "text", pkr_at: "text", method: "text",
    reference: "text", notes: "text", allocations_json: "text", actor: "text", status: "text",
    reversed_at: "text", reversal_reason: "text",
  },
  debts: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    direction: "text", party_name: "text", party_contact: "text", description: "text", original_minor: "int",
    currency: "text", txn_on: "text", due_on: "text", notes: "text", charges_json: "text", status: "text",
    cancelled_at: "text", cancel_reason: "text",
  },
  receipts: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    receipt_no: "text", kind: "text", plan_id: "text", payment_id: "text", issued_at: "text", revision: "int",
    data_json: "text",
  },
};

/** Fields that hold ciphertext. They are never included in logs, audit details or public responses. */
export const SECRET_FIELDS: Partial<Record<Entity, string[]>> = {
  credentials: ["secret_ct"],
  backup_codes: ["code_ct", "code_tag"],
};

/** Bookkeeping fields excluded from three-way merges and change comparison. */
export const META_FIELDS = new Set(["id", "rev", "created_at", "updated_at"]);

export function isEntity(v: unknown): v is Entity {
  return typeof v === "string" && (ENTITIES as readonly string[]).includes(v);
}

export function validateRow<E extends Entity>(entity: E, row: unknown): EntityRowMap[E] {
  return ENTITY_SCHEMAS[entity].parse(row) as EntityRowMap[E];
}

/** Human-readable first validation error. */
export function firstIssue(err: unknown): string {
  if (err instanceof z.ZodError) {
    const i = err.issues[0];
    const path = i.path.length ? `${i.path.join(".")}: ` : "";
    return `${path}${i.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
