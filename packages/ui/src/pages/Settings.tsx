import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { CURRENCIES, SETTING_KEYS, type SettingKey } from "@codex/shared";
import { errMsg, Field, Modal, useAction, useApp, useLoad } from "../components";

function StoreSettings() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const { data } = useLoad(() => svc.list("settings"), []);
  const [f, setF] = useState<Record<SettingKey, string>>({ store_name: "CODE X STOCKS", store_tagline: "", public_whatsapp: "", default_currency: "PKR" });
  useEffect(() => {
    if (data) setF((cur) => ({ ...cur, ...Object.fromEntries(data.map((s) => [s.key, s.value])) }));
  }, [data]);
  const save = () =>
    run(async () => {
      const before = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
      for (const k of SETTING_KEYS) if ((before[k] ?? "") !== f[k]) await svc.exec("saveSetting", { key: k, value: f[k] });
    }, "Settings saved");
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="globe" size={16} /></span><h2>Store · shared with website</h2></div>
      <div className="form-grid">
        <Field label="Store name"><input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} /></Field>
        <Field label="Tagline"><input value={f.store_tagline} onChange={(e) => setF({ ...f, store_tagline: e.target.value })} /></Field>
        <Field label="Public WhatsApp number" hint="Shown to customers for enquiries, international format e.g. +92 300 1234567">
          <input value={f.public_whatsapp} onChange={(e) => setF({ ...f, public_whatsapp: e.target.value })} />
        </Field>
        <Field label="Default reporting currency">
          <select value={f.default_currency} onChange={(e) => setF({ ...f, default_currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save store settings</button>
    </div>
  );
}

function LocalPrefs() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const { data } = useLoad(() => (svc.prefs ? svc.prefs() : Promise.resolve(null)), []);
  const [idle, setIdle] = useState("10");
  const [api, setApi] = useState("");
  useEffect(() => {
    if (data) {
      setIdle(String(data.idle_minutes));
      setApi(data.api_base);
    }
  }, [data]);
  if (!svc.prefs) return null;
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="devices" size={16} /></span><h2>{svc.kind === "desktop" ? "This PC" : "This browser"}</h2></div>
      <div className="form-grid">
        <Field label="Auto-lock after inactivity (minutes)" hint="Signs out and clears the vault key from memory">
          <input type="number" min={1} max={240} value={idle} onChange={(e) => setIdle(e.target.value)} />
        </Field>
        {svc.kind === "desktop" && (
          <Field label="Cloud server URL" hint="Used for new cloud connections">
            <input value={api} onChange={(e) => setApi(e.target.value)} />
          </Field>
        )}
      </div>
      <button className="btn" disabled={busy} onClick={() => run(() => svc.savePrefs!({ idle_minutes: Number(idle), api_base: api.trim() }), "Saved")}>Save</button>
    </div>
  );
}

function CloudCard() {
  const { svc, requireVault } = useApp();
  const { busy, run } = useAction();
  const { data, reload } = useLoad(() => (svc.cloudInfo ? svc.cloudInfo() : Promise.resolve(null)), []);
  const [f, setF] = useState({ apiBase: "", username: svc.username() ?? "", password: "", cloudVaultPassphrase: "" });
  useEffect(() => {
    if (data) setF((x) => ({ ...x, apiBase: x.apiBase || data.apiBase }));
  }, [data]);
  if (!data) return null;
  if (data.paired)
    return (
      <div className="card">
        <div className="card-head"><span className="icon-tile"><Icon name="cloud" size={16} /></span><h2>Cloud connection</h2><span className="badge ok">Connected</span></div>
        <dl className="kv"><dt>Server</dt><dd>{data.apiBase}</dd><dt>Device ID</dt><dd className="mono small">{data.deviceId}</dd></dl>
        {data.problem && <div className="notice warn" style={{ marginTop: 10 }}>{data.problem}</div>}
      </div>
    );
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="cloudOff" size={16} /></span><h2>Connect to cloud</h2><span className="badge">Local only</span></div>
      <p className="muted small">
        Sign in with your existing cloud owner account to authorise this PC. Your local inventory is uploaded with its existing IDs (no duplicates). If the cloud already
        has a credential vault, enter its passphrase so local secrets can be re-encrypted under it.
      </p>
      <div className="form-grid">
        <Field label="Server URL"><input value={f.apiBase} onChange={(e) => setF({ ...f, apiBase: e.target.value })} /></Field>
        <Field label="Owner username"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" /></Field>
        <Field label="Login password"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Cloud vault passphrase" hint="Only if the cloud already has a vault"><input type="password" value={f.cloudVaultPassphrase} onChange={(e) => setF({ ...f, cloudVaultPassphrase: e.target.value })} /></Field>
      </div>
      <button
        className="btn primary"
        disabled={busy || !f.password}
        onClick={async () => {
          if (!(await requireVault())) return;
          await run(
            () => svc.pairWithCloud!({ ...f, cloudVaultPassphrase: f.cloudVaultPassphrase || undefined }),
            "Connected to the cloud",
          );
          reload();
        }}
      >
        Sign in &amp; connect
      </button>
    </div>
  );
}

function Security() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const [lp, setLp] = useState({ current: "", next: "", again: "" });
  const [vp, setVp] = useState({ mode: "pass" as "pass" | "recovery", current: "", next: "", again: "" });
  const [rot, setRot] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile gold"><Icon name="shield" size={16} /></span><h2>Security</h2></div>
      {err && <div className="notice bad">{err}</div>}
      <div className="grid grid-3">
        <div>
          <h3>Login password</h3>
          <Field label="Current"><input type="password" value={lp.current} onChange={(e) => setLp({ ...lp, current: e.target.value })} /></Field>
          <Field label="New"><input type="password" value={lp.next} onChange={(e) => setLp({ ...lp, next: e.target.value })} /></Field>
          <Field label="Repeat new"><input type="password" value={lp.again} onChange={(e) => setLp({ ...lp, again: e.target.value })} /></Field>
          <button className="btn" disabled={busy || !lp.next} onClick={() => {
            setErr(null);
            if (lp.next !== lp.again) return setErr("New passwords do not match");
            run(() => svc.changeLoginPassword(lp.current, lp.next), "Login password changed").then((r) => r !== undefined && setLp({ current: "", next: "", again: "" }));
          }}>Change login password</button>
        </div>
        <div>
          <h3>Vault passphrase</h3>
          <Field label={vp.mode === "pass" ? "Current passphrase" : "Recovery key"}>
            <input type={vp.mode === "pass" ? "password" : "text"} className={vp.mode === "recovery" ? "mono" : ""} value={vp.current} onChange={(e) => setVp({ ...vp, current: e.target.value })} />
          </Field>
          <Field label="New passphrase"><input type="password" value={vp.next} onChange={(e) => setVp({ ...vp, next: e.target.value })} /></Field>
          <Field label="Repeat new"><input type="password" value={vp.again} onChange={(e) => setVp({ ...vp, again: e.target.value })} /></Field>
          <div className="row">
            <button className="btn" disabled={busy || !vp.next} onClick={() => {
              setErr(null);
              if (vp.next !== vp.again) return setErr("New passphrases do not match");
              const auth = vp.mode === "pass" ? { passphrase: vp.current } : { recoveryKey: vp.current };
              run(() => svc.changeVaultPassphrase(auth, vp.next), "Vault passphrase changed (the data key is unchanged)").then((r) => r !== undefined && setVp({ ...vp, current: "", next: "", again: "" }));
            }}>Change passphrase</button>
            <button className="btn ghost sm" onClick={() => setVp({ ...vp, mode: vp.mode === "pass" ? "recovery" : "pass", current: "" })}>
              {vp.mode === "pass" ? "Forgot it? Use recovery key" : "Use passphrase"}
            </button>
          </div>
        </div>
        <div>
          <h3>Recovery key</h3>
          <p className="small muted">Issue a new recovery key if the old one may be exposed. The old key stops working.</p>
          <Field label="Vault passphrase"><input type="password" value={rot} onChange={(e) => setRot(e.target.value)} /></Field>
          <button className="btn" disabled={busy || !rot} onClick={async () => {
            setErr(null);
            try {
              setNewKey(await svc.rotateRecoveryKey(rot));
              setRot("");
            } catch (e) {
              setErr(errMsg(e));
            }
          }}>Issue new recovery key</button>
        </div>
      </div>
      {newKey && (
        <Modal title="New recovery key" onClose={() => setNewKey(null)}>
          <p>Write this down and store it offline. It is shown only once. Without the passphrase AND this key, stored secrets cannot be recovered.</p>
          <div className="recovery">{newKey}</div>
          <div className="modal-actions"><button className="btn primary" onClick={() => setNewKey(null)}>I have stored it safely</button></div>
        </Modal>
      )}
    </div>
  );
}

export function SettingsPage() {
  return (
    <>
      <div className="cx-page-head"><div><h1>Settings</h1><p>Store details shown on the website, this device, cloud connection and security.</p></div></div>
      <StoreSettings />
      <LocalPrefs />
      <CloudCard />
      <Security />
    </>
  );
}
