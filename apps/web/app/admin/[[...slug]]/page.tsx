import { cookies } from "next/headers";
import { authenticate, COOKIE_DEV, COOKIE_SECURE } from "@codex/server";
import { getDb } from "../../../lib/server";
import { AdminRoot } from "../AdminRoot";

export const dynamic = "force-dynamic";

/**
 * Server-side gate: the session cookie is validated against the database on every request.
 * Unauthenticated visitors only receive the login form; all data comes from the API,
 * which enforces authentication independently.
 */
export default async function AdminPage() {
  const jar = await cookies();
  const token = jar.get(COOKIE_SECURE)?.value ?? jar.get(COOKIE_DEV)?.value ?? null;
  let username: string | null = null;
  let unavailable = false;
  try {
    const db = await getDb();
    // Both reads at once (one database round trip); the name is only used when the session is valid.
    const [auth, owner] = await Promise.all([
      authenticate(db, token, new Date()),
      token ? db.query<{ username: string }>("SELECT username FROM owner") : null,
    ]);
    if (auth?.kind === "web") username = owner?.rows[0]?.username ?? null;
  } catch {
    unavailable = true;
  }
  return <AdminRoot username={username} unavailable={unavailable} />;
}
