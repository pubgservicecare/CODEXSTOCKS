import { useState, type FormEvent, type ReactNode } from "react";
import { CURRENCIES, type Currency } from "@codex/shared";
import type { AppCore } from "@codex/local-core";
import { AuthShell, Brand, Field, Icon, Notice, type IconName } from "@codex/ui";
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

function Choice({ icon, title, body, onClick, primary }: { icon: IconName; title: string; body: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className={`choice ${primary ? "primary" : ""}`} onClick={onClick}>
      <span className={`icon-tile ${primary ? "gold" : ""}`} style={{ width: 40, height: 40 }}><Icon name={icon} size={18} /></span>
      <span><b>{title}</b><small>{body}</small></span>
      <Icon name="chevronRight" size={18} />
    </button>
  );
}

void Brand;

type Mode = "choose" | "cloud-new" | "cloud-join" | "local" | "restore";

export function SetupWizard({ core, defaultApi, onRecoveryKey }: { core: AppCore; defaultApi: string; onRecoveryKey: (k: string) => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [f, setF] = useState({
    apiBase: defaultApi, setupToken: "", username: "", password: "", password2: "", vault: "", vault2: "", currency: "PKR" as Currency,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode !== "cloud-join") {
      if (f.password !== f.password2) return setError("Login passwords do not match");
      if (f.vault !== f.vault2) return setError("Vault passphrases do not match");
    }
    setBusy(true);
    try {
      if (mode === "local") {
        const r = await core.setupLocal({ username: f.username, password: f.password, vaultPassphrase: f.vault, currency: f.currency });
        onRecoveryKey(r.recoveryKey);
      } else if (mode === "cloud-new") {
        const r = await core.setupCloud({ apiBase: f.apiBase, setupToken: f.setupToken, username: f.username, password: f.password, vaultPassphrase: f.vault, currency: f.currency });
        onRecoveryKey(r.recoveryKey);
      } else {
        await core.connectExisting({ apiBase: f.apiBase, username: f.username, password: f.password });
      }
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "choose")
    return (
      <AuthCard steps={3} step={0}>
        <h1>Welcome</h1>
        <p className="lede">Set up this PC. All inventory work happens locally and keeps working without internet.</p>
        <div className="auth-choices">
          <Choice primary icon="cloud" title="First PC" body="Create my cloud owner account" onClick={() => setMode("cloud-new")} />
          <Choice icon="devices" title="Another PC" body="Sign in to my existing cloud account" onClick={() => setMode("cloud-join")} />
          <Choice icon="wifiOff" title="No internet right now" body="Local-only setup — connect to the cloud later" onClick={() => setMode("local")} />
          <Choice icon="backup" title="Restore a backup" body="From an encrypted .cxbackup file" onClick={() => setMode("restore")} />
        </div>
      </AuthCard>
    );

  if (mode === "restore")
    return (
      <AuthCard steps={3} step={1}>
        <h1>Restore from backup</h1>
        <p className="lede">After restoring, sign in with the login password that was valid when the backup was made.</p>
        <Field label="Backup password"><input type="password" value={f.password} onChange={(e) => up({ password: e.target.value })} autoFocus /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setMode("choose")}>Back</button>
          <span className="grow" />
          <button
            className="btn primary"
            disabled={busy || !f.password}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                const text = await openBackupFile();
                if (text) await core.restoreBackup(text, f.password);
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
    <AuthCard steps={3} step={1}>
      <h1>{mode === "cloud-new" ? "Create cloud owner account" : mode === "cloud-join" ? "Connect this PC" : "Local-only setup"}</h1>
      <form onSubmit={submit}>
        {mode !== "local" && (
          <Field label="Server URL"><input value={f.apiBase} onChange={(e) => up({ apiBase: e.target.value })} required /></Field>
        )}
        {mode === "cloud-new" && (
          <Field label="Server setup code" hint="The one-time SETUP_TOKEN configured on your server (see docs/DEPLOYMENT.md).">
            <input value={f.setupToken} onChange={(e) => up({ setupToken: e.target.value })} required autoComplete="off" />
          </Field>
        )}
        <Field label="Owner username"><input value={f.username} onChange={(e) => up({ username: e.target.value })} required autoFocus autoComplete="username" /></Field>
        <Field label="Login password" hint={mode === "cloud-join" ? undefined : "10+ characters, mixed letters, numbers and symbols"}>
          <input type="password" value={f.password} onChange={(e) => up({ password: e.target.value })} required autoComplete={mode === "cloud-join" ? "current-password" : "new-password"} />
        </Field>
        {mode !== "cloud-join" && (
          <>
            <Field label="Repeat login password"><input type="password" value={f.password2} onChange={(e) => up({ password2: e.target.value })} required /></Field>
            <Notice kind="info" className="small">
              The <b>vault passphrase</b> encrypts stored game-account passwords and backup codes. It must differ from your login password,
              and it never leaves your devices. You will also get a <b>recovery key</b>.
            </Notice>
            <Field label="Vault passphrase" hint="12+ characters"><input type="password" value={f.vault} onChange={(e) => up({ vault: e.target.value })} required autoComplete="new-password" /></Field>
            <Field label="Repeat vault passphrase"><input type="password" value={f.vault2} onChange={(e) => up({ vault2: e.target.value })} required /></Field>
            <Field label="Default reporting currency">
              <select value={f.currency} onChange={(e) => up({ currency: e.target.value as Currency })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
          </>
        )}
        {mode === "cloud-join" && (
          <p className="muted small">After signing in, your inventory downloads. Stored passwords stay encrypted until you unlock the vault with your vault passphrase.</p>
        )}
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setMode("choose")}>Back</button>
          <span className="grow" />
          <button className="btn primary" disabled={busy}>{busy ? "Working…" : mode === "cloud-join" ? "Sign in & download" : "Create"}</button>
        </div>
      </form>
    </AuthCard>
  );
}

export function RecoveryKeyScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <AuthCard steps={3} step={2}>
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
      <h1>Welcome back</h1>
      <p className="lede">Works offline on this PC. When online, your cloud session is refreshed automatically.</p>
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
        <Field label="Username"><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></Field>
        <Field label="Password"><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoFocus autoComplete="current-password" required /></Field>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setReset(true)}>Forgot password?</button>
          <span className="grow" />
          <button className="btn primary" disabled={busy}><Icon name="lock" size={15} /> {busy ? "Checking…" : "Sign in"}</button>
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
