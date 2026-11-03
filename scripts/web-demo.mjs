// Runs the website on localhost with the in-memory DEMO database (sample data that disappears when you stop it).
//
//   npm run web:demo            -> http://localhost:3000 (store) and http://localhost:3000/admin (demo / Demo-Owner-Pass1!)
//   PORT=3001 npm run web:demo  -> another port
//
// apps/web/.env.local holds the PRODUCTION database address. Next.js would load it, but only for variables that are
// not already set — so DATABASE_URL is passed in deliberately empty here (PowerShell cannot set an empty variable
// itself). This way a local preview can never read or change live data.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = resolve(ROOT, "apps/web");
const port = process.env.PORT || "3000";
const nextBin = createRequire(resolve(WEB, "package.json")).resolve("next/dist/bin/next");

const env = {
  ...process.env,
  DATABASE_URL: "", // empty on purpose: keeps the production address in .env.local from being loaded
  DEMO_MODE: "1",
  COOKIE_SECURE: "false",
  ADMIN_ORIGINS: `http://localhost:${port}`,
  IMAGEKIT_PRIVATE_KEY: "",
  SETUP_TOKEN: "",
};

console.log(`\n  CODE X STOCKS — local DEMO (sample data, never the live database)`);
console.log(`  Store: http://localhost:${port}    Admin: http://localhost:${port}/admin  (demo / Demo-Owner-Pass1!)`);
console.log(`  Stop with Ctrl+C\n`);

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], { cwd: WEB, env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
