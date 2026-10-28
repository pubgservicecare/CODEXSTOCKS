import type { NextConfig } from "next";
import { resolve } from "node:path";

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  transpilePackages: ["@codex/shared", "@codex/crypto", "@codex/ui", "@codex/api-client", "@codex/local-core", "@codex/server"],
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  async headers() {
    // Per-site Content-Security-Policy is set in proxy.ts (it depends on the host).
    return [{ source: "/:path*", headers: [...common, { key: "X-Frame-Options", value: "DENY" }] }];
  },
};

export default config;
