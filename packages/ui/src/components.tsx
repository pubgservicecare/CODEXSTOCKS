import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney, normalizeNewlines, PRESERVE_WHITESPACE_STYLE, type Currency } from "@codex/shared";
import type { DataService } from "./service";
import { Icon, type IconName } from "./icons";

/* ------------------------------------------------------------------ */
/* context                                                             */
/* ------------------------------------------------------------------ */

interface Ctx {
  svc: DataService;
  toast: (msg: string, kind?: "ok" | "bad") => void;
  /** Ask the owner to unlock the vault; resolves true when unlocked. */
  requireVault: () => Promise<boolean>;
  version: number;
}
export const AppCtx = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

/** Load async data, re-running when deps or the service's data version changes. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

/** Wrap an action with busy state + error toast. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        return r;
      } catch (e) {
        toast(errMsg(e), "bad");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

/* ------------------------------------------------------------------ */
/* small components                                                    */
/* ------------------------------------------------------------------ */

export function Money({ minor, currency }: { minor: number | null | undefined; currency: Currency | null | undefined }) {
  if (minor === null || minor === undefined || !currency) return <span className="faint">—</span>;
  return <span style={{ fontVariantNumeric: "tabular-nums", color: minor < 0 ? "var(--bad)" : undefined }}>{formatMoney(minor, currency)}</span>;
}

/**
 * Renders owner-written TXT exactly: spaces, tabs, blank lines and line breaks are preserved with
 * white-space: pre-wrap. React escapes the text, so it is never interpreted as HTML.
 */
export function TxtView({ text, className = "txt-view" }: { text: string; className?: string }) {
  return (
    <pre className={className} style={PRESERVE_WHITESPACE_STYLE} data-testid="txt-view">
      {normalizeNewlines(text)}
    </pre>
  );
}

const STATUS_BADGE: Record<string, string> = { available: "ok", reserved: "warn", sold: "info", archived: "" };
const STATUS_LABEL: Record<string, string> = { available: "Available", reserved: "Reserved", sold: "Sold", archived: "Archived" };
export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  return (
    <span className={`badge ${STATUS_BADGE[status] ?? ""} ${className}`}>
      <span className={`dot ${STATUS_BADGE[status] === "info" ? "" : STATUS_BADGE[status] ?? ""}`} style={STATUS_BADGE[status] === "info" ? { background: "var(--info)" } : undefined} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function SyncDot({ state }: { state?: string }) {
  if (!state) return null;
  const cls = state === "synced" ? "ok" : state === "pending" ? "warn" : "bad";
  const label = state === "synced" ? "Synced" : state === "pending" ? "Waiting to sync" : state === "conflict" ? "Conflict" : "Sync error";
  return <span className={`dot ${cls}`} title={label} aria-label={label} role="img" />;
}

/** Icon + message banner. */
export function Notice({ kind = "info", children, className = "" }: { kind?: "info" | "ok" | "warn" | "bad"; children: ReactNode; className?: string }) {
  const icon: IconName = kind === "ok" ? "check" : kind === "info" ? "info" : "alert";
  return (
    <div className={`notice ${kind} ${className}`} role={kind === "bad" ? "alert" : undefined}>
      <Icon name={icon} size={16} />
      <div>{children}</div>
    </div>
  );
}

/** Line illustration for empty states: a supply crate drifting down on a parachute. */
export function DropIllustration() {
  return (
    <svg className="illo" viewBox="0 0 120 96" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 34C22 16 40 6 60 6s38 10 38 28" />
      <path d="M22 34q7.6-5 15.2 0t15.2 0 15.2 0 15.2 0 15.2 0" />
      <path d="M44 9c-4 8-6 16-6 25M76 9c4 8 6 16 6 25M60 6v28" opacity="0.55" />
      <path d="M22 34l30 30M98 34 68 64M52.4 34 56 64M67.6 34 64 64" opacity="0.7" />
      <rect x="48" y="64" width="24" height="20" rx="2.5" stroke="var(--accent)" />
      <path d="M48 71h24M60 64v20" stroke="var(--accent)" opacity="0.7" />
      <path d="M8 92h104" opacity="0.4" strokeDasharray="2 5" />
    </svg>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty-state">
      {icon ? <div className="icon-tile" style={{ width: 44, height: 44, marginBottom: 8 }}><Icon name={icon} size={20} /></div> : <DropIllustration />}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Field(props: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; optional?: boolean }) {
  const required = /\s\*$/.test(props.label) || /\s\*\s/.test(props.label);
  const text = props.label.replace(/\s\*(?=\s|$)/, "");
  return (
    <label className={`field ${props.className ?? ""}`}>
      <span>
        {text}
        {required && <span className="req" aria-label="required">*</span>}
        {props.optional && <span className="opt">Optional</span>}
      </span>
      {props.children}
      {props.hint && <small className="hint">{props.hint}</small>}
      {props.error && <small className="err"><Icon name="alert" size={13} />{props.error}</small>}
    </label>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; icon?: IconName }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <h2>
          {props.icon && <span className="icon-tile gold"><Icon name={props.icon} size={16} /></span>}
          {props.title}
        </h2>
        {props.children}
      </div>
    </div>
  );
}

export function Confirm(props: { title: string; body: ReactNode; confirm: string; danger?: boolean; onYes: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div>{props.body}</div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={props.onClose}>Cancel</button>
        <button
          className={`btn ${props.danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onYes();
              props.onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {props.confirm}
        </button>
      </div>
    </Modal>
  );
}

export function Loading({ error, loading, rows = 4 }: { error?: string | null; loading?: boolean; rows?: number }) {
  if (error) return <Notice kind="bad">{error}</Notice>;
  if (loading)
    return (
      <div className="skeleton" aria-busy="true" aria-label="Loading">
        <div className="sk" style={{ height: 28, width: "32%" }} />
        {Array.from({ length: rows }, (_, i) => <div key={i} className="sk" style={{ height: 52, opacity: 1 - i * 0.18 }} />)}
      </div>
    );
  return null;
}

/** A secret shown masked; revealed only after vault unlock; auto-hides after 30 s. */
export function SecretValue({ reveal, mask = "••••••••••" }: { reveal: () => string; mask?: string }) {
  const { requireVault, svc, toast } = useApp();
  const [value, setValue] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    if (!svc.vaultUnlocked()) setValue(null);
  });
  const show = async () => {
    if (!(await requireVault())) return;
    try {
      setValue(reveal());
      timer.current && clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), 30_000);
    } catch (e) {
      toast(errMsg(e), "bad");
    }
  };
  return (
    <span className="secret">
      <span>{value ?? mask}</span>
      {value ? (
        <>
          <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(value).then(() => toast("Copied (clipboard clears when you copy something else)"))}>
            <Icon name="copy" size={14} /> Copy
          </button>
          <button className="btn ghost sm" onClick={() => setValue(null)}>Hide</button>
        </>
      ) : (
        <button className="btn ghost sm" onClick={show}><Icon name="eye" size={14} /> Reveal</button>
      )}
    </span>
  );
}

/** Audit details as readable "key value" pairs (ids shortened); falls back to the raw text. */
export function AuditDetails({ details }: { details: string }) {
  let obj: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(details);
    if (v && typeof v === "object" && !Array.isArray(v)) obj = v as Record<string, unknown>;
  } catch {
    obj = null;
  }
  if (!obj) return <span className="small mono muted" style={{ wordBreak: "break-word" }}>{details}</span>;
  const entries = Object.entries(obj).filter(([k]) => k !== "account_id");
  if (!entries.length) return <span className="faint">—</span>;
  const show = (v: unknown) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s) ? `${s.slice(0, 8)}…` : s.length > 60 ? `${s.slice(0, 60)}…` : s;
  };
  return (
    <span className="details-list">
      {entries.map(([k, v]) => (
        <span key={k}><b>{k.replace(/_/g, " ")}</b>{show(v)}</span>
      ))}
    </span>
  );
}

/** "device:01a18033-…" -> "Device 01a18033"; "web:…" -> "Admin website". */
export function actorLabel(actor: string): string {
  const [kind, id = ""] = actor.split(":");
  if (kind === "device") return `Device ${id.slice(0, 8)}`;
  if (kind === "web") return "Admin website";
  return actor;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
