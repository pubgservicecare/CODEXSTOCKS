// UI guards for the final feature set: Mark as Sold form, photo picker validation, owner-only sign-in.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Account } from "@codex/shared";
import { AppCtx } from "../src/components";
import { canMarkSold, expectedProfit, MarkSoldDialog } from "../src/pages/MarkSold";
import { ImagePicker, readPickedImage } from "../src/ImagePicker";
import type { DataService } from "../src/service";

const ROOT = resolve(__dirname, "../../..");

const account = {
  id: "01a18d31-b84b-72e5-ba6b-550db191af85", rev: 1, deleted: false, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
  title: "Conqueror S12 — Glacier M416", status: "available", published: true, purchase_cost_minor: 1_500_000, purchase_currency: "PKR",
  purchased_at: null, purchase_reference: null, list_price_minor: 2_500_000, list_currency: "PKR", description_public: "", youtube_url: null,
  image_url: null, image_file_id: null, old_owner_name: null, old_owner_whatsapp: null, show_old_owner_public: false, internal_notes: "",
  purchase_fx_micro: null, purchase_fx_source: null, purchase_fx_at: null,
} satisfies Account;

const withApp = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <AppCtx.Provider value={{ svc: { kind: "web" } as DataService, toast: () => undefined, requireVault: async () => true, version: 0 }}>{el}</AppCtx.Provider>,
  );

describe("Mark as Sold", () => {
  it("is offered only for accounts that can still be sold", () => {
    expect(canMarkSold({ status: "available", deleted: false })).toBe(true);
    expect(canMarkSold({ status: "reserved", deleted: false })).toBe(true);
    expect(canMarkSold({ status: "sold", deleted: false })).toBe(false);
    expect(canMarkSold({ status: "archived", deleted: false })).toBe(false);
    expect(canMarkSold({ status: "available", deleted: true })).toBe(false);
  });

  it("asks for the actual amount and never pre-fills the listing price", () => {
    const html = withApp(<MarkSoldDialog account={account} onClose={() => undefined} />);
    expect(html).toContain("Actual sold amount");
    expect(html).toMatch(/placeholder="Amount received"[^>]*value=""|value=""[^>]*placeholder="Amount received"/);
    expect(html).not.toContain('value="25000"');
    expect(html).toContain("Rs 25,000.00"); // listing price shown for reference only
    expect(html).toContain("Buyer name");
    expect(html).toContain("Optional");
  });

  it("calculates expected profit or loss only when it can be done honestly", () => {
    expect(expectedProfit(account, 2_200_000, "PKR", null)).toBe(700_000);
    expect(expectedProfit(account, 1_000_000, "PKR", null)).toBe(-500_000);
    expect(expectedProfit(account, 9_000, "USD", null)).toBeNull(); // different currency without a rate
    expect(expectedProfit(account, 9_000, "USD", 3_570)).toBe(9_000 - 5_355); // 1,500,000 paisa × 0.00357
  });
});

describe("photo picker", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it("accepts JPEG/PNG/WebP by content and rejects other or oversize files", async () => {
    await expect(readPickedImage(new File([png], "a.png", { type: "image/png" }))).resolves.toMatchObject({ mime: "image/png", size: 12 });
    await expect(readPickedImage(new File([new TextEncoder().encode("hello")], "fake.png", { type: "image/png" }))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(readPickedImage(new File([], "empty.png"))).rejects.toThrow(/empty/);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(png);
    await expect(readPickedImage(new File([big], "big.png"))).rejects.toThrow(/too large/);
  });
  it("is optional and offers choose / drag-and-drop", () => {
    const html = renderToStaticMarkup(<ImagePicker picked={null} onPick={() => undefined} />);
    expect(html).toContain("Add account photo");
    expect(html).toContain("drag an image here");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("Optional");
  });
});

describe("owner-only entry", () => {
  it("the desktop's fresh-install screen is owner sign-in only: no registration, second owner or local-only setup", async () => {
    const { OwnerSignIn, FIRST_SIGNIN_OFFLINE } = await import("../../../apps/desktop/src/screens");
    const html = renderToStaticMarkup(<OwnerSignIn core={{} as never} defaultApi="https://admin.codexstocks.org" />);
    expect(html).toContain("Owner sign in");
    expect(html).toContain("Owner username");
    expect(html).toContain("Login password");
    expect(html).toContain("Sign In");
    expect(html).toContain("Restore encrypted backup");
    for (const forbidden of ["First PC", "Create my cloud owner", "Another PC", "Local-only", "setup code", "Sign up", "Register", "Create account"])
      expect(html).not.toContain(forbidden);
    expect(FIRST_SIGNIN_OFFLINE).toBe("Connect to the internet to sign in and authorise this PC for the first time.");
    const src = readFileSync(resolve(ROOT, "apps/desktop/src/screens.tsx"), "utf8");
    expect(src).not.toMatch(/setupCloud|setupLocal/);
    expect(readFileSync(resolve(ROOT, "apps/desktop/src/main.tsx"), "utf8")).not.toMatch(/SetupWizard/);
  });

  it("the cloud-connect form in Settings no longer asks for a server setup code", () => {
    const src = readFileSync(resolve(ROOT, "packages/ui/src/pages/Settings.tsx"), "utf8");
    expect(src).not.toMatch(/setupToken|setup code/i);
  });
});

describe("mobile layout rules", () => {
  const admin = readFileSync(resolve(ROOT, "packages/ui/src/styles.css"), "utf8");
  const store = readFileSync(resolve(ROOT, "apps/web/app/(store)/store.css"), "utf8");
  const phone = admin.slice(admin.indexOf("Phones and small tablets"));
  it("admin: drawer, bottom tab bar, bottom-sheet dialogs, table cards, safe areas, no-zoom inputs", () => {
    expect(phone).toMatch(/\.drawer-open \.cx-side \{ transform: none/);
    expect(phone).toMatch(/\.cx-tabbar \{\s*display: grid/);
    expect(phone).toMatch(/\.modal-back \{ place-items: end stretch/);
    expect(phone).toMatch(/td\[data-label\]::before \{ content: attr\(data-label\)/);
    expect(phone).toContain("env(safe-area-inset-bottom)");
    expect(phone).toMatch(/select \{ height: 46px; font-size: 16px; \}/);
    expect(phone).toMatch(/\.btn \{ min-height: 44px; \}/);
  });
  it("storefront: phone menu, sticky WhatsApp bar that never covers the footer, safe areas", () => {
    expect(store).toMatch(/\.mnav \{ display: block; \}/);
    expect(store).toMatch(/body:has\(\.mobile-buy\) \.site-foot/);
    expect(store).toContain("env(safe-area-inset-bottom)");
    expect(store).toMatch(/font-size: 16px; \} \/\* 16px stops iOS zooming/);
  });
});
