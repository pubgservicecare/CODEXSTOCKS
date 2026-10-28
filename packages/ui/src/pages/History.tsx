import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { Link } from "react-router-dom";
import { actorLabel, AuditDetails, EmptyState, fmtDate, Loading, useApp, useLoad } from "../components";
import { actionIcon, humanAction } from "./Dashboard";

/** Global audit history (all financial and inventory changes, from every device and the website). */
export function HistoryPage() {
  const { svc } = useApp();
  const { data, error, loading } = useLoad(async () => {
    const [events, accounts] = await Promise.all([svc.audit(), svc.listAccounts()]);
    return { events, titles: new Map(accounts.map((a) => [a.id, a.title])) };
  }, []);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const rows = useMemo(
    () =>
      (data?.events ?? []).filter(
        (e) =>
          (kind === "all" || e.action.startsWith(kind)) &&
          (!q || `${e.action} ${e.details} ${e.actor}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data, q, kind],
  );
  const accountOf = (e: { entity_type: string; entity_id: string; details: string }) => {
    if (e.entity_type === "accounts") return e.entity_id;
    try {
      return (JSON.parse(e.details) as { account_id?: string }).account_id ?? null;
    } catch {
      return null;
    }
  };
  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>History</h1>
          <p>Append-only audit trail of inventory and financial changes from every device and the admin website (newest 500).</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input placeholder="Search actions, details, device…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" /></div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 180 }} aria-label="Event type">
          <option value="all">All events</option>
          <option value="account.">Accounts</option>
          <option value="link.">Login links</option>
          <option value="password.">Passwords</option>
          <option value="backup_code">Backup codes</option>
          <option value="sale.">Sales</option>
          <option value="refund.">Refunds</option>
          <option value="expense.">Expenses</option>
        </select>
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Account</th><th>Details</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const acc = accountOf(e);
                return (
                  <tr key={e.id}>
                    <td className="small">{fmtDate(e.at, true)}</td>
                    <td><span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><span className="icon-tile" style={{ width: 28, height: 28 }}><Icon name={actionIcon(e.action)} size={14} /></span><span><b style={{ fontWeight: 580 }}>{humanAction(e.action)}</b><br /><code className="faint small">{e.action}</code></span></span></td>
                    <td className="small">{acc ? <Link to={`/accounts/${acc}`}>{data.titles.get(acc) ?? "(deleted)"}</Link> : "—"}</td>
                    <td><AuditDetails details={e.details} /></td>
                    <td className="small muted" title={e.actor}>{actorLabel(e.actor)}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5}><EmptyState icon="history" title="No events" body={q || kind !== "all" ? "Nothing matches this search." : "Changes from every device and the website will be listed here."} /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
