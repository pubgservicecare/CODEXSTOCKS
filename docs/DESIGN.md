# CODE X STOCKS — design system & redesign record

One visual system across the **Windows desktop app**, **admin.codexstocks.org** and **codexstocks.org**.
The desktop app and admin website render the *same* React screens from `packages/ui`; the storefront
(`apps/web/app/(store)`) shares the tokens, font, icons and artwork.

## 1. Visual audit (before, 2026-10-28)

Baseline screenshots: [`docs/screenshots/before/`](screenshots/before/). Why it looked generic:

| Problem | Where |
|---|---|
| No imagery at all: grey "CODE X" placeholder on every card, gradient-only hero | storefront, inventory, account detail |
| Text-only navigation, emoji used as icons (🔒 🔓 🎉) | shell, sync page |
| Everything UPPERCASE with heavy borders: badges, labels, table headers | everywhere |
| Dashboard = two long tables of `$0.00` rows; no hierarchy, no visual summary | dashboard |
| Inventory = plain table, no thumbnails, no grid view, no status counts | accounts |
| Account detail cards misaligned (`.card + .card` margin inside a grid) | account detail |
| Thick red/green left borders to mark public/private sections | detail, form |
| Long single-column form with no grouping or optional/required distinction | add/edit account |
| Raw JSON and full device UUIDs in the audit log | history |
| System font fallback (Inter was named but never shipped) | everywhere |
| Sign-in = a small card on a radial gradient | desktop + web login, setup |

## 2. Redesign checklist (all done)

- [x] Design tokens: surfaces, hairlines, text tiers, one gold accent, status colours with soft fills, radii, shadows, focus ring
- [x] Self-hosted Inter variable font (OFL, 48 KB) — no network font requests; works offline in the desktop app
- [x] Original icon set (≈50 line icons) + original reticle/X brand mark; new app icon
- [x] Original battleground artwork (see §4), clearly labelled wherever it stands in for a missing photo
- [x] App shell: grouped sidebar with icons, active indicator, profile footer; sync + vault status pills
- [x] Dashboard: artwork banner, KPI tiles, inventory mix bar, separate PKR/USD money panels, 6-month chart from real transactions, sync card, recent activity, latest accounts, detailed breakdown (collapsible)
- [x] Inventory: grid ⇄ list (remembered per device), status segmented control with counts, search with icon, thumbnails, labelled artwork fallback, sync state chip
- [x] Account detail: media + summary hero (price, cost, margin, logins/codes), grouped actions, tabs with counts, quiet "Shown on website / Owner only" scope labels
- [x] Forms: sectioned layout (title + explanation + fields), required `*` and "Optional" markers, Write/Preview segmented control for TXT, sticky save bar
- [x] Empty, loading (skeleton) and error states with icons/illustration; icon toasts; blurred modal backdrop with motion
- [x] Sign-in/setup: split layout with artwork; setup choices as option cards
- [x] History: readable action names with icons, key/value details, short device names
- [x] Storefront: cinematic hero (responsive crops), trust strip, refined filters, photo/artwork cards, "How it works", editorial band, detail page with sticky purchase panel and mobile bottom bar
- [x] `prefers-reduced-motion` disables all animation; keyboard focus ring on every control; skip link on the storefront
- [x] One deliberate dark theme (no unfinished theme toggle)

## 3. Tokens (packages/ui/src/styles.css)

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-2` | `#08090c` / `#0d0f13` | page, inputs |
| `--panel` / `-2` / `-3` | `#121419` / `#171a20` / `#1d2128` | cards, raised controls, chips |
| `--line` / `-2` / `-3` | white @ 7% / 12% / 20% | hairlines, control borders, hover |
| `--text` / `--muted` / `--faint` | `#f3f4f6` / `#a3a9b5` / `#6c7381` | three text tiers |
| `--accent` | `#f2b347` (gold) | the only brand accent: primary buttons, active nav, focus |
| `--ok` `--warn` `--bad` `--info` | green / amber / red / blue + `*-soft` fills | status meaning only |
| radii | 18 / 14 / 10 / 7 px | banners · cards · controls · small |
| type | Inter Var; 26 px page titles (−0.025em), 16 px card titles, 14 px body, 12.5 px meta; tabular numbers for money | |

## 4. Artwork

There is **no image-generation tool connected to this environment**, so the artwork was produced as
**original procedural vector illustration**: `scripts/art/generate-art.mjs` draws seeded, layered SVG
landscapes (ridges with atmospheric perspective, fog, sun/moon, aircraft, parachutes, a player silhouette,
supply-drop smoke, a "zone" energy wall) and renders them to WebP with `sharp`. No screenshots, fan art,
stock photos, logos or remote images are used. To regenerate: `node scripts/art/generate-art.mjs`.

| File (`packages/ui/assets/art/`) | Size | Used for |
|---|---|---|
| `hero-dusk-2560.webp`, `hero-dusk-1440.webp`, `hero-dusk-portrait.webp` | 2560×1440, 1440×810, 900×1200 | storefront hero (desktop / laptop / mobile crop), dashboard banner |
| `scene-dawn.webp`, `scene-desert.webp`, `scene-snow.webp`, `scene-storm.webp` | 1600×900 | editorial band, secondary scenes |
| `card-dusk/dawn/desert/snow/storm.webp` | 800×500 | fallback art for accounts without a photo |
| `login-dusk.webp`, `login-snow.webp` | 1400×1600 | desktop sign-in/setup, admin sign-in |

Honesty rules (enforced in code and tested in `packages/ui/test/design.test.tsx`):
- Artwork never stands in silently for an account photo: every fallback shows a chip such as
  "Illustration · no photo yet" / "No account photo · decorative artwork", and has empty `alt`.
- Owner photos (ImageKit) always win over artwork; their `alt` is "Photo of <title>".
- Footer states that artwork is original illustration and not affiliated with PUBG Mobile.

To swap in AI-generated images later, see [IMAGE_GENERATION_PROMPTS.md](IMAGE_GENERATION_PROMPTS.md):
keep the same file names and dimensions and nothing else needs to change.

## 5. Before / after

| Screen | Before | After |
|---|---|---|
| Storefront home | [before](screenshots/before/store-home.png) | [after](screenshots/after/store-home.png) |
| Storefront detail | [before](screenshots/before/store-detail.png) | [after](screenshots/after/store-detail.png) |
| Storefront mobile | [before](screenshots/before/store-home-mobile.png) | [after](screenshots/after/store-home-mobile.png) |
| Admin sign-in | [before](screenshots/before/admin-login.png) | [after](screenshots/after/admin-login.png) |
| Dashboard | [before](screenshots/before/admin-dashboard.png) | [after](screenshots/after/admin-dashboard.png) |
| Inventory | [before](screenshots/before/admin-accounts.png) | [after](screenshots/after/admin-accounts.png) |
| Account detail | [before](screenshots/before/admin-account-detail.png) | [after](screenshots/after/admin-account-detail.png) |
| Logins + vault | [before](screenshots/before/admin-vault-unlock.png) | [after](screenshots/after/admin-vault-unlock.png) |
| New account form | [before](screenshots/before/admin-new-account.png) | [after](screenshots/after/admin-new-account.png) |
| History | [before](screenshots/before/admin-history.png) | [after](screenshots/after/admin-history.png) |
| Sync | [before](screenshots/before/admin-sync.png) | [after](screenshots/after/admin-sync.png) |
| Mobile admin | [before](screenshots/before/admin-dashboard-mobile.png) | [after](screenshots/after/admin-dashboard-mobile.png) |

Desktop (installed Windows app) screenshots: [`docs/screenshots/desktop/`](screenshots/desktop/).
The red "1 Issue" badge in development screenshots is Next.js's dev-only overlay (React's dev build uses
`eval`, which the strict CSP blocks); it does not exist in production builds.
