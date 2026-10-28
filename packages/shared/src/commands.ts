import {
  validateRow,
  type Account,
  type AccountStatus,
  type AnyRow,
  type BackupCode,
  type BackupCodeSet,
  type CodeState,
  type Credential,
  type Entity,
  type EntityRowMap,
  type Expense,
  type LoginLink,
  type Refund,
  type Sale,
  type SettingKey,
  SETTING_KEYS,
} from "./entities";
import {
  assertCodeTransition,
  assertManualTransition,
  checkInvariants,
  ConflictError,
  isActiveSale,
  LINK_LIMITS,
  RuleError,
  type RowReader,
} from "./rules";

/**
 * Storage abstraction implemented by the desktop SQLite store (writes go to the
 * sync outbox) and by the server Postgres store (writes bump revision + change seq).
 * Every command below runs inside ONE transaction of the underlying store.
 */
export interface EntityStore extends RowReader {
  /** Persist a validated row. `prev` is the stored version or null for an insert. */
  put<E extends Entity>(entity: E, row: EntityRowMap[E], prev: EntityRowMap[E] | null): Promise<EntityRowMap[E]>;
  now(): string;
  newId(): string;
  actor: string;
}

type Patch<T> = Partial<{ [K in keyof T]: T[K] }>;

function pick<T extends object>(src: Record<string, unknown>, keys: readonly (keyof T & string)[]): Patch<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined) out[k] = src[k];
  return out as Patch<T>;
}

function metaFor(store: EntityStore, id?: string) {
  const t = store.now();
  return { id: id ?? store.newId(), rev: 0, deleted: false, created_at: t, updated_at: t };
}

async function write<E extends Entity>(
  store: EntityStore,
  entity: E,
  next: unknown,
  prev: EntityRowMap[E] | null,
): Promise<EntityRowMap[E]> {
  const row = validateRow(entity, next);
  await checkInvariants(store, entity, row, prev);
  return store.put(entity, row, prev);
}

async function load<E extends Entity>(store: EntityStore, entity: E, id: string, what: string): Promise<EntityRowMap[E]> {
  const row = await store.get(entity, id);
  if (!row || row.deleted) throw new RuleError("not_found", `${what} not found`);
  return row;
}

function checkRev(prev: AnyRow, expected?: number) {
  if (expected !== undefined && prev.rev !== expected)
    throw new ConflictError("This record was changed elsewhere. Reload to see the latest version.", prev);
}

async function audit(
  store: EntityStore,
  entity_type: Entity,
  entity_id: string,
  action: string,
  details: Record<string, unknown> = {},
) {
  const t = store.now();
  await write(
    store,
    "audit_events",
    { ...metaFor(store), entity_type, entity_id, action, details: JSON.stringify(details), actor: store.actor, at: t },
    null,
  );
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const ACCOUNT_EDITABLE = [
  "title", "purchase_cost_minor", "purchase_currency", "purchased_at", "purchase_reference", "list_price_minor",
  "list_currency", "description_public", "youtube_url", "old_owner_name", "old_owner_whatsapp",
  "show_old_owner_public", "internal_notes",
] as const satisfies readonly (keyof Account)[];
export type AccountInput = Patch<Pick<Account, (typeof ACCOUNT_EDITABLE)[number]>>;

export const LINK_EDITABLE = [
  "kind", "provider", "identifier", "display_name", "owner_name", "owner_contact", "owner_notes", "status",
  "two_step_enabled", "two_step_method", "two_step_destination", "two_step_accessible", "recovery_info",
] as const satisfies readonly (keyof LoginLink)[];
export type LinkInput = Patch<Pick<LoginLink, (typeof LINK_EDITABLE)[number]>>;

function newAccountRow(store: EntityStore, id: string | undefined, input: AccountInput) {
  return {
    ...metaFor(store, id),
    status: "available",
    published: false,
    purchased_at: null,
    purchase_reference: null,
    list_price_minor: null,
    list_currency: null,
    description_public: "",
    youtube_url: null,
    image_url: null,
    image_file_id: null,
    old_owner_name: null,
    old_owner_whatsapp: null,
    show_old_owner_public: false,
    internal_notes: "",
    ...pick<Account>(input as Record<string, unknown>, ACCOUNT_EDITABLE),
  };
}

function newLinkRow(store: EntityStore, id: string | undefined, account_id: string, input: LinkInput) {
  return {
    ...metaFor(store, id),
    account_id,
    provider: null,
    identifier: null,
    display_name: null,
    owner_name: null,
    owner_contact: null,
    owner_notes: null,
    status: "active",
    credential_id: null,
    two_step_enabled: false,
    two_step_method: "none",
    two_step_destination: null,
    two_step_accessible: null,
    recovery_info: null,
    ...pick<LoginLink>(input as Record<string, unknown>, LINK_EDITABLE),
  };
}

/**
 * Create an account together with its first login link(s). A complete account needs at
 * least one login link, so creation without one is rejected.
 */
export async function createAccount(
  store: EntityStore,
  args: { id?: string; account: AccountInput; links: (LinkInput & { id?: string })[] },
): Promise<Account> {
  if (!args.links || args.links.length < LINK_LIMITS.min)
    throw new RuleError("link_min", "Add at least one login link (social, phone or email)");
  if (args.links.length > LINK_LIMITS.total) throw new RuleError("link_limit_total", "An account can have at most 4 login links");
  if (args.id && (await store.get("accounts", args.id))) throw new RuleError("exists", "Account already exists");
  const account = await write(store, "accounts", newAccountRow(store, args.id, args.account), null);
  for (const l of args.links) {
    const link = await write(store, "login_links", newLinkRow(store, l.id, account.id, l), null);
    await audit(store, "login_links", link.id, "link.created", { account_id: account.id, kind: link.kind });
  }
  await audit(store, "accounts", account.id, "account.created", {
    purchase_cost_minor: account.purchase_cost_minor,
    purchase_currency: account.purchase_currency,
  });
  return account;
}

export async function updateAccount(
  store: EntityStore,
  args: { id: string; expected_rev?: number; account: AccountInput },
): Promise<Account> {
  const prev = await load(store, "accounts", args.id, "Account");
  checkRev(prev, args.expected_rev);
  const next = { ...prev, ...pick<Account>(args.account as Record<string, unknown>, ACCOUNT_EDITABLE), updated_at: store.now() };
  const saved = await write(store, "accounts", next, prev);
  if (prev.purchase_cost_minor !== saved.purchase_cost_minor || prev.purchase_currency !== saved.purchase_currency)
    await audit(store, "accounts", saved.id, "account.purchase_changed", {
      from: { amount: prev.purchase_cost_minor, currency: prev.purchase_currency },
      to: { amount: saved.purchase_cost_minor, currency: saved.purchase_currency },
    });
  if (prev.list_price_minor !== saved.list_price_minor || prev.list_currency !== saved.list_currency)
    await audit(store, "accounts", saved.id, "account.list_price_changed", {
      from: { amount: prev.list_price_minor, currency: prev.list_currency },
      to: { amount: saved.list_price_minor, currency: saved.list_currency },
    });
  return saved;
}

export async function setAccountStatus(
  store: EntityStore,
  args: { id: string; status: AccountStatus; expected_rev?: number },
): Promise<Account> {
  const prev = await load(store, "accounts", args.id, "Account");
  checkRev(prev, args.expected_rev);
  assertManualTransition(prev.status, args.status);
  const next = {
    ...prev,
    status: args.status,
    published: args.status === "archived" ? false : prev.published,
    updated_at: store.now(),
  };
  const saved = await write(store, "accounts", next, prev);
  await audit(store, "accounts", saved.id, "account.status", { from: prev.status, to: saved.status });
  return saved;
}

export async function setPublished(
  store: EntityStore,
  args: { id: string; published: boolean; expected_rev?: number },
): Promise<Account> {
  const prev = await load(store, "accounts", args.id, "Account");
  checkRev(prev, args.expected_rev);
  if (args.published) {
    if (prev.status !== "available")
      throw new RuleError("publish_status", "Only available accounts can be published");
    const links = await store.list("login_links", { account_id: prev.id });
    if (links.length < LINK_LIMITS.min)
      throw new RuleError("link_min", "Add at least one login link before publishing");
    if (!prev.list_price_minor && prev.list_price_minor !== 0)
      throw new RuleError("publish_price", "Set a sale price before publishing");
  }
  const saved = await write(store, "accounts", { ...prev, published: args.published, updated_at: store.now() }, prev);
  await audit(store, "accounts", saved.id, args.published ? "account.published" : "account.unpublished");
  return saved;
}

export async function setAccountImage(
  store: EntityStore,
  args: { id: string; image_url: string | null; image_file_id: string | null },
): Promise<Account> {
  const prev = await load(store, "accounts", args.id, "Account");
  const next = { ...prev, image_url: args.image_url, image_file_id: args.image_file_id, updated_at: store.now() };
  const saved = await write(store, "accounts", next, prev);
  if (prev.image_file_id !== saved.image_file_id)
    await audit(store, "accounts", saved.id, saved.image_url ? "account.image_set" : "account.image_removed");
  return saved;
}

/** Soft-delete an account that was created by mistake. Accounts with sales must be archived instead. */
export async function deleteAccount(store: EntityStore, args: { id: string }): Promise<void> {
  const prev = await load(store, "accounts", args.id, "Account");
  const sales = await store.list("sales", { account_id: prev.id });
  if (sales.length) throw new RuleError("delete_has_sales", "Accounts with sales cannot be deleted. Archive it instead.");
  const t = store.now();
  for (const c of await store.list("backup_codes", { account_id: prev.id }))
    await store.put("backup_codes", { ...c, deleted: true, updated_at: t }, c);
  for (const s of await store.list("backup_code_sets", { account_id: prev.id }))
    await store.put("backup_code_sets", { ...s, deleted: true, updated_at: t }, s);
  for (const l of await store.list("login_links", { account_id: prev.id }))
    await store.put("login_links", { ...l, deleted: true, updated_at: t }, l);
  for (const c of await store.list("credentials", { account_id: prev.id }))
    await store.put("credentials", { ...c, deleted: true, updated_at: t }, c);
  await store.put("accounts", { ...prev, deleted: true, published: false, updated_at: t }, prev);
  await audit(store, "accounts", prev.id, "account.deleted", { title_length: prev.title.length });
}

/* ------------------------------------------------------------------ */
/* Login links + shared phone/email password                           */
/* ------------------------------------------------------------------ */

async function sharedCredential(store: EntityStore, account_id: string): Promise<Credential | null> {
  const creds = await store.list("credentials", { account_id });
  return creds[0] ?? null;
}

export async function saveLink(
  store: EntityStore,
  args: { id?: string; account_id: string; expected_rev?: number; link: LinkInput },
): Promise<LoginLink> {
  const acct = await load(store, "accounts", args.account_id, "Account");
  const prev = args.id ? await store.get("login_links", args.id) : null;
  if (prev && (prev.deleted || prev.account_id !== acct.id)) throw new RuleError("not_found", "Login link not found");
  if (prev) checkRev(prev, args.expected_rev);
  const base = prev
    ? { ...prev, ...pick<LoginLink>(args.link as Record<string, unknown>, LINK_EDITABLE), updated_at: store.now() }
    : newLinkRow(store, args.id, acct.id, args.link);
  const cred = base.kind === "social" ? null : await sharedCredential(store, acct.id);
  const next = {
    ...base,
    provider: base.kind === "social" ? base.provider : null,
    credential_id: cred ? cred.id : null,
  };
  const saved = await write(store, "login_links", next, prev);
  await audit(store, "login_links", saved.id, prev ? "link.updated" : "link.created", {
    account_id: acct.id,
    kind: saved.kind,
  });
  return saved;
}

export async function deleteLink(store: EntityStore, args: { id: string }): Promise<void> {
  const prev = await load(store, "login_links", args.id, "Login link");
  await write(store, "login_links", { ...prev, deleted: true, updated_at: store.now() }, prev);
  await audit(store, "login_links", prev.id, "link.deleted", { account_id: prev.account_id, kind: prev.kind });
}

/**
 * Record or update the ONE password shared by the account's phone and email links.
 * `secret_ct` must already be encrypted on the owner's device with the vault key.
 */
export async function saveSharedPassword(
  store: EntityStore,
  args: { account_id: string; credential_id: string; secret_ct: string },
): Promise<Credential> {
  const acct = await load(store, "accounts", args.account_id, "Account");
  const existing = await sharedCredential(store, acct.id);
  if (existing && existing.id !== args.credential_id)
    throw new RuleError("credential_single", "This account already has a shared password record");
  const t = store.now();
  const next = existing
    ? { ...existing, secret_ct: args.secret_ct, secret_updated_at: t, updated_at: t }
    : {
        ...metaFor(store, args.credential_id),
        account_id: acct.id,
        label: "Phone / email shared password",
        secret_ct: args.secret_ct,
        secret_updated_at: t,
      };
  const saved = await write(store, "credentials", next, existing);
  for (const l of await store.list("login_links", { account_id: acct.id })) {
    if (l.kind !== "social" && l.credential_id !== saved.id)
      await write(store, "login_links", { ...l, credential_id: saved.id, updated_at: t }, l);
  }
  await audit(store, "credentials", saved.id, existing ? "password.updated" : "password.recorded", {
    account_id: acct.id,
  });
  return saved;
}

export async function deleteSharedPassword(store: EntityStore, args: { account_id: string }): Promise<void> {
  const existing = await sharedCredential(store, args.account_id);
  if (!existing) return;
  const t = store.now();
  for (const l of await store.list("login_links", { account_id: args.account_id }))
    if (l.credential_id === existing.id) await write(store, "login_links", { ...l, credential_id: null, updated_at: t }, l);
  await write(store, "credentials", { ...existing, deleted: true, updated_at: t }, existing);
  await audit(store, "credentials", existing.id, "password.deleted", { account_id: args.account_id });
}

/* ------------------------------------------------------------------ */
/* Backup codes                                                        */
/* ------------------------------------------------------------------ */

export async function recordBackupSet(
  store: EntityStore,
  args: {
    set: { id: string; account_id: string; link_id: string | null; label: string };
    codes: { id: string; position: number; code_ct: string; code_tag: string }[];
  },
): Promise<BackupCodeSet> {
  await load(store, "accounts", args.set.account_id, "Account");
  if (!args.codes.length) throw new RuleError("codes_empty", "Enter at least one backup code");
  if (args.codes.length > 10) throw new RuleError("codes_too_many", "A backup-code set holds at most 10 codes");
  if (await store.get("backup_code_sets", args.set.id)) throw new RuleError("exists", "Backup-code set already exists");
  const set = await write(
    store,
    "backup_code_sets",
    { ...metaFor(store, args.set.id), account_id: args.set.account_id, link_id: args.set.link_id, label: args.set.label },
    null,
  );
  for (const c of args.codes) {
    await write(
      store,
      "backup_codes",
      {
        ...metaFor(store, c.id),
        set_id: set.id,
        account_id: set.account_id,
        position: c.position,
        code_ct: c.code_ct,
        code_tag: c.code_tag,
        state: "unused",
        used_at: null,
      },
      null,
    );
  }
  await audit(store, "backup_code_sets", set.id, "backup_codes.recorded", {
    account_id: set.account_id,
    count: args.codes.length,
  });
  return set;
}

export async function setBackupCodeState(
  store: EntityStore,
  args: { id: string; state: CodeState },
): Promise<BackupCode> {
  const prev = await load(store, "backup_codes", args.id, "Backup code");
  assertCodeTransition(prev.state, args.state);
  const t = store.now();
  const next = { ...prev, state: args.state, used_at: args.state === "used" ? t : prev.used_at, updated_at: t };
  const saved = await write(store, "backup_codes", next, prev);
  await audit(store, "backup_codes", saved.id, `backup_code.${args.state}`, {
    account_id: saved.account_id,
    set_id: saved.set_id,
    position: saved.position,
  });
  return saved;
}

export async function deleteBackupSet(store: EntityStore, args: { id: string }): Promise<void> {
  const prev = await load(store, "backup_code_sets", args.id, "Backup-code set");
  const t = store.now();
  for (const c of await store.list("backup_codes", { set_id: prev.id }))
    await store.put("backup_codes", { ...c, deleted: true, updated_at: t }, c);
  await write(store, "backup_code_sets", { ...prev, deleted: true, updated_at: t }, prev);
  await audit(store, "backup_code_sets", prev.id, "backup_codes.deleted", { account_id: prev.account_id });
}

/* ------------------------------------------------------------------ */
/* Sales, refunds, expenses                                            */
/* ------------------------------------------------------------------ */

export type SaleInput = Pick<
  Sale,
  "account_id" | "sold_at" | "amount_minor" | "currency" | "exchange_rate_micro" | "buyer_name" | "buyer_contact" | "channel" | "reference" | "notes"
> & { id?: string };

export async function recordSale(store: EntityStore, args: SaleInput): Promise<Sale> {
  const acct = await load(store, "accounts", args.account_id, "Account");
  if (acct.status !== "available" && acct.status !== "reserved")
    throw new RuleError("sale_status", `Cannot sell an account that is ${acct.status}`);
  if (args.id && (await store.get("sales", args.id))) throw new RuleError("exists", "Sale already recorded");
  const sale = await write(
    store,
    "sales",
    {
      ...metaFor(store, args.id),
      account_id: acct.id,
      sold_at: args.sold_at,
      amount_minor: args.amount_minor,
      currency: args.currency,
      exchange_rate_micro: args.currency === acct.purchase_currency ? null : (args.exchange_rate_micro ?? null),
      buyer_name: args.buyer_name ?? null,
      buyer_contact: args.buyer_contact ?? null,
      channel: args.channel,
      reference: args.reference ?? null,
      notes: args.notes ?? null,
      status: "completed",
    },
    null,
  );
  await write(store, "accounts", { ...acct, status: "sold", published: false, updated_at: store.now() }, acct);
  await audit(store, "sales", sale.id, "sale.recorded", {
    account_id: acct.id,
    amount_minor: sale.amount_minor,
    currency: sale.currency,
    exchange_rate_micro: sale.exchange_rate_micro,
  });
  return sale;
}

export async function voidSale(store: EntityStore, args: { id: string; reason?: string }): Promise<Sale> {
  const prev = await load(store, "sales", args.id, "Sale");
  if (prev.status !== "completed") throw new RuleError("void_status", "Only completed sales can be voided");
  const refunds = await store.list("refunds", { sale_id: prev.id });
  if (refunds.length) throw new RuleError("void_refunded", "This sale has refunds; it cannot be voided");
  const saved = await write(store, "sales", { ...prev, status: "voided", updated_at: store.now() }, prev);
  const acct = await store.get("accounts", prev.account_id);
  if (acct && !acct.deleted && acct.status === "sold")
    await write(store, "accounts", { ...acct, status: "available", updated_at: store.now() }, acct);
  await audit(store, "sales", saved.id, "sale.voided", {
    account_id: prev.account_id,
    reason: args.reason ?? null,
    amount_minor: prev.amount_minor,
    currency: prev.currency,
  });
  return saved;
}

export async function recordRefund(
  store: EntityStore,
  args: { id?: string; sale_id: string; refunded_at: string; amount_minor: number; reason?: string | null; restock: boolean },
): Promise<Refund> {
  const sale = await load(store, "sales", args.sale_id, "Sale");
  if (sale.status !== "completed") throw new RuleError("refund_status", "Only completed sales can be refunded");
  const existing = await store.list("refunds", { sale_id: sale.id });
  const total = existing.reduce((a, r) => a + r.amount_minor, 0) + args.amount_minor;
  if (args.restock && total !== sale.amount_minor)
    throw new RuleError("restock_partial", "Returning the account to inventory requires a full refund of the remaining amount");
  const refund = await write(
    store,
    "refunds",
    {
      ...metaFor(store, args.id),
      sale_id: sale.id,
      account_id: sale.account_id,
      refunded_at: args.refunded_at,
      amount_minor: args.amount_minor,
      currency: sale.currency,
      reason: args.reason ?? null,
      restock: args.restock,
    },
    null,
  );
  if (args.restock) {
    await write(store, "sales", { ...sale, status: "refunded", updated_at: store.now() }, sale);
    const acct = await store.get("accounts", sale.account_id);
    if (acct && !acct.deleted && acct.status === "sold")
      await write(store, "accounts", { ...acct, status: "available", updated_at: store.now() }, acct);
  }
  await audit(store, "refunds", refund.id, "refund.recorded", {
    account_id: sale.account_id,
    sale_id: sale.id,
    amount_minor: refund.amount_minor,
    currency: refund.currency,
    restock: refund.restock,
  });
  return refund;
}

export type ExpenseInput = Pick<Expense, "incurred_at" | "amount_minor" | "currency" | "category" | "description" | "account_id" | "sale_id">;

export async function saveExpense(
  store: EntityStore,
  args: { id?: string; expected_rev?: number; expense: ExpenseInput },
): Promise<Expense> {
  const prev = args.id ? await store.get("expenses", args.id) : null;
  if (prev?.deleted) throw new RuleError("not_found", "Expense not found");
  if (prev) checkRev(prev, args.expected_rev);
  const e = args.expense;
  const fields = {
    incurred_at: e.incurred_at,
    amount_minor: e.amount_minor,
    currency: e.currency,
    category: e.category,
    description: e.description ?? "",
    account_id: e.account_id ?? null,
    sale_id: e.sale_id ?? null,
  };
  const next = prev ? { ...prev, ...fields, updated_at: store.now() } : { ...metaFor(store, args.id), ...fields };
  const saved = await write(store, "expenses", next, prev);
  await audit(store, "expenses", saved.id, prev ? "expense.updated" : "expense.recorded", {
    from: prev ? { amount: prev.amount_minor, currency: prev.currency } : null,
    to: { amount: saved.amount_minor, currency: saved.currency },
    category: saved.category,
    account_id: saved.account_id,
  });
  return saved;
}

export async function deleteExpense(store: EntityStore, args: { id: string }): Promise<void> {
  const prev = await load(store, "expenses", args.id, "Expense");
  await write(store, "expenses", { ...prev, deleted: true, updated_at: store.now() }, prev);
  await audit(store, "expenses", prev.id, "expense.deleted", {
    amount: prev.amount_minor,
    currency: prev.currency,
    account_id: prev.account_id,
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Fixed ids so two devices editing the same setting offline produce a detectable conflict, not duplicates. */
export const SETTING_IDS: Record<SettingKey, string> = {
  store_name: "00000000-0000-7000-8000-000000000001",
  public_whatsapp: "00000000-0000-7000-8000-000000000002",
  default_currency: "00000000-0000-7000-8000-000000000003",
  store_tagline: "00000000-0000-7000-8000-000000000004",
};

export async function saveSetting(store: EntityStore, args: { key: SettingKey; value: string }) {
  if (!SETTING_KEYS.includes(args.key)) throw new RuleError("setting_key", "Unknown setting");
  const id = SETTING_IDS[args.key];
  const prev = await store.get("settings", id);
  const next = prev
    ? { ...prev, value: args.value, deleted: false, updated_at: store.now() }
    : { ...metaFor(store, id), key: args.key, value: args.value };
  return write(store, "settings", next, prev);
}

/* ------------------------------------------------------------------ */
/* Registry (used by the server's admin command endpoint)              */
/* ------------------------------------------------------------------ */

export const COMMANDS = {
  createAccount,
  updateAccount,
  setAccountStatus,
  setPublished,
  setAccountImage,
  deleteAccount,
  saveLink,
  deleteLink,
  saveSharedPassword,
  deleteSharedPassword,
  recordBackupSet,
  setBackupCodeState,
  deleteBackupSet,
  recordSale,
  voidSale,
  recordRefund,
  saveExpense,
  deleteExpense,
  saveSetting,
} as const;
export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<N extends CommandName> = Parameters<(typeof COMMANDS)[N]>[1];

export function isCommandName(v: unknown): v is CommandName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, v);
}

export async function runCommand(store: EntityStore, name: CommandName, args: unknown): Promise<unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new RuleError("bad_args", "Invalid command arguments");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (COMMANDS[name] as (s: EntityStore, a: any) => Promise<unknown>)(store, args);
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
/* ------------------------------------------------------------------ */

export interface AccountBundle {
  account: Account;
  links: LoginLink[];
  credential: Credential | null;
  backupSets: (BackupCodeSet & { codes: BackupCode[] })[];
  sales: Sale[];
  refunds: Refund[];
  expenses: Expense[];
}

export async function loadAccountBundle(r: RowReader, id: string): Promise<AccountBundle | null> {
  const account = await r.get("accounts", id);
  if (!account || account.deleted) return null;
  const [links, creds, sets, codes, sales, refunds, expenses] = await Promise.all([
    r.list("login_links", { account_id: id }),
    r.list("credentials", { account_id: id }),
    r.list("backup_code_sets", { account_id: id }),
    r.list("backup_codes", { account_id: id }),
    r.list("sales", { account_id: id }),
    r.list("refunds", { account_id: id }),
    r.list("expenses", { account_id: id }),
  ]);
  const kindOrder = { email: 0, phone: 1, social: 2 } as const;
  return {
    account,
    links: links.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.created_at.localeCompare(b.created_at)),
    credential: creds[0] ?? null,
    backupSets: sets
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((s) => ({ ...s, codes: codes.filter((c) => c.set_id === s.id).sort((a, b) => a.position - b.position) })),
    sales: sales.sort((a, b) => b.sold_at.localeCompare(a.sold_at)),
    refunds: refunds.sort((a, b) => b.refunded_at.localeCompare(a.refunded_at)),
    expenses,
  };
}

export { isActiveSale };
