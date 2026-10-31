// Single-owner policy, enforced by the server (not only hidden in the UI).
import { describe, expect, it } from "vitest";
import { loginDevice, OWNER, SETUP_TOKEN, setupOwner, startServer } from "./helpers";

describe("single owner", () => {
  it("reports setup as closed once the owner exists, even while SETUP_TOKEN is still configured", async () => {
    const s = await startServer();
    expect((await s.call("GET", "/auth/status")).json).toEqual({ owner_exists: false, setup_enabled: true });
    await setupOwner(s);
    expect((await s.call("GET", "/auth/status")).json).toEqual({ owner_exists: true, setup_enabled: false });
    const off = await startServer({ setupToken: undefined });
    expect((await off.call("GET", "/auth/status")).json).toEqual({ owner_exists: false, setup_enabled: false });
  });

  it("refuses a second owner with the correct token, a wrong token, or for any client", async () => {
    const s = await startServer();
    await setupOwner(s);
    for (const token of [SETUP_TOKEN, "wrong-token-wrong-token"])
      for (const client of ["web", "desktop"]) {
        const r = await s.call("POST", "/auth/setup", {
          body: { setup_token: token, username: "second", password: "An0ther$trongPass", client, device: { name: "X", platform: "windows" } },
        });
        expect(r.status).toBe(409);
        expect(r.json.error.code).toBe("owner_exists");
      }
    const owners = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM owner");
    expect(owners.rows[0].n).toBe(1);
    // The original owner still signs in; the rejected username cannot.
    expect((await s.call("POST", "/auth/login", { body: { ...OWNER, client: "web" } })).status).toBe(200);
    expect((await s.call("POST", "/auth/login", { body: { username: "second", password: "An0ther$trongPass", client: "web" } })).status).toBe(401);
  });

  it("throttles guessing of the setup code", async () => {
    const s = await startServer();
    for (let i = 0; i < 8; i++)
      expect((await s.call("POST", "/auth/setup", { body: { setup_token: `guess-guess-guess-${i}`, ...OWNER, client: "web" } })).status).toBe(403);
    const blocked = await s.call("POST", "/auth/setup", { body: { setup_token: SETUP_TOKEN, ...OWNER, client: "web" } });
    expect(blocked.status).toBe(429);
  });

  it("has no registration route, and private data needs an authenticated owner session", async () => {
    const s = await startServer();
    await setupOwner(s);
    for (const path of ["/auth/register", "/auth/signup", "/users", "/owners"])
      expect((await s.call("POST", path, { body: { ...OWNER } })).status).toBe(404);
    for (const path of ["/admin/entities/accounts", "/admin/dashboard", "/devices", "/vault", "/auth/me", "/sync/pull?since=0"])
      expect((await s.call("GET", path)).status).toBe(401);
    expect((await s.call("GET", "/admin/entities/accounts", { token: "not-a-real-token" })).status).toBe(401);
    expect((await s.call("POST", "/sync/push", { body: { ops: [] } })).status).toBe(401);
  });

  it("enrols a new device only after a correct owner password", async () => {
    const s = await startServer();
    await setupOwner(s, "PC-1");
    const bad = await s.call("POST", "/auth/login", { body: { username: OWNER.username, password: "wrong", client: "desktop", device: { name: "PC-2", platform: "windows" } } });
    expect(bad.status).toBe(401);
    const devicesBefore = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM devices");
    expect(devicesBefore.rows[0].n).toBe(1);
    const ok = await loginDevice(s, "PC-2");
    expect(ok.device_id).toBeTruthy();
    expect((await s.call("GET", "/admin/entities/accounts", { token: ok.token })).status).toBe(200);
    const devicesAfter = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM devices");
    expect(devicesAfter.rows[0].n).toBe(2);
  });
});
