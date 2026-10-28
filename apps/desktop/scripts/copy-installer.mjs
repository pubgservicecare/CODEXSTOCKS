// Copies the NSIS installer produced by `tauri build` into ../../release:
//   CODE-X-STOCKS-<version>-Setup-x64.exe  (kept per version, never overwritten by another version)
//   CODE-X-STOCKS-Setup-x64.exe            (convenience copy of the latest build)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const dir = resolve("src-tauri/target/release/bundle/nsis");
const exe = readdirSync(dir)
  .filter((f) => f.endsWith(`_${version}_x64-setup.exe`))
  .map((f) => join(dir, f))[0];
if (!exe) throw new Error(`No NSIS installer for version ${version} found in ${dir}`);
const out = resolve("../../release");
mkdirSync(out, { recursive: true });
const versioned = join(out, `CODE-X-STOCKS-${version}-Setup-x64.exe`);
const latest = join(out, "CODE-X-STOCKS-Setup-x64.exe");
copyFileSync(exe, versioned);
copyFileSync(exe, latest);
console.log(`Installer: ${exe}\nCopied to: ${versioned}\n      and: ${latest} (${(statSync(latest).size / 1048576).toFixed(1)} MB)`);
