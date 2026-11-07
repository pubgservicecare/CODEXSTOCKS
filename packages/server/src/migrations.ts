import type { Db } from "./db";

/**
 * Versioned, forward-only migrations. They are applied in order inside a transaction
 * and recorded in schema_migrations. They NEVER drop tables or delete data.
 * To change the schema, append a new migration — never edit an applied one
 * (a checksum guard refuses to run if an applied migration's SQL has changed).
 */
export interface Migration {
  id: string;
  sql: string;
}

const meta = `
  id uuid PRIMARY KEY,
  rev integer NOT NULL CHECK (rev >= 1),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  change_seq bigint NOT NULL`;

const cur = (col: string) => `${col} text NOT NULL CHECK (${col} IN ('USD','PKR'))`;

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
CREATE SEQUENCE change_seq_global;

CREATE TABLE owner (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  platform text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('web','device')),
  device_id uuid REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX sessions_device_idx ON sessions(device_id);

CREATE TABLE login_attempts (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  failures integer NOT NULL
);

CREATE TABLE vault (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  vault_id uuid NOT NULL,
  envelope text NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_ops (
  op_id uuid PRIMARY KEY,
  device_id uuid,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conflicts (
  id uuid PRIMARY KEY,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  op_id uuid NOT NULL,
  device_id uuid,
  client_row jsonb NOT NULL,
  server_rev integer,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX conflicts_open_idx ON conflicts(status, created_at);

CREATE TABLE accounts (${meta},
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  status text NOT NULL CHECK (status IN ('available','reserved','sold','archived')),
  published boolean NOT NULL DEFAULT false,
  purchase_cost_minor bigint NOT NULL CHECK (purchase_cost_minor >= 0),
  ${cur("purchase_currency")},
  purchased_at date,
  purchase_reference text,
  list_price_minor bigint CHECK (list_price_minor >= 0),
  list_currency text CHECK (list_currency IN ('USD','PKR')),
  description_public text NOT NULL DEFAULT '',
  youtube_url text,
  image_url text,
  image_file_id text,
  old_owner_name text,
  old_owner_whatsapp text,
  show_old_owner_public boolean NOT NULL DEFAULT false,
  internal_notes text NOT NULL DEFAULT ''
);
CREATE INDEX accounts_seq_idx ON accounts(change_seq);
CREATE INDEX accounts_public_idx ON accounts(status, published) WHERE NOT deleted;

CREATE TABLE login_links (${meta},
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('social','phone','email')),
  provider text CHECK (provider IN ('google','facebook','apple','x','game_center','whatsapp','other')),
  identifier text,
  display_name text,
  owner_name text,
  owner_contact text,
  owner_notes text,
  status text NOT NULL,
  credential_id uuid,
  two_step_enabled boolean NOT NULL DEFAULT false,
  two_step_method text NOT NULL DEFAULT 'none',
  two_step_destination text,
  two_step_accessible boolean,
  recovery_info text
);
CREATE INDEX login_links_seq_idx ON login_links(change_seq);
CREATE INDEX login_links_account_idx ON login_links(account_id);
-- Database-level backstop for the phone/email limits (social limit is checked in code).
CREATE UNIQUE INDEX login_links_one_phone ON login_links(account_id) WHERE kind = 'phone' AND NOT deleted;
CREATE UNIQUE INDEX login_links_one_email ON login_links(account_id) WHERE kind = 'email' AND NOT deleted;

CREATE TABLE credentials (${meta},
  account_id uuid NOT NULL REFERENCES accounts(id),
  label text NOT NULL,
  secret_ct text NOT NULL CHECK (secret_ct LIKE 'cx1.%'),
  secret_updated_at timestamptz NOT NULL
);
CREATE INDEX credentials_seq_idx ON credentials(change_seq);
CREATE UNIQUE INDEX credentials_one_per_account ON credentials(account_id) WHERE NOT deleted;

CREATE TABLE backup_code_sets (${meta},
  account_id uuid NOT NULL REFERENCES accounts(id),
  link_id uuid,
  label text NOT NULL
);
CREATE INDEX backup_code_sets_seq_idx ON backup_code_sets(change_seq);
CREATE INDEX backup_code_sets_account_idx ON backup_code_sets(account_id);

CREATE TABLE backup_codes (${meta},
  set_id uuid NOT NULL REFERENCES backup_code_sets(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
  code_ct text NOT NULL CHECK (code_ct LIKE 'cx1.%'),
  code_tag text NOT NULL,
  state text NOT NULL CHECK (state IN ('unused','used','revoked')),
  used_at timestamptz
);
CREATE INDEX backup_codes_seq_idx ON backup_codes(change_seq);
CREATE INDEX backup_codes_set_idx ON backup_codes(set_id);
CREATE UNIQUE INDEX backup_codes_unique_tag ON backup_codes(set_id, code_tag) WHERE NOT deleted;

CREATE TABLE sales (${meta},
  account_id uuid NOT NULL REFERENCES accounts(id),
  sold_at timestamptz NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  ${cur("currency")},
  exchange_rate_micro bigint CHECK (exchange_rate_micro > 0),
  buyer_name text,
  buyer_contact text,
  channel text NOT NULL,
  reference text,
  notes text,
  status text NOT NULL CHECK (status IN ('completed','refunded','voided'))
);
CREATE INDEX sales_seq_idx ON sales(change_seq);
CREATE INDEX sales_account_idx ON sales(account_id);
-- Never two completed sales for one account (duplicate-sale backstop).
CREATE UNIQUE INDEX sales_one_completed ON sales(account_id) WHERE status = 'completed' AND NOT deleted;

CREATE TABLE refunds (${meta},
  sale_id uuid NOT NULL REFERENCES sales(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  refunded_at timestamptz NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ${cur("currency")},
  reason text,
  restock boolean NOT NULL DEFAULT false
);
CREATE INDEX refunds_seq_idx ON refunds(change_seq);
CREATE INDEX refunds_sale_idx ON refunds(sale_id);

CREATE TABLE expenses (${meta},
  incurred_at date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ${cur("currency")},
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  account_id uuid REFERENCES accounts(id),
  sale_id uuid REFERENCES sales(id)
);
CREATE INDEX expenses_seq_idx ON expenses(change_seq);

CREATE TABLE audit_events (${meta},
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  details text NOT NULL,
  actor text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX audit_events_seq_idx ON audit_events(change_seq);
CREATE INDEX audit_events_entity_idx ON audit_events(entity_id);

CREATE TABLE settings (${meta},
  key text NOT NULL,
  value text NOT NULL
);
CREATE INDEX settings_seq_idx ON settings(change_seq);
CREATE UNIQUE INDEX settings_key_idx ON settings(key) WHERE NOT deleted;
`,
  },
  {
    // Additive only: nullable columns for USD/PKR exchange-rate snapshots on purchases, sales and
    // expenses, plus a one-row-per-pair cache of the latest reference rate. Existing rows keep NULL
    // (no snapshot); no existing value is changed.
    id: "0002_fx_snapshots",
    sql: `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS purchase_fx_micro bigint CHECK (purchase_fx_micro > 0);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS purchase_fx_source text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS purchase_fx_at text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fx_usd_pkr_micro bigint CHECK (fx_usd_pkr_micro > 0);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fx_source text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fx_at text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS fx_override_reason text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_usd_pkr_micro bigint CHECK (fx_usd_pkr_micro > 0);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_source text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fx_at text;

CREATE TABLE IF NOT EXISTS fx_rates (
  pair text PRIMARY KEY CHECK (pair = 'USD/PKR'),
  rate_micro bigint CHECK (rate_micro > 0),
  source text,
  source_url text,
  frequency text,
  effective_at timestamptz,
  next_update_at timestamptz,
  retrieved_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);
`,
  },
  {
    // Additive only: installment plans, payments, money to receive / to pay, issued receipts, readable
    // account URLs (slug + history) with SEO overrides, and a USDT/PKR row in the rate cache. No existing
    // row or column is changed or removed; the only constraint change WIDENS the rate-cache pair check.
    id: "0003_payments_slugs",
    sql: `
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS seo_title text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS seo_description text;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_slug_unique ON accounts(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_slugs (
  slug text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_slugs_account_idx ON account_slugs(account_id);

CREATE TABLE IF NOT EXISTS installment_plans (${meta},
  account_id uuid NOT NULL REFERENCES accounts(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) > 0),
  customer_phone text,
  customer_whatsapp text,
  account_title text NOT NULL,
  account_ref text,
  ${cur("currency")},
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  advance_minor bigint NOT NULL CHECK (advance_minor >= 0),
  advance_due_on date,
  start_on date NOT NULL,
  duration_months integer,
  duration_days integer,
  schedule_mode text NOT NULL CHECK (schedule_mode IN ('auto','manual')),
  interval_days integer,
  first_due_on date NOT NULL,
  schedule_json text NOT NULL,
  extra_rate_minor bigint NOT NULL CHECK (extra_rate_minor >= 0),
  extra_free_days integer NOT NULL CHECK (extra_free_days >= 0),
  extra_end text NOT NULL CHECK (extra_end IN ('final_due','date','days','paid')),
  extra_end_on date,
  extra_days integer,
  fine_minor bigint NOT NULL CHECK (fine_minor >= 0),
  fine_mode text NOT NULL CHECK (fine_mode IN ('flat','per_day')),
  fine_grace_days integer NOT NULL CHECK (fine_grace_days >= 0),
  payment_notes text NOT NULL DEFAULT '',
  agreement_ref text,
  agreement_notes text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active','cancelled')),
  cancelled_on date,
  cancel_reason text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  waivers_json text NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS installment_plans_seq_idx ON installment_plans(change_seq);
CREATE INDEX IF NOT EXISTS installment_plans_account_idx ON installment_plans(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS installment_plans_one_per_sale ON installment_plans(sale_id) WHERE NOT deleted;

CREATE TABLE IF NOT EXISTS debts (${meta},
  direction text NOT NULL CHECK (direction IN ('receive','pay')),
  party_name text NOT NULL CHECK (length(btrim(party_name)) > 0),
  party_contact text,
  description text NOT NULL DEFAULT '',
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  currency text NOT NULL CHECK (currency IN ('PKR','USD','USDT')),
  txn_on date NOT NULL,
  due_on date,
  notes text NOT NULL DEFAULT '',
  charges_json text NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('open','cancelled')),
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS debts_seq_idx ON debts(change_seq);

CREATE TABLE IF NOT EXISTS payments (${meta},
  receipt_no text NOT NULL,
  target text NOT NULL CHECK (target IN ('plan','debt')),
  plan_id uuid REFERENCES installment_plans(id),
  debt_id uuid REFERENCES debts(id),
  kind text NOT NULL CHECK (kind IN ('advance','installment','settlement','receive','pay')),
  installment_no integer,
  paid_on date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('PKR','USD','USDT')),
  credited_minor bigint NOT NULL CHECK (credited_minor > 0),
  rate_micro bigint CHECK (rate_micro > 0),
  rate_source text,
  rate_at text,
  pkr_micro bigint CHECK (pkr_micro > 0),
  pkr_source text,
  pkr_at text,
  method text NOT NULL,
  reference text,
  notes text,
  allocations_json text NOT NULL,
  actor text NOT NULL,
  status text NOT NULL CHECK (status IN ('recorded','reversed')),
  reversed_at timestamptz,
  reversal_reason text,
  CHECK ((target = 'plan' AND plan_id IS NOT NULL AND debt_id IS NULL) OR (target = 'debt' AND debt_id IS NOT NULL AND plan_id IS NULL))
);
CREATE INDEX IF NOT EXISTS payments_seq_idx ON payments(change_seq);
CREATE INDEX IF NOT EXISTS payments_plan_idx ON payments(plan_id);
CREATE INDEX IF NOT EXISTS payments_debt_idx ON payments(debt_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_no_unique ON payments(receipt_no);

CREATE TABLE IF NOT EXISTS receipts (${meta},
  receipt_no text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan','payment')),
  plan_id uuid REFERENCES installment_plans(id),
  payment_id uuid REFERENCES payments(id),
  issued_at timestamptz NOT NULL,
  revision integer,
  data_json text NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_seq_idx ON receipts(change_seq);
CREATE INDEX IF NOT EXISTS receipts_plan_idx ON receipts(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS receipts_receipt_no_unique ON receipts(receipt_no);

ALTER TABLE fx_rates DROP CONSTRAINT IF EXISTS fx_rates_pair_check;
ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_pair_check CHECK (pair IN ('USD/PKR','USDT/PKR'));
`,
  },
];

async function checksum(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

const FORBIDDEN = /\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i;

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

export async function migrationStatus(db: Db, migrations = MIGRATIONS): Promise<MigrationStatus> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ id: string; checksum: string }>("SELECT id, checksum FROM schema_migrations ORDER BY id");
  const applied = new Map(rows.map((r) => [r.id, r.checksum]));
  for (const m of migrations) {
    const c = applied.get(m.id);
    if (c && c !== (await checksum(m.sql)))
      throw new Error(`Migration ${m.id} was modified after being applied. Add a new migration instead.`);
  }
  return { applied: [...applied.keys()], pending: migrations.filter((m) => !applied.has(m.id)).map((m) => m.id) };
}

/** Apply pending migrations. Each migration runs in its own transaction. Never destructive. */
export async function migrate(db: Db, migrations = MIGRATIONS): Promise<string[]> {
  const status = await migrationStatus(db, migrations);
  const done: string[] = [];
  for (const m of migrations) {
    if (!status.pending.includes(m.id)) continue;
    if (FORBIDDEN.test(m.sql)) throw new Error(`Migration ${m.id} contains a destructive statement and was refused`);
    await db.tx(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(724001)");
      const again = await tx.query("SELECT 1 FROM schema_migrations WHERE id = $1", [m.id]);
      if (again.rowCount) return;
      for (const stmt of splitSql(m.sql)) await tx.query(stmt);
      await tx.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [m.id, await checksum(m.sql)]);
    });
    done.push(m.id);
  }
  return done;
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
