import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  autoDueDates,
  autoSchedule,
  computePlanState,
  dayNumber,
  isCalendarDate,
  reviseSchedule,
  settlementQuote,
  splitPrincipal,
  suggestAllocation,
  validateAllocation,
  validatePlan,
  type Allocation,
  type PlanCore,
  type PlanPayment,
  type PlanTerms,
} from "../src";

const R = (rupees: number) => Math.round(rupees * 100); // PKR -> paisa

/** The owner's example: PKR 100,000, advance 50,000, 3 × 20 days, Daily Extra 400 after 30 days, fine 1,500. */
function example(over: Partial<PlanTerms> = {}): PlanCore {
  const terms: PlanTerms = {
    original_minor: R(100_000),
    advance_minor: R(50_000),
    start_on: "2026-11-03",
    extra_rate_minor: R(400),
    extra_free_days: 30,
    extra_end: "final_due",
    extra_end_on: null,
    extra_days: null,
    fine_minor: R(1_500),
    fine_mode: "flat",
    fine_grace_days: 0,
    ...over,
  };
  const schedule = autoSchedule({ first_due_on: addDays(terms.start_on, 20), count: 3, interval_days: 20, principal_minor: terms.original_minor - terms.advance_minor });
  return { terms, advance_due_on: terms.start_on, schedule, payments: [], waivers: [], cancelled_on: null };
}

let seq = 0;
function pay(core: PlanCore, paid_on: string, rupees: number, allocations?: Allocation[]): PlanCore {
  const credited = R(rupees);
  const alloc = allocations ?? suggestAllocation(core, paid_on, credited).allocations;
  const p: PlanPayment = { id: `p${++seq}`, paid_on, created_at: `${paid_on}T10:00:${String(seq % 60).padStart(2, "0")}.000Z`, reversed: false, credited_minor: credited, allocations: alloc };
  return { ...core, payments: [...core.payments, p] };
}

describe("calendar arithmetic", () => {
  it("adds real calendar days across months and years", () => {
    expect(autoDueDates("2026-11-23", 3, 20)).toEqual(["2026-11-23", "2026-12-13", "2027-01-02"]);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(isCalendarDate("2026-02-30")).toBe(false);
  });
});

describe("the owner's exact example (computed, not hard-coded)", () => {
  const core = example();
  const s = computePlanState(core, "2026-11-03");

  it("splits the remaining 50,000 into 16,666.67 / 16,666.67 / 16,666.66", () => {
    expect(core.schedule.map((x) => x.principal_minor)).toEqual([1_666_667, 1_666_667, 1_666_666]);
    expect(core.schedule.map((x) => x.due_on)).toEqual(["2026-11-23", "2026-12-13", "2027-01-02"]);
  });

  it("adds Daily Extra to the NEXT installment: 0, 4,000 (days 31–40), 8,000 (days 41–60)", () => {
    const [, i1, i2, i3] = s.entries;
    expect([i1.extra, i2.extra, i3.extra]).toEqual([0, R(4_000), R(8_000)]);
    expect([i1.extra_days, i2.extra_days, i3.extra_days]).toEqual([0, 10, 20]);
    expect([i1.due_total, i2.due_total, i3.due_total]).toEqual([1_666_667, 2_066_667, 2_466_666]);
  });

  it("totals: advance 50,000 + remaining 50,000; Daily Extra 12,000; grand total 112,000 (advance never added twice)", () => {
    expect(s.entries[0].principal).toBe(R(50_000));
    expect(s.totals.principal).toBe(R(100_000));
    expect(s.totals.remaining_principal).toBe(R(100_000));
    expect(s.totals.extra).toBe(R(12_000));
    expect(s.totals.fine).toBe(0);
    expect(s.totals.grand_total).toBe(R(112_000));
  });

  it("a late fine is extra only when an installment is actually late", () => {
    let c = pay(core, "2026-11-03", 50_000); // advance
    c = pay(c, "2026-11-23", 16_666.67);
    c = pay(c, "2026-12-13", 20_666.67);
    c = pay(c, "2027-01-02", 24_666.66);
    const done = computePlanState(c, "2027-02-01");
    expect(done.status).toBe("paid");
    expect(done.totals.fine).toBe(0);
    expect(done.totals.collected).toBe(R(112_000));
    expect(done.totals.credit).toBe(0);
  });
});

describe("schedule generation", () => {
  it("rounds half up and lets the final installment absorb the difference, never negative", () => {
    expect(splitPrincipal(1000, 3)).toEqual([333, 333, 334]);
    expect(splitPrincipal(2, 4)).toEqual([0, 0, 0, 2]);
    expect(splitPrincipal(5_000_000, 3).reduce((a, b) => a + b)).toBe(5_000_000);
    for (const [t, c] of [[1, 2], [7, 4], [99_999, 7], [1, 120]]) {
      const parts = splitPrincipal(t, c);
      expect(parts.reduce((a, b) => a + b)).toBe(t);
      expect(Math.min(...parts)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps duration and count separate: 3 installments at 20 days", () => {
    const sched = autoSchedule({ first_due_on: "2026-11-23", count: 3, interval_days: 20, principal_minor: R(50_000) });
    expect(sched).toHaveLength(3);
    for (const days of [10, 15, 30, 45]) {
      const d = autoDueDates("2026-11-03", 4, days);
      expect(dayNumber(d[3]) - dayNumber(d[0])).toBe(3 * days);
    }
  });

  it("validates manual schedules", () => {
    const c = example();
    expect(() => validatePlan(c.terms, [{ n: 1, due_on: "2026-12-01", principal_minor: R(30_000) }, { n: 2, due_on: "2026-11-30", principal_minor: R(20_000) }])).toThrow(/due after/);
    expect(() => validatePlan(c.terms, [{ n: 1, due_on: "2026-12-01", principal_minor: R(30_000) }])).toThrow(/add up/);
    expect(() => validatePlan(c.terms, [{ n: 1, due_on: "2026-10-01", principal_minor: R(50_000) }])).toThrow(/before the plan start/);
    expect(() => validatePlan({ ...c.terms, advance_minor: R(100_000) }, c.schedule)).toThrow(/advance/);
    validatePlan(c.terms, [{ n: 1, due_on: "2026-12-01", principal_minor: R(30_000) }, { n: 2, due_on: "2027-02-14", principal_minor: R(20_000) }]);
  });
});

describe("Daily Extra", () => {
  it.each([100, 200, 400, 500, 275])("%i per day: rate × chargeable days, nothing in the free period", (rate) => {
    const s = computePlanState(example({ extra_rate_minor: R(rate) }), "2026-11-03");
    expect(s.entries.map((e) => e.extra)).toEqual([0, 0, R(rate) * 10, R(rate) * 20]);
    expect(s.totals.extra).toBe(R(rate) * 30);
  });

  it("no free period: every day from day 1 is charged once", () => {
    const s = computePlanState(example({ extra_free_days: 0 }), "2026-11-03");
    expect(s.entries.slice(1).map((e) => e.extra_days)).toEqual([20, 20, 20]);
  });

  it("ends on a date, after N days, or continues until fully paid", () => {
    const byDate = computePlanState(example({ extra_end: "date", extra_end_on: addDays("2026-11-03", 50) }), "2026-11-03");
    expect(byDate.entries.slice(1).map((e) => e.extra_days)).toEqual([0, 10, 10]);
    const byDays = computePlanState(example({ extra_end: "days", extra_days: 5 }), "2026-11-03");
    expect(byDays.entries.slice(1).map((e) => e.extra_days)).toEqual([0, 5, 0]);
    // Until fully paid: unpaid 10 days after the final due date -> 10 more days on the final installment.
    const untilPaid = computePlanState(example({ extra_end: "paid" }), addDays("2026-11-03", 70));
    expect(untilPaid.entries[3].extra_days).toBe(30);
  });

  it("custom intervals: each period's extra goes to its own upcoming installment, no day counted twice", () => {
    const c = example();
    const manual = { ...c, schedule: [
      { n: 1, due_on: addDays("2026-11-03", 35), principal_minor: R(10_000) },
      { n: 2, due_on: addDays("2026-11-03", 36), principal_minor: R(10_000) },
      { n: 3, due_on: addDays("2026-11-03", 90), principal_minor: R(30_000) },
    ] };
    const s = computePlanState(manual, "2026-11-03");
    expect(s.entries.slice(1).map((e) => e.extra_days)).toEqual([5, 1, 54]);
    expect(s.totals.extra).toBe(R(400) * 60); // days 31..90 exactly once
  });

  it("early payoff stops future accrual and keeps charges already earned", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = pay(c, "2026-11-23", 16_666.67);
    c = pay(c, "2026-12-13", 20_666.67);
    // Day 45: pay everything still owed. Days 41–45 (5 × 400 = 2,000) are earned, days 46–60 are not.
    const quote = settlementQuote(c, addDays("2026-11-03", 45));
    expect(quote).toEqual({ principal: 1_666_666, extra: R(2_000), fine: 0, total: 1_666_666 + R(2_000) });
    const { allocations, settles } = suggestAllocation(c, addDays("2026-11-03", 45), quote.total);
    expect(settles).toBe(true);
    expect(allocations).toEqual([{ n: 3, part: "extra", minor: R(2_000) }, { n: 3, part: "principal", minor: 1_666_666 }]);
    c = pay(c, addDays("2026-11-03", 45), quote.total / 100, allocations);
    const s = computePlanState(c, "2027-03-01");
    expect(s.status).toBe("paid");
    expect(s.settled_on).toBe(addDays("2026-11-03", 45));
    expect(s.entries[3].extra).toBe(R(2_000));
    expect(s.totals.extra).toBe(R(6_000));
    expect(s.totals.credit).toBe(0);
  });

  it("an installment prepaid in full before an early payoff turns unearned Daily Extra into customer credit", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = pay(c, "2026-11-20", 16_666.67);
    c = pay(c, "2026-11-25", 20_666.67);
    c = pay(c, "2026-11-28", 24_666.66); // everything paid on day 25: no day after 25 is charged
    const s = computePlanState(c, "2027-03-01");
    expect(s.settled_on).toBe("2026-11-28");
    expect(s.totals.extra).toBe(0);
    expect(s.totals.credit).toBe(R(12_000));
    expect(s.totals.collected + s.totals.credit).toBe(s.totals.received);
  });
});

describe("late fines", () => {
  const due1 = "2026-11-23";

  it("flat fine once per late installment, after the grace period", () => {
    const c = pay(example({ fine_grace_days: 3 }), "2026-11-03", 50_000);
    expect(computePlanState(c, addDays(due1, 3)).entries[1].fine).toBe(0);
    const late = computePlanState(c, addDays(due1, 4));
    expect(late.entries[1].fine).toBe(R(1_500));
    expect(late.entries[1].status).toBe("overdue");
    expect(computePlanState(c, addDays(due1, 30)).entries[1].fine).toBe(R(1_500)); // still once
  });

  it("per-day fines grow until the installment is paid and then stop", () => {
    let c = pay(example({ fine_mode: "per_day", fine_minor: R(100) }), "2026-11-03", 50_000);
    expect(computePlanState(c, addDays(due1, 5)).entries[1].fine).toBe(R(500));
    c = pay(c, addDays(due1, 5), 16_666.67, [{ n: 1, part: "principal", minor: 1_666_667 }]);
    const s = computePlanState(c, addDays(due1, 40));
    expect(s.entries[1].late_days).toBe(5);
    expect(s.entries[1].fine).toBe(R(500));
    expect(s.entries[1].fine_remaining).toBe(R(500));
  });

  it("paying on time (or within grace) means no fine; payments are allocated qist first, fine last", () => {
    let c = pay(example({ fine_grace_days: 2 }), "2026-11-03", 50_000);
    c = pay(c, addDays(due1, 2), 16_666.67);
    expect(computePlanState(c, "2027-03-01").entries[1].fine).toBe(0);
    let late = pay(example(), "2026-11-03", 50_000);
    late = pay(late, addDays(due1, 3), 18_166.67);
    const s = computePlanState(late, addDays(due1, 3));
    expect(s.entries[1].paid_principal).toBe(1_666_667);
    expect(s.entries[1].paid_fine).toBe(R(1_500));
    expect(s.entries[1].fine_remaining).toBe(0);
  });

  it("partial fine payments, waivers and undoing a waiver", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = pay(c, addDays(due1, 1), 16_666.67 + 500);
    let s = computePlanState(c, addDays(due1, 2));
    expect(s.entries[1].fine_remaining).toBe(R(1_000));
    c = { ...c, waivers: [{ id: "w1", n: 1, minor: R(1_000), undone: false }] };
    s = computePlanState(c, addDays(due1, 2));
    expect(s.entries[1].fine_waived).toBe(R(1_000));
    expect(s.entries[1].fine_remaining).toBe(0);
    expect(s.totals.grand_total).toBe(R(112_000) + R(500));
    c = { ...c, waivers: [{ id: "w1", n: 1, minor: R(1_000), undone: true }] };
    expect(computePlanState(c, addDays(due1, 2)).entries[1].fine_remaining).toBe(R(1_000));
  });

  it("fines are derived, so re-syncing or retrying the same payment can never duplicate them", () => {
    const c = pay(example(), "2026-11-03", 50_000);
    const once = computePlanState(c, addDays(due1, 10));
    const twice = computePlanState({ ...c, waivers: [] }, addDays(due1, 10));
    expect(twice.totals.fine).toBe(once.totals.fine);
    expect(once.totals.fine).toBe(R(1_500));
  });
});

describe("payments", () => {
  it("advance received or pending", () => {
    const pending = computePlanState(example(), "2026-11-03");
    expect(pending.advance_paid).toBe(false);
    expect(pending.next?.n).toBe(0);
    const paid = computePlanState(pay(example(), "2026-11-03", 50_000), "2026-11-03");
    expect(paid.advance_paid).toBe(true);
    expect(paid.next?.n).toBe(1);
  });

  it("multiple partial payments for one installment", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = pay(c, "2026-11-10", 5_000);
    c = pay(c, "2026-11-15", 6_666.67);
    let s = computePlanState(c, "2026-11-20");
    expect(s.entries[1].paid_principal).toBe(R(11_666.67));
    expect(s.entries[1].status).toBe("partial");
    c = pay(c, "2026-11-22", 5_000);
    s = computePlanState(c, "2026-11-22");
    expect(s.entries[1].status).toBe("paid");
    expect(s.entries[1].cleared_on).toBe("2026-11-22");
    expect(s.next?.n).toBe(2);
  });

  it("a payment covering more than one installment flows to the next one; anything beyond the plan is credit", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = pay(c, "2026-11-20", 30_000);
    const s = computePlanState(c, "2026-11-20");
    expect(s.entries[1].remaining).toBe(0);
    expect(s.entries[2].paid_extra).toBe(R(4_000));
    expect(s.entries[2].paid_principal).toBe(R(30_000) - 1_666_667 - R(4_000));
    const all = suggestAllocation(c, "2026-11-21", R(100_000));
    expect(all.settles).toBe(true);
    expect(all.credit).toBeGreaterThan(0);
  });

  it("reversed payments are ignored but kept", () => {
    let c = pay(example(), "2026-11-03", 50_000);
    c = { ...c, payments: c.payments.map((p) => ({ ...p, reversed: true })) };
    const s = computePlanState(c, "2026-11-03");
    expect(s.advance_paid).toBe(false);
    expect(s.totals.received).toBe(0);
  });

  it("manual allocation must add up and never exceed what is owed", () => {
    const c = pay(example(), "2026-11-03", 50_000);
    validateAllocation(c, "2026-11-20", R(10_000), [{ n: 1, part: "principal", minor: R(8_000) }, { n: 0, part: "credit", minor: R(2_000) }]);
    expect(() => validateAllocation(c, "2026-11-20", R(10_000), [{ n: 1, part: "principal", minor: R(9_000) }])).toThrow(/exactly/);
    expect(() => validateAllocation(c, "2026-11-20", R(20_000), [{ n: 1, part: "principal", minor: R(20_000) }])).toThrow(/more qist/);
    expect(() => validateAllocation(c, "2026-11-20", R(100), [{ n: 0, part: "fine", minor: R(100) }])).toThrow(/advance/);
    expect(() => validateAllocation(c, "2026-11-20", R(100), [{ n: 1, part: "principal", minor: R(50) }, { n: 1, part: "principal", minor: R(50) }])).toThrow(/once/);
  });
});

describe("schedule revisions", () => {
  const paidAdvance = () => pay(example(), "2026-11-03", 50_000);

  it("Option A moves only this installment and shows the Daily Extra that moves with it", () => {
    const r = reviseSchedule(paidAdvance(), { kind: "move", n: 2, due_on: "2026-12-18", scope: "one" }, "2026-11-10");
    expect(r.schedule.map((s) => s.due_on)).toEqual(["2026-11-23", "2026-12-18", "2027-01-02"]);
    const row2 = r.diff.find((d) => d.n === 2)!;
    expect(row2.before!.extra).toBe(R(4_000));
    expect(row2.after!.extra).toBe(R(6_000)); // days 31–45
    expect(r.diff.find((d) => d.n === 3)!.after!.extra).toBe(R(6_000)); // days 46–60
    expect(r.extra_after).toBe(r.extra_before); // the same days, only regrouped
  });

  it("Option B moves this and the following installments with the interval", () => {
    const r = reviseSchedule(paidAdvance(), { kind: "move", n: 2, due_on: "2026-12-20", scope: "following", interval_days: 20 }, "2026-11-10");
    expect(r.schedule.map((s) => s.due_on)).toEqual(["2026-11-23", "2026-12-20", "2027-01-09"]);
    expect(r.extra_after).toBe(R(400) * (67 - 30));
  });

  it("paid installments and payment history are never changed", () => {
    let c = paidAdvance();
    c = pay(c, "2026-11-23", 16_666.67);
    expect(() => reviseSchedule(c, { kind: "move", n: 1, due_on: "2026-11-25", scope: "one" }, "2026-11-24")).toThrow(/already paid/);
    expect(() => reviseSchedule(c, { kind: "move", n: 2, due_on: "2026-11-20", scope: "one" }, "2026-11-24")).toThrow();
    const r = reviseSchedule(c, { kind: "regenerate", from_n: 2, count: 4, interval_days: 15, first_due_on: "2026-12-10" }, "2026-11-24");
    expect(r.schedule).toHaveLength(5);
    expect(r.schedule[0]).toEqual(c.schedule[0]);
    expect(r.schedule.slice(1).reduce((a, s) => a + s.principal_minor, 0)).toBe(1_666_667 + 1_666_666);
  });

  it("changing unpaid amounts keeps the total", () => {
    const c = paidAdvance();
    expect(() => reviseSchedule(c, { kind: "amounts", amounts: [{ n: 1, principal_minor: R(10_000) }] }, "2026-11-10")).toThrow(/add up/);
    const r = reviseSchedule(c, { kind: "amounts", amounts: [{ n: 1, principal_minor: R(10_000) }, { n: 3, principal_minor: 1_666_666 + 666_667 }] }, "2026-11-10");
    expect(r.schedule.map((s) => s.principal_minor)).toEqual([R(10_000), 1_666_667, 1_666_666 + 666_667]);
  });
});
