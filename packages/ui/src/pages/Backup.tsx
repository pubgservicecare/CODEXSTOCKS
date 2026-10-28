import { useState } from "react";
import { Icon } from "../icons";
import { errMsg, Field, useAction, useApp } from "../components";

export function BackupPage() {
  const { svc, toast } = useApp();
  const { busy, run } = useAction();
  const web = svc.kind === "web";
  const [pw, setPw] = useState({ a: "", b: "", login: "" });
  const [rpw, setRpw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Backup & restore</h1>
          <p>
            {web
              ? "Download an encrypted backup of the cloud inventory. It uses the same format as the desktop app."
              : "Encrypted backup of everything on this PC, including changes not yet synced."}
          </p>
        </div>
      </div>
      {err && <div className="notice bad">{err}</div>}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><span className="icon-tile gold"><Icon name="download" size={16} /></span><h2>Export encrypted backup</h2></div>
          <p className="muted small">
            The file is encrypted with the backup password below (Argon2id + XChaCha20-Poly1305). Stored passwords and backup codes inside
            stay encrypted with your vault key, so restoring them also needs the vault passphrase or recovery key.
            {web ? " Images stay on ImageKit (their links are included)." : " Queued images that have not uploaded yet are not included."}
          </p>
          <Field label="Backup password (12+ characters)"><input type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
          <Field label="Repeat password"><input type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
          {web && (
            <Field label="Sign-in password after restoring" hint="Your login password. It is stored only as an Argon2id verifier so the desktop app can sign you in offline after a restore.">
              <input type="password" value={pw.login} onChange={(e) => setPw({ ...pw, login: e.target.value })} autoComplete="current-password" />
            </Field>
          )}
          <button
            className="btn primary"
            disabled={busy || !pw.a || (web && !pw.login)}
            onClick={() => {
              setErr(null);
              if (pw.a !== pw.b) return setErr("Passwords do not match");
              run(() => svc.exportBackup!(pw.a, { loginPassword: pw.login }), "Backup exported").then((r) => r !== undefined && setPw({ a: "", b: "", login: "" }));
            }}
          >
            {web ? "Download backup" : "Export backup…"}
          </button>
        </div>
        <div className="card">
          <div className="card-head"><span className="icon-tile"><Icon name="upload" size={16} /></span><h2>Restore from backup</h2></div>
          {svc.restoreBackup ? (
            <>
              <div className="notice warn small">
                Restoring REPLACES the inventory on this PC with the backup's contents (all-or-nothing). Export a fresh backup first if unsure.
                You will be signed out and must sign in with the password that was valid when the backup was made.
              </div>
              <Field label="Backup password"><input type="password" value={rpw} onChange={(e) => setRpw(e.target.value)} /></Field>
              <button className="btn danger" disabled={busy || !rpw} onClick={async () => {
                setErr(null);
                try {
                  const r = await svc.restoreBackup!(rpw);
                  if (r) toast(`Restored ${r.accounts} accounts`);
                } catch (e) {
                  setErr(errMsg(e));
                }
              }}>Choose file and restore…</button>
            </>
          ) : (
            <>
              <p className="small">
                Restoring is done in the <b>desktop app</b> (welcome screen → "Restore from an encrypted backup file", or Backup page), so a
                mistake can never overwrite the live cloud inventory from a browser.
              </p>
              <p className="muted small">
                The cloud database also keeps point-in-time history in Neon. See docs/BACKUP_RESTORE.md.
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
