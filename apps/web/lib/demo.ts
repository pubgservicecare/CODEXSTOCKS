import "server-only";
import { createApi, type Db } from "@codex/server";
import { newId } from "@codex/shared";

/**
 * DEMO data for local previews (DEMO_MODE=1 with no DATABASE_URL). Runs only against the
 * in-memory PGlite database created in lib/server.ts — never against Neon/production.
 */
export async function seedDemo(db: Db) {
  const api = createApi({
    db,
    setupToken: "demo-setup-token-0000",
    corsOrigins: [],
    adminOrigins: ["http://localhost:3000"],
    cookieSecure: false,
    passwordParams: { logN: 14, r: 8, p: 1, keyLen: 32 },
    log: () => undefined,
  });
  const call = async (path: string, body: unknown, token?: string) => {
    const r = await api(
      new Request(`http://localhost/api/v1${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
    return r.json();
  };
  const { token } = await call("/auth/setup", {
    setup_token: "demo-setup-token-0000",
    username: "demo",
    password: "Demo-Owner-Pass1!",
    client: "desktop",
    device: { name: "Demo seeder", platform: "server" },
  });
  const cmd = (name: string, args: unknown) => call(`/admin/commands/${name}`, args, token);
  await cmd("saveSetting", { key: "public_whatsapp", value: "+92 300 0000000" });
  await cmd("saveSetting", { key: "store_tagline", value: "Verified PUBG Mobile accounts · DEMO DATA" });
  const items = [
    {
      title: "DEMO · Conqueror S12 · Glacier M416 lvl 7",
      price: 4500000,
      cur: "PKR",
      desc: "  ★ Conqueror x3   (S10, S11, S12)\n\n  WEAPONS\n  - M416  Glacier        lvl 7\n  - AKM   Glacier        lvl 4\n\n  OUTFITS\n\t• Golden Pharaoh X-Suit   (max)\n\t• Blood Raven X-Suit\n\nLogin: Facebook + email   |   Full access transfer",
    },
    { title: "DEMO · Ace Dominator · 2 Mythic sets", price: 18000, cur: "USD", desc: "Ace Dominator\n\nMythics:\n  1. Fiore\n  2. Silver Fang\n\nNo ban history." },
    { title: "DEMO · Budget starter · RP S20", price: 900000, cur: "PKR", desc: "Starter account\n   - RP S20 maxed\n   - 3 upgradable guns" },
  ];
  for (const it of items) {
    const id = newId();
    await cmd("createAccount", {
      id,
      account: {
        title: it.title, purchase_cost_minor: Math.round(it.price * 0.6), purchase_currency: it.cur,
        list_price_minor: it.price, list_currency: it.cur, description_public: it.desc, internal_notes: "DEMO private note",
      },
      links: [{ kind: "email", identifier: "demo-login@example.com", owner_name: "Demo owner" }],
    });
    await cmd("setPublished", { id, published: true });
  }
}
