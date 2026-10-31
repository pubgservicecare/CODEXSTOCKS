import { saleRateFromUsdPkr } from "./fx";
import type { AccountStatus, AnyRow, CodeState, Entity, EntityRowMap, LoginLink, Sale } from "./entities";

/** A business-rule violation. `code` is stable and safe to show/log (no secrets). */
export class RuleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}

/** A concurrent-edit conflict (stale revision). */
export class ConflictError extends Error {
  constructor(
    message: string,
    public current?: AnyRow,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

/* ------------------------------------------------------------------ */
/* Login-link limits                                                   */
/* ------------------------------------------------------------------ */

export const LINK_LIMITS = { social: 2, phone: 1, email: 1, total: 4, min: 1 } as const;

export interface LinkCounts {
  social: number;
  phone: number;
  email: number;
  total: number;
}

export function countLinks(links: Pick<LoginLink, "kind" | "deleted">[]): LinkCounts {
  const c: LinkCounts = { social: 0, phone: 0, email: 0, total: 0 };
  for (const l of links) {
    if (l.deleted) continue;
    c[l.kind]++;
    c.total++;
  }
  return c;
}

/** Throws when the set of (non-deleted) links of ONE account breaks the limits. */
export function assertLinkLimits(links: Pick<LoginLink, "kind" | "deleted">[]): void {
  const c = countLinks(links);
  if (c.social > LINK_LIMITS.social)
    throw new RuleError("link_limit_social", "An account can have at most 2 social login links");
  if (c.phone > LINK_LIMITS.phone)
    throw new RuleError("link_limit_phone", "An account can have at most 1 phone/number login link");
  if (c.email > LINK_LIMITS.email)
    throw new RuleError("link_limit_email", "An account can have at most 1 email login link");
  if (c.total > LINK_LIMITS.total) throw new RuleError("link_limit_total", "An account can have at most 4 login links");
}

/** Which link kinds can still be added to an account. */
export function availableLinkKinds(links: Pick<LoginLink, "kind" | "deleted">[]): ("social" | "phone" | "email")[] {
  const c = countLinks(links);
  if (c.total >= LINK_LIMITS.total) return [];
  const out: ("social" | "phone" | "email")[] = [];
  if (c.social < LINK_LIMITS.social) out.push("social");
  if (c.phone < LINK_LIMITS.phone) out.push("phone");
  if (c.email < LINK_LIMITS.email) out.push("email");
  return out;
}

export function isAccountComplete(links: Pick<LoginLink, "kind" | "deleted">[]): boolean {
  return countLinks(links).total >= LINK_LIMITS.min;
}

/* ------------------------------------------------------------------ */
/* Account status transitions                                          */
/* ------------------------------------------------------------------ */

/**
 * Manual transitions the owner may make. "sold" is only entered by recording a sale
 * and only left by voiding the sale or a restocking refund.
 */
const MANUAL_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  available: ["reserved", "archived"],
  reserved: ["available", "archived"],
  archived: ["available"],
  sold: [],
};

export function canTransition(from: AccountStatus, to: AccountStatus): boolean {
  return from === to || MANUAL_TRANSITIONS[from].includes(to);
}

export function assertManualTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransition(from, to)) {
    if (to === "sold") throw new RuleError("status_sold_via_sale", "Record a sale to mark an account as sold");
    if (from === "sold")
      throw new RuleError("status_from_sold", "Void the sale or record a restocking refund to change a sold account");
    throw new RuleError("status_transition", `Cannot change status from ${from} to ${to}`);
  }
}

/** Public website only shows accounts that are available AND explicitly published AND complete. */
export function isPubliclyListable(
  a: { status: AccountStatus; published: boolean; deleted: boolean },
  linkCount: number,
): boolean {
  return !a.deleted && a.published && a.status === "available" && linkCount >= LINK_LIMITS.min;
}

/* ------------------------------------------------------------------ */
/* Backup-code rules                                                   */
/* ------------------------------------------------------------------ */

export const BACKUP_CODES_PER_SET = 10;
export const BACKUP_CODE_RE = /^\d{8}$/;

/** Validates plaintext codes typed by the owner. Leading zeros are significant: codes are strings. */
export function validateBackupCodes(codes: string[]): string[] {
  if (codes.length < 1) throw new RuleError("codes_empty", "Enter at least one backup code");
  if (codes.length > BACKUP_CODES_PER_SET)
    throw new RuleError("codes_too_many", `A backup-code set holds at most ${BACKUP_CODES_PER_SET} codes`);
  const seen = new Set<string>();
  codes.forEach((c, i) => {
    if (!BACKUP_CODE_RE.test(c))
      throw new RuleError("code_format", `Code ${i + 1} must be exactly 8 digits (leading zeros allowed)`);
    if (seen.has(c)) throw new RuleError("code_duplicate", `Code ${i + 1} is a duplicate within this set`);
    seen.add(c);
  });
  return codes;
}

const CODE_TRANSITIONS: Record<CodeState, CodeState[]> = {
  unused: ["used", "revoked"],
  used: ["revoked"],
  revoked: [],
};

export function assertCodeTransition(from: CodeState, to: CodeState): void {
  if (from !== to && !CODE_TRANSITIONS[from].includes(to))
    throw new RuleError("code_transition", `A ${from} backup code cannot become ${to}`);
}

export function maskCode(code: string): string {
  return "•••• ••" + code.slice(-2);
}

/* ------------------------------------------------------------------ */
/* 2-Step Verification warnings                                        */
/* ------------------------------------------------------------------ */

export function twoStepWarning(
  link: Pick<LoginLink, "kind" | "two_step_enabled" | "two_step_accessible">,
  unusedCodes: number,
): string | null {
  if (!link.two_step_enabled) return null;
  if (link.two_step_accessible === false && unusedCodes === 0)
    return "2-Step Verification is ON but no usable verification method or unused backup code is recorded. This login may be unrecoverable.";
  if (link.two_step_accessible === null && unusedCodes === 0)
    return "2-Step Verification is ON. Record whether the verification destination is accessible, or add backup codes.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Cross-row invariants (enforced by desktop commands AND server push) */
/* ------------------------------------------------------------------ */

export interface RowReader {
  get<E extends Entity>(entity: E, id: string): Promise<EntityRowMap[E] | null>;
  list<E extends Entity>(entity: E, where: Partial<Record<string, string | number | boolean | null>>): Promise<EntityRowMap[E][]>;
}

/** Sales that still "own" the account: completed sales (a voided or restock-refunded sale does not). */
export function isActiveSale(s: Pick<Sale, "status" | "deleted">): boolean {
  return !s.deleted && s.status === "completed";
}

/**
 * Validates a row against the rest of the data set before it is written.
 * `prev` is the currently stored version (or null for an insert).
 */
export async function checkInvariants<E extends Entity>(
  r: RowReader,
  entity: E,
  row: EntityRowMap[E],
  prev: EntityRowMap[E] | null,
): Promise<void> {
  if (row.deleted && entity !== "login_links" && entity !== "audit_events") return;
  switch (entity) {
    case "login_links": {
      const l = row as LoginLink;
      const acct = await r.get("accounts", l.account_id);
      if (!acct || acct.deleted) throw new RuleError("parent_missing", "Login link refers to an unknown account");
      const others = (await r.list("login_links", { account_id: l.account_id })).filter((x) => x.id !== l.id);
      if (l.deleted) {
        if (acct.published && acct.status === "available" && others.length === 0)
          throw new RuleError("link_min", "A published account must keep at least one login link. Unpublish it first.");
        return;
      }
      assertLinkLimits([...others, l]);
      if (l.credential_id) {
        const cred = await r.get("credentials", l.credential_id);
        if (!cred || cred.deleted || cred.account_id !== l.account_id)
          throw new RuleError("credential_mismatch", "The shared password must belong to the same account");
      }
      return;
    }
    case "credentials": {
      const c = row as EntityRowMap["credentials"];
      const ca = await r.get("accounts", c.account_id);
      if (!ca || ca.deleted)
        throw new RuleError("parent_missing", "Credential refers to an unknown account");
      const others = (await r.list("credentials", { account_id: c.account_id })).filter((x) => x.id !== c.id);
      if (others.length > 0)
        throw new RuleError("credential_single", "Each account has exactly one shared phone/email password");
      return;
    }
    case "backup_code_sets": {
      const s = row as EntityRowMap["backup_code_sets"];
      const sa = await r.get("accounts", s.account_id);
      if (!sa || sa.deleted) throw new RuleError("parent_missing", "Unknown account");
      if (s.link_id) {
        const link = await r.get("login_links", s.link_id);
        if (!link || link.account_id !== s.account_id)
          throw new RuleError("link_mismatch", "Verification context must be a link of the same account");
      }
      return;
    }
    case "backup_codes": {
      const c = row as EntityRowMap["backup_codes"];
      const set = await r.get("backup_code_sets", c.set_id);
      if (!set || set.deleted || set.account_id !== c.account_id) throw new RuleError("parent_missing", "Unknown backup-code set");
      const others = (await r.list("backup_codes", { set_id: c.set_id })).filter((x) => x.id !== c.id);
      if (others.length >= BACKUP_CODES_PER_SET)
        throw new RuleError("codes_too_many", `A backup-code set holds at most ${BACKUP_CODES_PER_SET} codes`);
      if (others.some((o) => o.code_tag === c.code_tag))
        throw new RuleError("code_duplicate", "Duplicate backup code within the same set");
      if (others.some((o) => o.position === c.position))
        throw new RuleError("code_position", "Duplicate code position within the set");
      if (prev) {
        const p = prev as EntityRowMap["backup_codes"];
        if (p.code_ct !== c.code_ct || p.code_tag !== c.code_tag)
          throw new RuleError("code_immutable", "Recorded backup codes cannot be edited; revoke and record a new set");
        assertCodeTransition(p.state, c.state);
      }
      return;
    }
    case "sales": {
      const s = row as Sale;
      const acct = await r.get("accounts", s.account_id);
      if (!acct || acct.deleted) throw new RuleError("parent_missing", "Sale refers to an unknown account");
      if (s.currency !== acct.purchase_currency && !s.exchange_rate_micro)
        throw new RuleError(
          "rate_required",
          `Sale is in ${s.currency} but the purchase was in ${acct.purchase_currency}: record the exchange rate`,
        );
      // When a USD/PKR snapshot is stored, the cross-currency profit rate must be the same rate.
      if (s.fx_usd_pkr_micro && s.currency !== acct.purchase_currency && s.exchange_rate_micro) {
        const expected = saleRateFromUsdPkr(acct.purchase_currency, s.currency, s.fx_usd_pkr_micro)!;
        if (Math.abs(expected - s.exchange_rate_micro) > Math.max(1, expected / 10_000))
          throw new RuleError("rate_mismatch", "The sale's exchange rate does not match its recorded USD/PKR rate");
      }
      if (isActiveSale(s)) {
        const dup = (await r.list("sales", { account_id: s.account_id })).find((x) => x.id !== s.id && isActiveSale(x));
        if (dup) throw new RuleError("duplicate_sale", "This account already has a completed sale");
      }
      return;
    }
    case "refunds": {
      const f = row as EntityRowMap["refunds"];
      const sale = await r.get("sales", f.sale_id);
      if (!sale || sale.deleted || sale.account_id !== f.account_id) throw new RuleError("parent_missing", "Refund refers to an unknown sale");
      if (sale.status === "voided") throw new RuleError("refund_voided", "Cannot refund a voided sale");
      if (f.currency !== sale.currency)
        throw new RuleError("refund_currency", `Refunds must be in the sale currency (${sale.currency})`);
      const others = (await r.list("refunds", { sale_id: f.sale_id })).filter((x) => x.id !== f.id);
      const total = others.reduce((a, x) => a + x.amount_minor, 0) + f.amount_minor;
      if (total > sale.amount_minor) throw new RuleError("refund_exceeds", "Refunds cannot exceed the sale amount");
      return;
    }
    case "audit_events": {
      if (prev) throw new RuleError("audit_immutable", "Audit events are append-only");
      return;
    }
    default:
      return;
  }
}
