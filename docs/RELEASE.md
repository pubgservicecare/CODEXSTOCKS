# Desktop release

## Build

```powershell
npm install
npm test
npm run desktop:build
```

Outputs (version from `src-tauri/tauri.conf.json`):
- `apps\desktop\src-tauri\target\release\bundle\nsis\CODE X STOCKS_<version>_x64-setup.exe` (toolchain output)
- `release\CODE-X-STOCKS-<version>-Setup-x64.exe` (kept per version)
- `release\CODE-X-STOCKS-Setup-x64.exe` (copy of the latest build)

Bump the version in `tauri.conf.json`, `apps/desktop/package.json` and `src-tauri/Cargo.toml` for every release.

## Versions

| Version | SHA-256 | Notes |
|---|---|---|
| 1.0.3 | `577B0E678B2D766FA53C4B1309C3860AD8CBA8ADF78BC181BD579EFF71D5360E` | Owner-only sign-in, photo in Add Account, Mark as Sold, phone layouts. No data or schema changes. See RELEASE_1.0.3.md. Upgrade on a real install not yet verified. |
| 1.0.2 | `8D94C09546C9C3E3AFD490F6B4F6AB47F88F321F29BF8866D804F0DA5EF0735A` | Visual redesign (shared UI, artwork, new app icon). No data or schema changes. |
| 1.0.1 | `A64C3E78A30D98439D78B575FB0EA41A9874914FEA2074FE27A82A61A23FE05A` | Parity release: History page, complete account history, conflict-snapshot fix |
| 1.0.0 | `24C54FDB66917CBC70D38227474B0DCD0B2BC2D393DEA284FCB8C5C297CF8372` | First build. File no longer kept (overwritten during the 1.0.1 work); rebuildable from source. |

Size: **≈ 209 MB**, because the installer embeds the **offline WebView2 runtime installer**
(`webviewInstallMode: offlineInstaller`), so it installs on a PC without internet even if WebView2 is missing.
Alternative: `embedBootstrapper` (~5 MB installer, needs internet only if WebView2 is absent; Windows 11 and
updated Windows 10 already include WebView2).

Requirements to build: Node 22.13+, Rust stable (MSVC), VS 2022 Build Tools "Desktop development with C++",
internet on first build (crates, NSIS, WebView2 installer).

## Installer behaviour

- Per-user install (no admin prompt) to `%LOCALAPPDATA%\CODE X STOCKS`; Start-menu + desktop shortcuts;
  uninstaller registered under "Apps & features".
- Data lives in `%APPDATA%\org.codexstocks.desktop` — kept on upgrade and uninstall (NSIS offers an
  unchecked "delete app data" option on uninstall).

## Verification record (2026-10-28, this dev PC)

| Check | Result |
|---|---|
| Automated tests | 82 passed (`npm test`, incl. 8 desktop⇄web parity tests and 7 redesign guards) |
| Silent install `/S` | exit 0; exe, uninstaller, Start-menu and desktop shortcuts, uninstall registry entry present |
| App launch | window "CODE X STOCKS" opened; setup wizard rendered; SQLite created + migrated in app-data |
| Reinstall/upgrade over existing install | exit 0; local DB marker row preserved |
| Uninstall `/S` then reinstall | app removed; local DB preserved; reinstall OK |
| 1.0.0 → 1.0.1 upgrade `/S` | exit 0; registered version 1.0.1; local DB unchanged; app launches |
| 1.0.1 → 1.0.2 upgrade `/S` | exit 0; registered version 1.0.2; local DB files byte-identical (SHA-256) before/after; app launches with the redesigned UI (screenshots in docs/screenshots/desktop/) |
| Windows 10 Pro 22H2 (19045) | ✅ real machine (above) |
| Windows 11 | ❌ **not tested** — no Windows 11 machine available |
| Clean PC without WebView2 / offline install | ❌ not tested on a real clean machine (offline WebView2 installer is embedded) |

## Upgrade

Install the newer installer over the old one. Data is kept. Make an encrypted backup first (Backup page).

## Code signing

The installer is **not code-signed**; Windows SmartScreen will warn ("More info → Run anyway"). To sign,
obtain a code-signing certificate and set `bundle.windows.certificateThumbprint` in `tauri.conf.json`.
