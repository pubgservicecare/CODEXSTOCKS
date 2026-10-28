import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { decideRoute, DEFAULT_ADMIN_HOSTS } from "../lib/hosts";
import { TxtView } from "../../../packages/ui/src/components";
import { Description } from "../app/(store)/ui";

describe("domain routing", () => {
  const A = DEFAULT_ADMIN_HOSTS;
  it("serves the admin app on admin.codexstocks.org", () => {
    expect(decideRoute("admin.codexstocks.org", "/", A)).toEqual({ action: "rewrite", path: "/admin" });
    expect(decideRoute("admin.codexstocks.org", "/accounts/x", A)).toEqual({ action: "rewrite", path: "/admin/accounts/x" });
    expect(decideRoute("admin.codexstocks.org", "/api/v1/auth/me", A)).toEqual({ action: "next" });
  });
  it("never exposes /admin on the public domain", () => {
    expect(decideRoute("codexstocks.org", "/admin", A)).toEqual({ action: "notfound" });
    expect(decideRoute("codexstocks.org", "/admin/accounts", A)).toEqual({ action: "notfound" });
    expect(decideRoute("www.codexstocks.org", "/admin/x", A)).toEqual({ action: "notfound" });
    expect(decideRoute("codexstocks.org", "/accounts/123", A)).toEqual({ action: "next" });
    expect(decideRoute("codexstocks.org", "/", A)).toEqual({ action: "next" });
  });
  it("allows /admin on localhost for development only", () => {
    expect(decideRoute("localhost:3000", "/admin", A)).toEqual({ action: "next" });
  });
});

describe("TXT rendering", () => {
  const txt = "  Conqueror   S12\n\n\n\t- M416  <b>Glacier</b>\n   ";
  for (const [name, el] of [
    ["storefront", createElement(Description, { text: txt })],
    ["admin", createElement(TxtView, { text: txt })],
  ] as const) {
    it(`${name}: keeps every space/newline and escapes HTML`, () => {
      const html = renderToStaticMarkup(el);
      expect(html).toMatch(/white-space:pre-wrap/);
      expect(html).toContain("  Conqueror   S12\n\n\n\t- M416  &lt;b&gt;Glacier&lt;/b&gt;\n   ");
      expect(html).not.toContain("<b>Glacier</b>");
    });
  }
});
