// Guards for the visual redesign: exact TXT rendering, honest artwork labelling, local-only assets.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, TxtView } from "../src/components";
import { ART, fallbackArt } from "../src/art";
import { Icon, LogoMark } from "../src/icons";

const ROOT = resolve(__dirname, "../../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("redesign guarantees", () => {
  it("renders TXT descriptions with every space, tab and blank line intact, as text not HTML", () => {
    const txt = "  ★ Conqueror x3   (S10)\n\n\t• X-Suit\n<b>not html</b>\n   trailing   ";
    const html = renderToStaticMarkup(<TxtView text={txt} />);
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("  ★ Conqueror x3   (S10)\n\n\t• X-Suit\n");
    expect(html).toContain("&lt;b&gt;not html&lt;/b&gt;");
    expect(html).toContain("   trailing   ");
  });

  it("marks required fields and optional fields distinctly", () => {
    const req = renderToStaticMarkup(<Field label="Title *"><input /></Field>);
    expect(req).toContain('class="req"');
    expect(req).not.toContain("Title *");
    const opt = renderToStaticMarkup(<Field label="Notes" optional><input /></Field>);
    expect(opt).toContain("Optional");
  });

  it("gives neighbouring items different artwork and a stable scene per id", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const byIndex = ids.map((id, i) => fallbackArt(id, i));
    expect(new Set(byIndex).size).toBe(5);
    expect(fallbackArt("01a18033-b663")).toBe(fallbackArt("01a18033-b663"));
    for (const u of [...byIndex, ...Object.values(ART)]) expect(u).toMatch(/\.webp/);
  });

  it("ships artwork as local optimised WebP files (no huge files, no base64 blobs)", () => {
    const dir = join(ROOT, "packages/ui/assets/art");
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      expect(f).toMatch(/\.webp$/);
      expect(statSync(join(dir, f)).size).toBeLessThan(400 * 1024);
    }
  });

  it("uses no remote image hotlinks or embedded base64 images in UI or storefront sources", () => {
    const sources = [...walk(join(ROOT, "packages/ui/src")), ...walk(join(ROOT, "apps/web/app"))].filter((f) => /\.(tsx?|css)$/.test(f));
    for (const f of sources) {
      const s = readFileSync(f, "utf8");
      // Only the owner's ImageKit photos and YouTube embeds may come from elsewhere.
      const remote = s.match(/(?:src|srcSet|url\()\s*=?\s*["'`(]https?:\/\/[^"'`)]+/g) ?? [];
      for (const r of remote) expect(r, f).toMatch(/imagekit\.io|youtube-nocookie\.com/);
      expect(s, f).not.toMatch(/data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]{200}/);
    }
  });

  it("keeps secrets and private fields out of the storefront code", () => {
    const store = walk(join(ROOT, "apps/web/app/(store)")).filter((f) => /\.tsx?$/.test(f));
    for (const f of store) {
      const s = readFileSync(f, "utf8");
      for (const word of ["purchase_cost", "internal_notes", "old_owner_whatsapp", "backup_code", "credential", "DATABASE_URL", "IMAGEKIT_PRIVATE_KEY"])
        expect(s, `${f} mentions ${word}`).not.toContain(word);
    }
  });

  it("renders icons and the brand mark as decorative inline SVG", () => {
    expect(renderToStaticMarkup(<Icon name="lock" />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<LogoMark />)).toContain("<svg");
  });
});
