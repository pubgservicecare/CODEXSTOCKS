import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { Link } from "react-router-dom";
import { formatRate } from "@codex/shared";
import { formatMoney, CURRENCIES } from "@codex/shared";
import { EmptyState, fmtDate, Loading, Money, useApp, useLoad } from "../components";

export function SalesPage() {
  const { svc } = useApp();
  const { data, error, loading } = useLoad(
    async () => {
      const [sales, refunds, accounts] = await Promise.all([svc.list("sales"), svc.list("refunds"), svc.listAccounts()]);
      return { sales, refunds, accounts: new Map(accounts.map((a) => [a.id, a])) };
    },
    [],
  );
  const [cur, setCur] = useState("all");
  const [st, setSt] = useState("all");
  const rows = useMemo(
    () =>
      (data?.sales ?? [])
        .filter((s) => (cur === "all" || s.currency === cur) && (st === "all" || s.status === st))
        .sort((a, b) => b.sold_at.localeCompare(a.sold_at)),
    [data, cur, st],
  );
  return (
    <>
      <div className="cx-page-head">
        <div>
          <h1>Sales & refunds</h1>
          <p>Record sales from an account's page. Sales made through website enquiries are recorded here by you, the owner.</p>
        </div>
      </div>
      {data && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          {CURRENCIES.map((c) => {
            const list = data.sales.filter((s) => s.currency === c && s.status !== "voided");
            const refunded = data.refunds.filter((r) => r.currency === c).reduce((a, r) => a + r.amount_minor, 0);
            return [
              <div className="stat" key={c + "s"}><div className="label"><span className="ccy">{c}</span> Sales received</div><div className="value sm" style={{ fontSize: 22 }}>{formatMoney(list.reduce((a, s) => a + s.amount_minor, 0), c)}</div><div className="sub">{list.length} sale{list.length === 1 ? "" : "s"}</div></div>,
              <div className="stat" key={c + "r"}><div className="label"><span className="ccy">{c}</span> Refunded</div><div className="value sm" style={{ fontSize: 22, color: refunded ? "var(--bad)" : undefined }}>{formatMoney(refunded, c)}</div><div className="sub">{data.refunds.filter((r) => r.currency === c).length} refund(s)</div></div>,
            ];
          })}
        </div>
      )}
      <div className="toolbar">
        <select value={cur} onChange={(e) => setCur(e.target.value)} style={{ width: 140 }} aria-label="Currency"><option value="all">All currencies</option><option>USD</option><option>PKR</option></select>
        <select value={st} onChange={(e) => setSt(e.target.value)} style={{ width: 160 }} aria-label="Status"><option value="all">All statuses</option><option value="completed">Completed</option><option value="refunded">Refunded (restocked)</option><option value="voided">Voided</option></select>
      </div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Account</th><th>Status</th><th>Channel</th><th className="num">Amount</th><th className="num">Refunded</th><th>Rate</th><th>Buyer</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const refunded = data.refunds.filter((r) => r.sale_id === s.id).reduce((a, r) => a + r.amount_minor, 0);
                const acct = data.accounts.get(s.account_id);
                return (
                  <tr key={s.id}>
                    <td className="small">{fmtDate(s.sold_at)}</td>
                    <td><Link to={`/accounts/${s.account_id}`}>{acct?.title ?? "(deleted account)"}</Link></td>
                    <td><span className={`badge ${s.status === "completed" ? "ok" : s.status === "voided" ? "" : "warn"}`}>{s.status}</span></td>
                    <td className="small">{s.channel}</td>
                    <td className="num"><b><Money minor={s.amount_minor} currency={s.currency} /></b></td>
                    <td className="num">{refunded ? <Money minor={refunded} currency={s.currency} /> : <span className="faint">—</span>}</td>
                    <td className="small muted">{s.exchange_rate_micro ? formatRate(s.exchange_rate_micro) : "—"}</td>
                    <td className="small">{s.buyer_name ?? "—"}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={8}><EmptyState icon="sales" title="No sales yet" body="Record a sale from an account's page when a buyer pays. It appears here with refunds." /></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
