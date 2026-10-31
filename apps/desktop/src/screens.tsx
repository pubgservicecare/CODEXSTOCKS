import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AppCore } from "@codex/local-core";
import { AuthShell, Field, Icon, Notice } from "@codex/ui";
import { openBackupFile } from "./platform";

function msg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function AuthCard({ children, steps, step }: { children: ReactNode; steps?: number; step?: number }) {
  return (
    <AuthShell steps={steps} step={step} sub="Windows desktop">
      {children}
    </AuthShell>
  );
}

/** Shown when a never-enrolled PC cannot reach the server. Honest: there is no offline first sign-in. */
export const FIRST_SIGNIN_OFFLINE = "Connect to the internet to sign in and authorise this PC for the first time.";

function signInError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 0) return FIRST_SIGNIN_OFFLINE;
  return msg(e);
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Fresh installation: the single owner signs in with their existing cloud username and password.
 * Signing in authorises (enrols) this PC as a device and downloads the inventory. There is no
 * registration, no second-owner creation and no offline bypass; restoring an encrypted backup is
 * the only secondary path and it never creates a cloud owner.
 */
export function OwnerSignIn({ core, defaultApi }: { core: AppCore; defaultApi: string }) {
  const [mode, setMode] = useState<"login" | "restore">("login");
  const [f, setF] = useState({ apiBase: defaultApi, username: "", password: "", backupPassword: "" });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await core.connectExisting({ apiBase: f.apiBase.trim(), username: f.username.trim(), password: f.password });
    } catch (err) {
      setError(signInError(err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "restore")
    return (
      <AuthCard>
        <h1>Restore encrypted backup</h1>
        <p className="lede">Recovery only. Restores a .cxbackup file onto this PC. Afterwards, sign in with the login password that was valid when the backup was made.</p>
        <Field label="Backup password"><input type="password" value={f.backupPassword} onChange={(e) => up({ backupPassword: e.target.value })} autoFocus autoComplete="off" /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="auth-actions">
          <button type="button" className="btn ghost" onClick={() => (setMode("login"), setError(null))}><Icon name="chevronLeft" size={14} /> Back to sign in</button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !f.backupPassword}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                const text = await openBackupFile();
                if (text) await core.restoreBackup(text, f.backupPassword);
              } catch (err) {
                setError(msg(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Choose file and restore…
          </button>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard>
      <div className="auth-eyebrow"><Icon name="lock" size={13} /> Private · owner only</div>
      <h1>Owner sign in</h1>
      <p className="lede">Sign in with your CODE X STOCKS owner account to authorise this PC and download your inventory.</p>
      {!online && <Notice kind="warn">{FIRST_SIGNIN_OFFLINE}</Notice>}
      <form onSubmit={submit}>
        <Field label="Owner username"><input value={f.username} onChange={(e) => up({ username: e.target.value })} required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} /></Field>
        <Field label="Login password"><input type="password" value={f.password} onChange={(e) => up({ password: e.target.value })} required autoComplete="current-password" /></Field>
        {advanced ? (
          <Field label="Server address" hint="Only change this if you run your own server.">
            <input value={f.apiBase} onChange={(e) => up({ apiBase: e.target.value })} required spellCheck={false} />
          </Field>
        ) : null}
        {error && <Notice kind="bad">{error}</Notice>}
        <button className="btn primary lg auth-submit" disabled={busy}>
          <Icon name="lock" size={16} /> {busy ? "Signing in and authorising this PC…" : "Sign In"}
        </button>
      </form>
      <p className="small muted" style={{ marginTop: 14 }}>
        Stored game passwords and backup codes stay encrypted until you unlock the vault with your vault passphrase.
      </p>
      <div className="auth-links">
        <button type="button" className="btn ghost sm" onClick={() => (setMode("restore"), setError(null))}><Icon name="backup" size={14} /> Restore encrypted backup</button>
        <button type="button" className="btn ghost sm" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>{advanced ? "Hide server address" : "Server address"}</button>
      </div>
    </AuthCard>
  );
}

export function RecoveryKeyScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <AuthCard>
      <h1>Your recovery key</h1>
      <p>
        Write this key down or print it, and store it offline (not on this PC). It is shown <b>only once</b>.
      </p>
      <div className="recovery">{recoveryKey}</div>
      <ul className="small muted">
        <li>It unlocks your credential vault if you forget the vault passphrase.</li>
        <li>It can reset a forgotten login password on this PC.</li>
        <li>If you lose BOTH the vault passphrase and this key, stored passwords and backup codes cannot be recovered by anyone.</li>
      </ul>
      <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I have stored the recovery key safely</label>
      <button className="btn primary" disabled={!ok} onClick={onDone}>Continue</button>
    </AuthCard>
  );
}

export function LoginScreen({ core, username, onLoggedIn }: { core: AppCore; username: string | null; onLoggedIn: (password: string) => void }) {
  const [u, setU] = useState(username ?? "");
  const [p, setP] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [rk, setRk] = useState({ key: "", pw: "", pw2: "" });

  if (reset)
    return (
      <AuthCard>
        <h1>Reset login password</h1>
        <p className="muted small">Prove you are the owner with your vault recovery key. This changes the password on this PC only.</p>
        <Field label="Recovery key"><input className="mono" value={rk.key} onChange={(e) => setRk({ ...rk, key: e.target.value })} /></Field>
        <Field label="New login password"><input type="password" value={rk.pw} onChange={(e) => setRk({ ...rk, pw: e.target.value })} /></Field>
        <Field label="Repeat"><input type="password" value={rk.pw2} onChange={(e) => setRk({ ...rk, pw2: e.target.value })} /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="row">
          <button className="btn ghost" onClick={() => setReset(false)}>Back</button>
          <span className="grow" />
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setError(null);
              if (rk.pw !== rk.pw2) return setError("Passwords do not match");
              setBusy(true);
              try {
                await core.resetLoginWithRecoveryKey(rk.key, rk.pw);
                setReset(false);
                setError(null);
              } catch (e) {
                setError(msg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset password
          </button>
        </div>
      </AuthCard>
    );

  return (
    <AuthCard>
      <div className="auth-eyebrow"><Icon name="lock" size={13} /> Private · owner only</div>
      <h1>Owner sign in</h1>
      <p className="lede">This PC is already authorised, so sign-in works offline. When online, your cloud session is refreshed automatically.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await core.login(u, p);
            onLoggedIn(p);
            setP("");
          } catch (err) {
            setError(msg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Owner username"><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required /></Field>
        <Field label="Login password"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoFocus autoComplete="current-password" required /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setReset(true)}>Forgot password?</button>
          <span className="grow" />
          <button className="btn primary" disabled={busy}><Icon name="lock" size={15} /> {busy ? "Checking…" : "Sign In"}</button>
        </div>
      </form>
    </AuthCard>
  );
}

export function CreateVaultScreen({ core, onRecoveryKey }: { core: AppCore; onRecoveryKey: (k: string) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard>
      <h1>Create your credential vault</h1>
      <p className="muted small">Your cloud account has no vault yet. Choose a vault passphrase (different from your login password).</p>
      <Field label="Vault passphrase"><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
      <Field label="Repeat"><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      {error && <Notice kind="bad">{error}</Notice>}
      <button
        className="btn primary"
        onClick={async () => {
          if (a !== b) return setError("Passphrases do not match");
          try {
            onRecoveryKey((await core.createVaultIfMissing(a)).recoveryKey);
          } catch (e) {
            setError(msg(e));
          }
        }}
      >
        Create vault
      </button>
    </AuthCard>
  );
}
