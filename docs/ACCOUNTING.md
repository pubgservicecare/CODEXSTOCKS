# Accounting

- Money is stored as **integer minor units** (cents / paisa) with its currency. USD and PKR both use 2 decimals.
- USD and PKR are **always reported separately**. Nothing adds them together.
- Every account has a required purchase cost (0 allowed for a genuinely free account) and purchase currency.
- A sale in a different currency than the purchase **requires** an exchange rate, stored on the sale as
  `exchange_rate_micro` = (units of sale currency per 1 unit of purchase currency) × 1,000,000.
  Conversion: `round_half_away_from_zero(cost_minor × rate_micro / 1e6)`.
- Refunds are always in the sale's currency and cannot exceed the sale amount.
- Expenses carry date, amount, currency, category and optional account/sale reference.
- Every financial change writes an append-only audit event (synced, cannot be edited).

## Formula (per currency C) — implemented in `packages/shared/src/accounting.ts`

```
Gross sales      = Σ sale amounts in C, status completed or refunded   (voided sales ignored)
Refunds          = Σ refunds in C
Net sales        = Gross sales − Refunds
Cost of sold     = Σ purchase cost of accounts whose sale in C is still "completed",
                   converted into C with that sale's recorded rate when currencies differ
Gross profit     = Net sales − Cost of sold
Net profit       = Gross profit − Expenses(C)

Cash view:
Incoming         = Gross sales
Outgoing         = Σ purchase cost of all accounts bought in C + Expenses(C) + Refunds(C)
Net cash         = Incoming − Outgoing
Inventory value  = Σ purchase cost of available + reserved accounts bought in C
```

Why no double counting: the **profit view** counts a purchase only when its account is sold (cost of sold);
the **cash view** counts it once, when bought. A **restocking refund** (account returned, full refund) marks
the sale `refunded`: its revenue is cancelled by the refund and its cost is not counted, because the account is
back in inventory. A partial refund keeps the sale `completed` (cost still counted). Voiding a sale (recorded
by mistake) removes it entirely and makes the account available again.

Sales with a different currency and no rate are listed as "missing rate" on the dashboard and excluded from
cost of sold (the server and desktop refuse to create such sales; this only guards imported data).

Tested cases (`packages/shared/test/shared.test.ts`): profitable sale, loss-making sale, zero-cost account,
expenses, refunds, restocking refund, voided sale, separate USD/PKR, cross-currency with rate, rounding,
unsold inventory.
