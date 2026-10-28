import { useState } from "react";
import { Icon } from "../icons";
import { Confirm, EmptyState, fmtDate, Loading, useAction, useApp, useLoad } from "../components";

export function DevicesPage() {
  const { svc } = useApp();
  const { run } = useAction();
  const { data, error, loading, reload } = useLoad(() => svc.devices(), []);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Devices</h1>
          <p>PCs enrolled to sync your inventory. Revoking a device immediately blocks its cloud access (its local copy stays on that PC).</p>
        </div>
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Platform</th><th>Enrolled</th><th>Last seen</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td><span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><span className="icon-tile"><Icon name="devices" size={15} /></span><b>{d.name}</b>{d.current && <span className="badge gold">This device</span>}</span></td>
                  <td>{d.platform}</td>
                  <td className="small">{fmtDate(d.created_at, true)}</td>
                  <td className="small">{fmtDate(d.last_seen_at, true)}</td>
                  <td>{d.revoked_at ? <span className="badge bad">Revoked</span> : <span className="badge ok">Active</span>}</td>
                  <td className="num">{!d.revoked_at && <button className="btn sm danger" onClick={() => setRevoke(d)}>Revoke</button>}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={6}><EmptyState icon="devices" title="No devices enrolled yet" body="PCs appear here after they connect to the cloud." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {revoke && (
        <Confirm
          danger
          title={`Revoke "${revoke.name}"?`}
          body="The device can no longer sync. To use it again, sign in on it online with the owner password."
          confirm="Revoke"
          onClose={() => setRevoke(null)}
          onYes={async () => {
            await run(() => svc.revokeDevice(revoke.id), "Device revoked");
            reload();
          }}
        />
      )}
    </>
  );
}
