/**
 * Owner password reset for someone with direct database access (DATABASE_URL).
 * The new password is typed without echo; it is never printed or logged.
 * This does NOT touch the credential vault: vault secrets still need the vault
 * passphrase or recovery key.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword, passwordProblem } from "../auth";
import { createPgDb } from "../db";

for (const f of ["../../apps/web/.env.local", ".env.local"]) {
  const p = resolve(process.cwd(), f);
  if (!process.env.DATABASE_URL && existsSync(p)) process.loadEnvFile(p);
}

function ask(q: string): Promise<string> {
  let muted = false;
  const out = new Writable({ write: (c, _e, cb) => (muted ? cb() : process.stdout.write(c, cb)) });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((res) => {
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write("\n");
      res(a);
    });
    muted = true;
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pw = await ask("New owner password: ");
  const again = await ask("Repeat password: ");
  if (pw !== again) throw new Error("Passwords do not match");
  const problem = passwordProblem(pw);
  if (problem) throw new Error(problem);
  const db = await createPgDb(process.env.DATABASE_URL, { max: 1 });
  try {
    const r = await db.query("UPDATE owner SET password_hash = $1, password_changed_at = now()", [await hashPassword(pw)]);
    if (!r.rowCount) throw new Error("No owner account exists yet");
    await db.query("UPDATE sessions SET revoked_at = now() WHERE kind = 'web' AND revoked_at IS NULL");
    console.log("Owner password updated. Web sessions were signed out; devices will ask for the new password at next online login.");
  } finally {
    await db.close?.();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
