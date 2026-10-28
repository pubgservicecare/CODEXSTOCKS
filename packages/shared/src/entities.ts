import { z } from "zod";
import { CURRENCIES, MAX_MINOR } from "./money";
import { UUID_RE } from "./ids";
import { EMAIL_RE, PHONE_RE, youtubeId } from "./text";

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
  })
  .superRefine((a, ctx) => {
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

export const saleSchema = z.object({
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
});
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

export const SETTING_KEYS = ["store_name", "public_whatsapp", "default_currency", "store_tagline"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export const settingSchema = z.object({
  ...meta,
  key: z.enum(SETTING_KEYS),
  value: z.string().max(2000),
});
export type Setting = z.infer<typeof settingSchema>;

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
  },
  audit_events: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text",
    entity_type: "text", entity_id: "text", action: "text", details: "text", actor: "text", at: "text",
  },
  settings: {
    id: "text", rev: "int", deleted: "bool", created_at: "text", updated_at: "text", key: "text", value: "text",
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
