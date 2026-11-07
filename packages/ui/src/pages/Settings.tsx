import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { CURRENCIES, formatRate, formatUsdtPkr, localDate, parseManualUsdtRate, parseUsdtPkr, type SettingKey } from "@codex/shared";
import { errMsg, Field, Modal, Notice, useAction, useApp, useLoad } from "../components";
import { useFx } from "../fx-ui";

const STORE_KEYS = ["store_name", "store_tagline", "public_whatsapp", "default_currency"] as const satisfies readonly SettingKey[];
const CONTACT_KEYS = ["contact_owner", "contact_phone", "contact_email", "contact_website", "contact_address", "contact_hours", "contact_social", "contact_other"] as const satisfies readonly SettingKey[];

function StoreSettings() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const { data } = useLoad(() => svc.list("settings"), []);
  const [f, setF] = useState<Record<(typeof STORE_KEYS)[number], string>>({ store_name: "CODE X STOCKS", store_tagline: "", public_whatsapp: "", default_currency: "PKR" });
  useEffect(() => {
    if (data) setF((cur) => ({ ...cur, ...Object.fromEntries(data.filter((s) => (STORE_KEYS as readonly string[]).includes(s.key)).map((s) => [s.key, s.value])) }));
  }, [data]);
  const save = () =>
    run(async () => {
      const before = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
      for (const k of STORE_KEYS) if ((before[k] ?? "") !== f[k]) await svc.exec("saveSetting", { key: k, value: f[k] });
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

/** Public business details printed on receipts. Empty fields are simply left off — nothing is invented. */
function ContactSettings() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const { data } = useLoad(() => svc.list("settings"), []);
  const [f, setF] = useState<Record<(typeof CONTACT_KEYS)[number], string>>(() => Object.fromEntries(CONTACT_KEYS.map((k) => [k, ""])) as Record<(typeof CONTACT_KEYS)[number], string>);
  useEffect(() => {
    if (data) setF((cur) => ({ ...cur, ...Object.fromEntries(data.filter((s) => (CONTACT_KEYS as readonly string[]).includes(s.key)).map((s) => [s.key, s.value])) }));
  }, [data]);
  const up = (k: (typeof CONTACT_KEYS)[number]) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () =>
    run(async () => {
      const before = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
      for (const k of CONTACT_KEYS) if ((before[k] ?? "") !== f[k]) await svc.exec("saveSetting", { key: k, value: f[k].trim() });
    }, "Contact details saved");
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="receipt" size={16} /></span><h2>Contact information · shown on receipts</h2></div>
      <p className="small muted" style={{ marginTop: -6 }}>
        Only public business details belong here. The business name and WhatsApp number come from the store settings above. Never put passwords,
        account logins or private notes in these fields.
      </p>
      <div className="form-grid">
        <Field label="Owner / display name" optional><input value={f.contact_owner} onChange={up("contact_owner")} maxLength={200} /></Field>
        <Field label="Phone" optional><input value={f.contact_phone} onChange={up("contact_phone")} maxLength={60} inputMode="tel" /></Field>
        <Field label="Email" optional><input value={f.contact_email} onChange={up("contact_email")} maxLength={200} inputMode="email" /></Field>
        <Field label="Website" optional><input value={f.contact_website} onChange={up("contact_website")} maxLength={200} placeholder="codexstocks.org" /></Field>
        <Field label="Address" optional className="full"><input value={f.contact_address} onChange={up("contact_address")} maxLength={300} /></Field>
        <Field label="Business hours" optional><input value={f.contact_hours} onChange={up("contact_hours")} maxLength={200} placeholder="e.g. 11 am – 11 pm, every day" /></Field>
        <Field label="Other public contact" optional><input value={f.contact_other} onChange={up("contact_other")} maxLength={300} /></Field>
        <Field label="Social links" optional hint="One per line, e.g. Instagram: @codexstocks" className="full"><textarea rows={3} value={f.contact_social} onChange={up("contact_social")} maxLength={1000} /></Field>
      </div>
      <button className="btn primary" disabled={busy} onClick={save}>Save contact details</button>
    </div>
  );
}

/** USDT (Tether) is its own currency: reference rate from CoinGecko, or the owner's own rate (e.g. the P2P rate used). */
function UsdtRateSettings() {
  const { svc, toast } = useApp();
  const { usdtProvider, usdt, usdtMode } = useFx();
  const { data } = useLoad(() => svc.list("settings"), []);
  const saved = parseManualUsdtRate(data?.find((s) => s.key === "usdt_pkr_manual")?.value);
  const [mode, setMode] = useState<"provider" | "manual">(usdtMode);
  const [rate, setRate] = useState("");
  const [eff, setEff] = useState(localDate());
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMode(usdtMode), [usdtMode]);
  useEffect(() => {
    if (saved && !rate) {
      setRate(formatRate(saved.rate_micro));
      setEff(saved.effective_on);
      setNote(saved.note ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.set_at]);
  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const micro = rate.trim() ? parseUsdtPkr(rate) : null;
      if (mode === "manual" && !micro) throw new Error("Enter your USDT rate in PKR");
      await svc.exec("setUsdtRate", { mode, rate_micro: micro, effective_on: eff, note });
      toast("USDT rate saved");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="wallet" size={16} /></span><h2>USDT rate</h2>{usdt && <span className="badge">{formatUsdtPkr(usdt.usdt_pkr_micro)}</span>}</div>
      <p className="small muted" style={{ marginTop: -6 }}>
        Used for the USDT equivalent of your profit and charts, and suggested when a payment is made in USDT. USDT is never treated as USD.
      </p>
      <div className="seg" role="group" aria-label="USDT rate source" style={{ marginBottom: 12 }}>
        <button type="button" className={mode === "provider" ? "on" : ""} aria-pressed={mode === "provider"} onClick={() => setMode("provider")}>Reference rate</button>
        <button type="button" className={mode === "manual" ? "on" : ""} aria-pressed={mode === "manual"} onClick={() => setMode("manual")}>My own rate</button>
      </div>
      <p className="small">
        {usdtProvider ? (
          <>Reference: <b>{formatUsdtPkr(usdtProvider.usdt_pkr_micro)}</b> · Powered by CoinGecko · {new Date(usdtProvider.effective_at ?? usdtProvider.retrieved_at).toLocaleString()}{usdtProvider.status === "stale" ? <b className="fx-stale"> · stale</b> : null}</>
        ) : (
          <span className="faint">Reference rate unavailable right now (offline or the provider did not answer). No rate is made up — use your own rate.</span>
        )}
      </p>
      <div className="form-grid">
        <Field label="My USDT rate (PKR per 1 USDT)" optional={mode === "provider"} hint={saved ? `Saved: ${formatUsdtPkr(saved.rate_micro)} from ${saved.effective_on}` : undefined}>
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="e.g. 281.50" />
        </Field>
        <Field label="Effective date"><input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
        <Field label="Note" optional className="full"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Binance P2P rate" /></Field>
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      <button className="btn primary" disabled={busy} onClick={() => void save()}>Save USDT rate</button>
      <p className="small faint" style={{ marginBottom: 0 }}>Payments keep the rate saved with them; changing this never alters past records.</p>
    </div>
  );
}

export function SettingsPage() {
  return (
    <>
      <div className="cx-page-head"><div><h1>Settings</h1><p>Store details shown on the website, receipt contact details, USDT rate, this device, cloud connection and security.</p></div></div>
      <StoreSettings />
      <ContactSettings />
      <UsdtRateSettings />
      <LocalPrefs />
      <CloudCard />
      <Security />
    </>
  );
}
