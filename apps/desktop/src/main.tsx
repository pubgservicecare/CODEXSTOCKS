import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppCore, type AppState } from "@codex/local-core";
import { AdminApp } from "@codex/ui";
import "@codex/ui/styles.css";
import { appInfo, tauriDriver, tauriFiles, type AppInfo } from "./platform";
import { desktopService } from "./DesktopService";
import { CreateVaultScreen, LoginScreen, RecoveryKeyScreen, SetupWizard, AuthCard } from "./screens";

/** Public build-time value only (no secrets): the default cloud API URL. */
const DEFAULT_API = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "https://admin.codexstocks.org";

function Signed({ core, st }: { core: AppCore; st: AppState }) {
  const svc = useMemo(() => desktopService(core, () => st.username), [core, st.username]);
  const last = useRef(Date.now());

  // Idle lock: sign out (which also wipes the vault key) after N minutes without input.
  useEffect(() => {
    const bump = () => (last.current = Date.now());
    const evs = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    let minutes = 10;
    core.prefs().then((p) => (minutes = p.idle_minutes));
    const off = core.subscribe(() => core.prefs().then((p) => (minutes = p.idle_minutes)));
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) core.logout();
    }, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
      off();
    };
  }, [core]);

  // Background sync: on start, every minute, and when connectivity returns. Never blocks the UI.
  useEffect(() => {
    const run = () => void core.sync.syncOnce();
    run();
    const t = setInterval(run, 60_000);
    window.addEventListener("online", run);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", run);
    };
  }, [core]);

  return <AdminApp svc={svc} router="hash" />;
}

function Root({ core, info }: { core: AppCore; info: AppInfo }) {
  const [st, setSt] = useState<AppState | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => void core.state().then(setSt);
    refresh();
    return core.subscribe(refresh);
  }, [core]);
  void info;
  if (!st) return <AuthCard><p className="muted">Opening local database…</p></AuthCard>;
  if (recovery) return <RecoveryKeyScreen recoveryKey={recovery} onDone={() => setRecovery(null)} />;
  if (!st.setup) return <SetupWizard core={core} defaultApi={st.apiBase || DEFAULT_API} onRecoveryKey={setRecovery} />;
  if (!st.loggedIn)
    return (
      <LoginScreen
        core={core}
        username={st.username}
        onLoggedIn={(password) => {
          // Confirm the cloud still accepts this device (re-enrols on 401) without blocking offline use.
          void core.refreshCloudSession(password).then(() => core.sync.syncOnce());
        }}
      />
    );
  if (!st.hasVault) return <CreateVaultScreen core={core} onRecoveryKey={setRecovery} />;
  return <Signed core={core} st={st} />;
}

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const info = await appInfo();
    const core = await AppCore.open({
      driver: tauriDriver,
      files: tauriFiles,
      deviceName: info.device_name,
      platform: "windows",
      defaultApiBase: DEFAULT_API,
    });
    root.render(
      <StrictMode>
        <Root core={core} info={info} />
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <AuthCard>
        <h1>Could not start</h1>
        <div className="notice bad" role="alert">{e instanceof Error ? e.message : String(e)}</div>
        <p className="muted small">Your data has not been changed. Restart the app; if this persists see docs/TROUBLESHOOTING in the README.</p>
      </AuthCard>,
    );
  }
}

void boot();
