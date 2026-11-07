// Installment plans and payments on the desktop: offline-first, synced once, conflicts surfaced, and an app
// update that learns new record types downloads them even though the older version had skipped them.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { addDays, autoSchedule, localDate, newId, planStateOf, type Account, type InstallmentPlan } from "@codex/shared";
import { SETUP_TOKEN } from "../../server/test/helpers";
import { accountInput, API, PW, VAULT_PW, world } from "./harness";

const R = (rupees: number) => Math.round(rupees * 100);
const links = [{ kind: "email", identifier: "x@y.zz" }];

async function sellOnInstallments(core: Awaited<ReturnType<Awaited<ReturnType<typeof world>>["device"]>>["core"], start: string) {
  const acct = await core.exec<Account>("createAccount", { account: accountInput({ purchase_cost_minor: R(60_000), list_price_minor: R(100_000) }), links });
  const schedule = autoSchedule({ first_due_on: addDays(start, 20), count: 3, interval_days: 20, principal_minor: R(50_000) });
  const planId = newId();
  await core.exec("createInstallmentSale", {
    sale: { id: newId(), account_id: acct.id, sold_at: `${start}T10:00:00.000Z`, exchange_rate_micro: null, channel: "whatsapp", reference: null, notes: null },
    currency: "PKR",
    plan_id: planId,
    receipt_id: newId(),
    issued_on: start,
    plan: {
      customer_name: "Offline customer", original_minor: R(100_000), advance_minor: R(50_000), advance_due_on: start, start_on: start,
      schedule_mode: "auto", interval_days: 20, first_due_on: schedule[0].due_on, schedule,
      extra_rate_minor: R(400), extra_free_days: 30, extra_end: "final_due", fine_minor: R(1_500), fine_mode: "flat", fine_grace_days: 0,
    },
    advance_payment: { id: newId(), paid_on: start, amount_minor: R(50_000), currency: "PKR", method: "cash" },
  });
  return { acct, planId, schedule };
}

describe("installment plans on the desktop", () => {
  it("are created and paid offline, then synced exactly once (also after a lost response)", async () => {
    const w = await world();
    const d = await w.device();
    await d.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const start = addDays(localDate(), -25);
    w.net.online = false;
    const { planId, schedule } = await sellOnInstallments(d.core, start);
    const payId = newId();
    await d.core.exec("recordPlanPayment", { id: payId, plan_id: planId, kind: "installment", paid_on: schedule[0].due_on, amount_minor: 1_666_667, currency: "PKR", method: "cash" });
    const [plan] = await d.core.list("installment_plans");
    const local = planStateOf(plan, await d.core.list("payments"), localDate());
    expect(local.entries[1].status).toBe("paid");
    expect(await d.core.list("receipts")).toHaveLength(3); // plan + advance + installment
    expect((await d.core.syncStatus()).pending).toBeGreaterThan(0);

    w.net.online = true;
    w.net.dropNextResponse = true;
    expect((await d.core.syncNow()).error).not.toBeNull();
    expect((await d.core.syncNow()).error).toBeNull();
    const count = async (t: string) => Number((await w.server.db.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    expect(await count("installment_plans")).toBe(1);
    expect(await count("payments")).toBe(2);
    expect(await count("receipts")).toBe(3);
    expect(await count("sales")).toBe(1);
    // Retrying the same command (double tap) is reported, not duplicated.
    await expect(d.core.exec("recordPlanPayment", { id: payId, plan_id: planId, kind: "installment", paid_on: schedule[0].due_on, amount_minor: 1_666_667, currency: "PKR", method: "cash" })).rejects.toMatchObject({ code: "exists" });
    const report = (await d.core.dashboard()).report.byCurrency.PKR;
    expect(report.grossSales).toBe(R(100_000));
    expect(report.planCollected).toBe(R(50_000) + 1_666_667);
  });

  it("two PCs recording a payment for the same installment offline: both are kept, any excess is customer credit", async () => {
    const w = await world();
    const a = await w.device("PC-A");
    await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const { planId, schedule } = await sellOnInstallments(a.core, addDays(localDate(), -25));
    await a.core.syncNow();
    const b = await w.device("PC-B");
    await b.core.connectExisting({ apiBase: API, username: "owner", password: PW });
    w.net.online = false;
    for (const pc of [a, b])
      await pc.core.exec("recordPlanPayment", { id: newId(), plan_id: planId, kind: "installment", paid_on: schedule[0].due_on, amount_minor: 1_666_667, currency: "PKR", method: "cash" });
    w.net.online = true;
    expect((await a.core.syncNow()).error).toBeNull();
    expect((await b.core.syncNow()).error).toBeNull();
    expect((await a.core.syncNow()).error).toBeNull();
    const [plan] = await a.core.list("installment_plans");
    const st = planStateOf(plan, await a.core.list("payments"), localDate());
    expect(st.totals.received).toBe(R(50_000) + 2 * 1_666_667);
    expect(st.entries[1].status).toBe("paid");
    expect(st.totals.collected + st.totals.credit).toBe(st.totals.received);
  });

  it("the same plan changed differently on two PCs becomes a visible conflict, never a silent overwrite", async () => {
    const w = await world();
    const a = await w.device("PC-A");
    await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const start = addDays(localDate(), -5);
    const { planId } = await sellOnInstallments(a.core, start);
    await a.core.syncNow();
    const b = await w.device("PC-B");
    await b.core.connectExisting({ apiBase: API, username: "owner", password: PW });
    w.net.online = false;
    await a.core.exec("revisePlan", { plan_id: planId, revision: { kind: "move", n: 2, due_on: addDays(start, 45), scope: "one" }, reason: "Asked on phone", as_of: localDate() });
    await b.core.exec("revisePlan", { plan_id: planId, revision: { kind: "move", n: 2, due_on: addDays(start, 50), scope: "one" }, reason: "Asked in person", as_of: localDate() });
    w.net.online = true;
    await a.core.syncNow();
    const rb = await b.core.syncNow();
    expect(rb.conflicts).toBe(1);
    const conflicts = await b.core.conflicts();
    expect(conflicts[0]).toMatchObject({ entity: "installment_plans", entity_id: planId });
    expect(conflicts[0].fields).toContain("schedule_json");
    const cloud = (await w.server.db.query<{ schedule_json: string }>("SELECT schedule_json FROM installment_plans WHERE id = $1", [planId])).rows[0];
    expect(JSON.parse(cloud.schedule_json)[1].due_on).toBe(addDays(start, 45));
  });

  it("an app update downloads plans and payments that the older version skipped", async () => {
    const w = await world();
    const a = await w.device("PC-A");
    await a.core.setupCloud({ apiBase: API, setupToken: SETUP_TOKEN, username: "owner", password: PW, vaultPassphrase: VAULT_PW, currency: "PKR" });
    const b = await w.device("PC-B");
    await b.core.connectExisting({ apiBase: API, username: "owner", password: PW });
    const { planId } = await sellOnInstallments(a.core, addDays(localDate(), -10));
    await a.core.syncNow();
    await b.core.syncNow();
    b.driver.close();
    // Make PC-B look like a 1.0.4 install that pulled past these records without storing them.
    const raw = new DatabaseSync(b.path);
    for (const t of ["installment_plans", "payments", "debts", "receipts"]) raw.exec(`DROP TABLE ${t}`);
    raw.exec("DELETE FROM kv WHERE key = 'sync_schema'");
    raw.close();
    const again = await w.device("PC-B", b.path, b.files);
    await again.core.login("owner", PW);
    expect(await again.core.list("installment_plans")).toHaveLength(0);
    expect((await again.core.syncNow()).error).toBeNull();
    const plans = (await again.core.list("installment_plans")) as InstallmentPlan[];
    expect(plans.map((p) => p.id)).toEqual([planId]);
    expect(await again.core.list("payments")).toHaveLength(1);
    expect(await again.core.list("receipts")).toHaveLength(2);
  });
});
