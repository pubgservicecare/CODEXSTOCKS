import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx", "apps/*/test/**/*.test.ts", "apps/*/test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    // Each file starts its own in-memory Postgres (PGlite); unbounded parallel forks can exhaust memory.
    maxWorkers: 3,
  },
});
