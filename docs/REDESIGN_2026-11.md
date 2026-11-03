# Website redesign (November 2026) — cinematic storefront + admin website

Scope: **codexstocks.org** (public storefront) and **admin.codexstocks.org** (admin website) were redesigned from
scratch. The **Windows desktop app is visually unchanged**. Backend, database schema, API, encryption, sync and
accounting are untouched. Nothing was committed, pushed or deployed.

Screenshots: [`docs/screenshots/redesign/`](screenshots/redesign/) — `before/`, `cycle1/` (first review cycle, with
the first generated artwork that was later replaced), `after/` (final, production build, demo data), `compare/`
(labelled before/after pairs).

## 1. Brand

| | |
|---|---|
| Logo | The owner's `brand-reference/codex-stocks-logo.jpeg`. The red brush **X** and the **CODE X** wordmark are cut out of the black background (alpha from the red channel) by `scripts/art/prepare-website-art.mjs` → `apps/web/assets/brand/codex-x.webp`, `codex-wordmark.webp`, `codex-logo.webp`, `icon-256.png` (+ `apps/web/app/favicon.ico`). The PUBG and Tencent Games marks printed under the original logo are **not** used, so the site does not suggest affiliation. |
| Colour | Logo red (`#e3120b`, hot `#ff3b22`) on a black stage (`#050506`). |
| Type | **Anton** (headlines, prices), **Chakra Petch** (HUD labels, tickers, navigation), Inter (text). Anton and Chakra Petch are SIL OFL 1.1, self-hosted in `apps/web/app/fonts/` with their licences (no external font requests; CSP unchanged). |
| Shapes | Sharp HUD corner cuts, angled panels, crosshair brackets, thin rules. |

## 2. Imagery — the owner's PUBG pictures

At the owner's request (2026-11-03) the website uses the owner's chosen pictures from
`brand-reference/pubg-visual-references/` (PUBG Mobile X-Suit artwork collected from Pinterest). An earlier set of
generated illustrations was removed. `scripts/art/prepare-website-art.mjs` crops, rotates (the lineup picture was
stored sideways), resizes (never enlarges) and saves them as WebP in `apps/web/assets/pubg/` (23–258 KB each). The raw
originals stay git-ignored; only the web copies are shipped.

| Where | Picture |
|---|---|
| Hero, phones | Crimson suit under a red moon (full screen) |
| Hero, tablets/desktop | Three angled "character select" panels: blue & silver suit, crimson suit (centre), white & red suit |
| Scroll story | Red & black suit on a gothic street (fiery frame trimmed), ice suit in a frozen storm, player on a throne in blue smoke |
| "Iconic looks" gallery | Eight suits (red, blue, blue & gold over the sea, mummy on a throne, white & red, ice, crimson, throne) |
| Inventory header | The five-suit lineup (rotated upright) |
| WhatsApp band | Gold & blue suit in motion blur |
| Accounts without a photo | 4:3 crops of five suits, labelled "Artwork · no account photo yet" |
| Admin sign-in / dashboard | Ice suit / five-suit lineup |

Not used: the white "Battlegrounds" helmet poster (white background clashes with the dark design).

Rights: these are third-party PUBG Mobile (Krafton/Tencent) images; commercial-use rights were not established. The
owner chose to use them. The site labels them as illustrative artwork, never presents them as an account for sale,
and keeps the "not affiliated with or endorsed by" notice in the footer.

## 3. Pinterest media (`https://pin.it/5aVW12Zb4`)

| | |
|---|---|
| Resolves to | pin `1066579124270904389` (same id as the gold motion-blur reference picture) |
| Format | MP4 (H.264 video + AAC audio; HLS also offered), **720×1280** (9:16), **14.9 s**, **30 fps** (446 frames), 5.8 MB |
| Content | A fan edit of PUBG Mobile in-game footage (suit lineup in gold/blue fire, desert, crimson suit with lightning, glacier suit); the editor's **watermark** is burned in. Uploaded by a Pinterest user with no source or attribution. |
| Outcome | **Not added to the project** (inspected from a temporary copy only). `Hero.tsx` has a ready, switched-off `HERO_VIDEO` slot for a video the owner has rights to (muted, looped, inline, poster, skipped for reduced motion). |

## 4. Storefront (`apps/web/app/(store)/`)

| Page / element | What it is |
|---|---|
| Brand opening (`Intro.tsx`) | First visit in a tab: the two X strokes are drawn, a crosshair locks on, the wordmark rises, then the screen splits along the X. Server-rendered (never a blank screen); leaves when fonts + the hero picture are ready (≈1.15 s after first paint at the earliest, capped at 2.3 s; an inline fallback ends it at 2.6 s even without the page's JavaScript); skipped on repeat visits and for reduced motion. |
| Two tickers (`Ticker.tsx`) | Right-to-left, seamless (two identical groups, transform only), pause on hover: a red HUD strip under the header and a large outlined/filled strip after the hero. Honest copy only. |
| Hero (`Hero.tsx`) | Phones: one full-screen picture. Wider screens: three angled panels that rise in after the opening, drift apart on scroll, follow the pointer, and widen on hover; blurred ambient glow, the CODE X sigil, embers, HUD frame; headline revealed line by line; live stock count; actions + search. Side panels are not downloaded on phones. |
| Home | Hero → ticker → "In stock now" (phone: snap rail; desktop: newest 6) → pinned scroll story (three pictures wipe in as you scroll) → "Iconic looks" gallery (drifts sideways with the scroll on desktop, swipe rail on phones) → how it works → WhatsApp band → footer. Old `/?q=` links redirect to `/accounts`. |
| Inventory `/accounts` | Lineup backdrop; search field with its button attached; listing-currency and sort chips inline on desktop, bottom sheet on phones (same form fields); tilt cards with scanline sweep and staggered reveal; compact empty state. |
| Account page | Photo shown whole in a framed panel over a blurred backdrop, optional YouTube video, price panel: **main price, other currency on a small line underneath** (`PKR 100,000` / `≈ USD 357.14`), rate note, WhatsApp enquiry, exact TXT dossier, more accounts, sticky buy bar on phones. |
| Currency | PKR for Pakistan, USD elsewhere, small PKR/USD switch (cookie), "≈" on conversions, stale rates flagged, provider credited. Existing daily-rate API; no accounting change. |
| Transitions | Client-side navigations wipe in with a curtain (`PageTransition.tsx`); page content is never transformed, so fixed elements stay attached to the screen. |
| Motion (`Motion.tsx`) | IntersectionObserver reveals, one passive rAF-throttled scroll listener writing CSS variables only, pointer tilt for mouse/pen only. |

## 5. Admin website (`apps/web/app/admin/`)

| | |
|---|---|
| Shell (`WebShell.tsx`) | Sidebar with the real logo, HUD navigation, live USD/PKR reference chip, owner card; command bar (section + title, sync, vault lock, New account). Phones: compact bar, drawer, bottom tab bar with a raised red "New". |
| Dashboard (`WebDashboard.tsx`) | Command header over the lineup picture with a live **Combined net profit** panel, four stock tiles, the shared **PKR/USD charts** (same `consolidatedMonthlyFlow` series → identical rise and fall) next to the native PKR and USD books, combined books, inventory mix, sync, latest accounts, activity, breakdown. All figures from `useDashboardData()`. |
| Sign-in | Ice-suit picture with "Command your stock." and a glass panel with the logo; same sign-in call as before. |
| Every other page | Restyled by the website-only theme `admin-web.css` (scoped to `html.cxw`): HUD type, corner-cut cards and buttons, red focus states, chart bars that grow in, the PUBG card artwork for accounts without a photo. |

### Desktop app kept as it was

Shared code changed only additively: `AdminApp` accepts an optional `presentation` (shell + dashboard) and exports
`NAV`, `TABS`, `SyncBadge`, `useTableLabels`; the dashboard exports its pieces and loads data through
`useDashboardData()` (same calls); `art.ts` gains `setCardArt()` (called by the website only). `packages/ui/src/styles.css`,
`fonts.css` and `apps/desktop` are unchanged; the desktop production build produces the **same CSS file
(`index-Dxo6UOWQ.css`, content-hashed) as the 1.0.4 release build**.

## 6. Verification (2026-11-03, local demo data only)

| Check | Result |
|---|---|
| Automated tests | 16 files, **158 passed** (price tests updated to the requested display; +1 test for uncluttered card prices) |
| Type check (all workspaces) | exit 0 |
| Web production build | OK (`/`, `/accounts`, `/accounts/[id]`, `/admin`, `/api/v1`) |
| Desktop frontend build | OK, CSS identical to 1.0.4 |
| Overflow audit, storefront | home (incl. gallery and WhatsApp band), inventory, account page at 320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440: no horizontal overflow, nothing off-screen |
| Overflow audit, admin | 10 pages × the same 10 widths: clean |
| Phone first screen | 320–430 px: header, ticker, hero picture, headline, actions on one row, and the next band inside the first screen |
| Reduced motion | no opening, tickers static, no parallax/embers, story unpinned, gallery scrollable, all content visible |
| Performance (phone, CPU ×4 slower) | scrolling the whole home page: 408 frames, avg 17.7 ms, p95 33.2 ms, 1 frame > 50 ms, 1 long task; cumulative layout shift 0.0002 |
| Console / page errors | none (production build) |
| Secrets in bundles | `apps/web/.next/static` + `apps/desktop/dist`: no database password/host, no demo password, no secret names |
| Data safety | Previews ran with `DATABASE_URL` blanked and `DEMO_MODE=1` (in-memory demo database, verified by its "DEMO ·" listings before any admin action). No production data, schema, environment or deployment was touched. |

Repeat the checks with `scripts/qa/redesign-*.mjs` (Playwright scripts; `QA_BASE`, `QA_OUT` environment variables).

## 7. Known limitations

- The PUBG pictures are third-party artwork without established commercial rights (owner's decision, see §2).
- The source pictures are small (474–1147 px wide); on large desktop screens the story pictures are shown slightly enlarged.
- Phone checks used Chromium device emulation; no physical phone was used.
- Each account has one photo (+ optional video) in the data model, so the "gallery" on the account page shows exactly those.
- Admin pages other than shell, dashboard and sign-in keep their shared layouts (with the new web theme), because they are the same screens as the desktop app.
- Next.js development mode shows "eval() is not supported" issues because of the existing Content-Security-Policy; production is unaffected.
