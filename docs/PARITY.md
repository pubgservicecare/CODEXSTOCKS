# Desktop ⇄ admin website feature parity

Both admin interfaces render the **same React screens** (`packages/ui`) through one `DataService` contract,
run the **same business commands and invariants** (`packages/shared/src/commands.ts`, `rules.ts`) and use
the **same authenticated API and cloud inventory** (`packages/server`). Desktop: offline-first (local SQLite +
outbox). Website: online, writes go straight to the API (no browser-offline mode).

Parity is enforced by `apps/web/test/parity.test.ts` (real desktop engine + real web service against the
same server) — including a check that the web service implements every desktop capability except the
documented desktop-only ones.

Legend: ✅ verified by automated test · 👁 verified in a browser (website) · 🟡 implemented, not verified

| # | Feature | Desktop | Web admin | Tested | Differences (by design) |
|---|---|---|---|---|---|
| 1 | Login, logout, vault lock | Offline+online login, idle lock (configurable), manual vault lock | Cookie login (server-checked), logout, vault lock, **idle lock (added)**, vault auto-lock when tab hidden | ✅ desktop login/lock; ✅ web vault unlock/lock in parity tests; 👁 web login | Web needs internet. Desktop also resets login with recovery key. |
| 2 | Accounts: create/edit/search/filter/archive/publish | Shared UI + commands | Same | ✅ both (parity: web create/edit/archive/publish → desktop) | Web sends `expected_rev` (stale edits rejected with 409). |
| 3 | Images, YouTube, exact TXT | Offline image queue; TXT pre-wrap | Direct signed upload to ImageKit; same TXT | ✅ both (TXT identical across web→desktop→public; image URL synced) | Web uploads immediately (no queue needed online). |
| 4 | Social/phone/email links, limits | Same UI/rules | Same | ✅ both (Google, Game Center, phone, email; 3rd social rejected on web) | — |
| 5 | Per-link owner details; shared phone/email password | Same | Same | ✅ both (link rows identical; phone+email point to one credential) | — |
| 6 | Encrypted credentials, vault, backup codes | Vault in app memory | Vault unlocked in the browser tab only | ✅ both (web-recorded password/codes revealed on desktop; web passphrase change works on desktop) | — |
| 7 | Statuses & inventory | Same | Same | ✅ both (reserved/archived from web reach desktop) | — |
| 8 | Purchases, sales, expenses, refunds, history | Same commands; purchase = account cost fields | Same | ✅ both (offline desktop sale + expenses → web; web refund → desktop) | — |
| 9 | PKR/USD reports, in/out, net profit | Computed locally | Computed by server (same function) | ✅ reports deep-equal on both | — |
| 10 | ImageKit uploads & queue status | Queue: queued/failed/uploaded per image, retries | Upload result shown immediately; cloud view says queues live on each PC | ✅ both | Upload *queue* exists only on desktop (offline need). |
| 11 | Public listing controls | Publish toggle, price, "show previous owner name" | Same | ✅ both + public endpoint leak checks after web edits | Public fields are fixed by the allowlist DTO; only the previous-owner name is optional. |
| 12 | Sync status, errors, conflicts | Local queue status, retry/discard rejected items, conflict compare & choose | **Cloud status (added)**: open conflicts, devices and their last sync; conflict compare & choose | ✅ conflicts visible on web, auto-closed when desktop resolves (**fixed**); web-settled conflict never leaves desktop stale (**fixed**) | Pending/failed queues are per PC. |
| 13 | Devices, settings, audit history, backup/restore | Devices, store settings, idle lock + server URL, **History page (added)**, export/restore | Devices, store settings, idle lock (**added**), **History page (added)**, **encrypted backup download (added)** restorable in desktop | ✅ devices/revoke, settings both ways, history identical both sides, web backup → desktop restore | Restore is desktop-only so a browser can never overwrite the live cloud inventory. Pairing/server URL are desktop concepts. |

## Desktop-only capabilities (intentional)

`localImage`, `syncNow`, `outboxIssues`, `retryOutbox`, `discardOutbox`, `restoreBackup`, `cloudInfo`,
`pairWithCloud` — all concern the PC's own offline database/queue or pairing.

## Visual redesign (1.0.2) — parity impact

The redesign changed **only shared presentation code** (`packages/ui`: styles, icons, artwork, shell,
dashboard, accounts, account detail, form, history, sync, settings, backup, sign-in layout `AuthShell`).
Both the desktop app and admin.codexstocks.org render these same components, so they stay visually
identical. No `DataService` method, command, business rule or API changed; the parity suite above still
passes unchanged. Additions that apply to both: grid/list inventory view (remembered per device), the
6-month PKR/USD chart (computed from the same recorded sales, refunds, expenses and purchase costs on both),
recent-activity feed, readable History details. See [DESIGN.md](DESIGN.md).
