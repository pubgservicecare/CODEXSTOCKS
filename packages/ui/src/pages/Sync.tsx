import { useState } from "react";
import { Icon } from "../icons";
import { fmtDate, Loading, Modal, useAction, useApp, useLoad } from "../components";
import { EmptyState } from "../components";
import type { ConflictView } from "../service";

const HIDDEN = new Set(["rev", "created_at", "updated_at", "secret_ct", "code_ct", "code_tag"]);

function show(v: unknown) {
  if (v === null || v === undefined) return <span className="faint">—</span>;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{s}</span>;
}

function ConflictDialog({ c, onClose }: { c: ConflictView; onClose: () => void }) {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const keys = Array.from(new Set([...Object.keys(c.local ?? {}), ...Object.keys(c.server ?? {})])).filter((k) => !HIDDEN.has(k));
  const changed = (k: string) =>
    JSON.stringify((c.local as Record<string, unknown> | null)?.[k] ?? null) !== JSON.stringify((c.server as Record<string, unknown> | null)?.[k] ?? null);
  const decide = (choice: "local" | "server") =>
    run(() => svc.resolveConflict(c.id, choice), "Conflict resolved").then((r) => r !== undefined && onClose());
  return (
    <Modal wide title={`Resolve conflict · ${c.entity}`} onClose={onClose}>
      <p className="muted small">
        The same record was changed in two places. Nothing was overwritten. Compare both versions and choose which one to keep.
        {c.local && "secret_ct" in c.local && " (Encrypted secrets are compared but not displayed.)"}
      </p>
      <div className="table-wrap">
        <table className="diff">
          <thead><tr><th>Field</th><th>{c.keepLocalLabel}</th><th>{c.keepServerLabel}</th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="small mono">{k}{c.fields.includes(k) && <span className="badge warn" style={{ marginLeft: 6 }}>conflict</span>}</td>
                <td className={changed(k) ? "changed" : ""}>{show((c.local as Record<string, unknown> | null)?.[k])}</td>
                <td className={changed(k) ? "changed" : ""}>{show((c.server as Record<string, unknown> | null)?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Decide later</button>
        <button className="btn" disabled={busy || !c.server} onClick={() => decide("server")}>Keep {c.keepServerLabel.toLowerCase()}</button>
        <button className="btn primary" disabled={busy || !c.local} onClick={() => decide("local")}>Keep {c.keepLocalLabel.toLowerCase()}</button>
      </div>
    </Modal>
  );
}

function CloudStatus({ cloud }: { cloud: NonNullable<import("../service").SyncSummary["cloud"]> }) {
  const { svc } = useApp();
  const devices = useLoad(() => svc.devices(), []);
  return (
    <div className="card">
      <div className="card-head"><span className="icon-tile"><Icon name="cloud" size={16} /></span><h2>Cloud status</h2><span className="badge ok">Online</span></div>
      <p className="muted small">
        Changes made here are saved directly to the cloud and reach every PC at its next sync. Each PC keeps its own offline queue; open
        that PC's Sync page to see its pending or failed items.
      </p>
      <dl className="kv">
        <dt>Open conflicts</dt><dd>{cloud.open_conflicts}</dd>
        <dt>Enrolled devices</dt><dd>{cloud.active_devices}</dd>
        <dt>Last device sync</dt><dd>{fmtDate(cloud.last_device_sync_at, true)}</dd>
      </dl>
      {devices.data && devices.data.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Device</th><th>Last synced</th><th>Status</th></tr></thead>
            <tbody>
              {devices.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="small">{fmtDate(d.last_seen_at, true)}</td>
                  <td>{d.revoked_at ? <span className="badge bad">Revoked</span> : <span className="badge ok">Active</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SyncPage() {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const status = useLoad(() => (svc.syncStatus ? svc.syncStatus() : Promise.resolve(null)), []);
  const conflicts = useLoad(() => svc.conflicts(), []);
  const issues = useLoad(() => (svc.outboxIssues ? svc.outboxIssues() : Promise.resolve([])), []);
  const [open, setOpen] = useState<ConflictView | null>(null);
  const s = status.data;
  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>{svc.kind === "desktop" ? "Sync & conflicts" : "Sync status & conflicts"}</h1>
          <p>
            {svc.kind === "desktop"
              ? "Every change is saved on this PC first, then uploaded in order. Failed uploads retry automatically with back-off; local data is never removed by a sync failure."
              : "Edits that clashed between devices are listed here for an explicit decision."}
          </p>
        </div>
        <span className="spacer" />
        {svc.syncNow && <button className="btn primary" disabled={busy} onClick={() => run(() => svc.syncNow!(), "Sync finished")}>Sync now</button>}
      </div>

      {s?.cloud && <CloudStatus cloud={s.cloud} />}
      {s && !s.cloud && (
        <div className="card">
          {s.phase === "unpaired" && <div className="notice info">This PC works in local-only mode. Connect it to the cloud from Settings to sync with other devices and the website.</div>}
          {s.phase === "auth" && <div className="notice bad">The cloud no longer accepts this device's session. Sign out and sign in while online with your current cloud password.</div>}
          {s.vaultMismatch && <div className="notice bad">This PC's credential vault differs from the cloud vault. Contact support documentation: docs/SECURITY.md (vault merge).</div>}
          {s.notice && <div className="notice warn">{s.notice}</div>}
          {s.lastError && <div className="notice warn">Last sync problem: {s.lastError}</div>}
          <dl className="kv">
            <dt>State</dt><dd>{s.phase}</dd>
            <dt>Last successful sync</dt><dd>{fmtDate(s.lastSyncAt, true)}</dd>
            <dt>Changes waiting</dt><dd>{s.pending}</dd>
            <dt>Changes retrying</dt><dd>{s.failed}</dd>
            <dt>Rejected changes</dt><dd>{s.rejected}</dd>
            <dt>Images queued</dt><dd>{s.queuedImages} ({s.failedImages} failed)</dd>
          </dl>
        </div>
      )}

      <div className="card">
        <div className="card-head"><span className="icon-tile"><Icon name="shield" size={16} /></span><h2>Conflicts</h2></div>
        <Loading error={conflicts.error} loading={conflicts.loading && !conflicts.data} />
        {conflicts.data?.length === 0 && <EmptyState icon="check" title="No conflicts" body="Every device agrees with the cloud. When two devices change the same record, you choose which version to keep here." />}
        {conflicts.data?.map((c) => (
          <div key={c.id} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="badge warn">{c.entity}</span>
            <span className="grow small">
              {(c.local as { title?: string } | null)?.title ?? (c.server as { title?: string } | null)?.title ?? c.entity_id}
              {c.fields.length ? ` · fields: ${c.fields.join(", ")}` : ""}
            </span>
            <span className="small faint">{fmtDate(c.created_at, true)}</span>
            <button className="btn sm" onClick={() => setOpen(c)}>Review</button>
          </div>
        ))}
      </div>

      {svc.outboxIssues && (
        <div className="card">
          <div className="card-head"><span className="icon-tile"><Icon name="alert" size={16} /></span><h2>Failed / rejected changes</h2></div>
          {issues.data?.length === 0 && <div className="empty small">No failed or rejected changes.</div>}
          {!!issues.data?.length && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Record</th><th>Status</th><th>Attempts</th><th>Error</th><th /></tr></thead>
                <tbody>
                  {issues.data.map((i) => (
                    <tr key={i.seq}>
                      <td className="small"><b>{i.entity}</b><div className="faint mono">{i.entity_id.slice(0, 8)}…</div></td>
                      <td><span className={`badge ${i.status === "rejected" ? "bad" : "warn"}`}>{i.status}</span></td>
                      <td>{i.attempts}</td>
                      <td className="small">{i.last_error}</td>
                      <td className="num">
                        <button className="btn sm" onClick={() => run(() => svc.retryOutbox!(i.seq), "Will retry")}>Retry</button>
                        {i.status === "rejected" && <button className="btn sm danger" onClick={() => run(() => svc.discardOutbox!(i.seq), "Local change discarded")}>Discard</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {open && <ConflictDialog c={open} onClose={() => setOpen(null)} />}
    </>
  );
}
