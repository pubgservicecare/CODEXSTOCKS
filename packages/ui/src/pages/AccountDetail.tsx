import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  availableLinkKinds,
  CURRENCIES,
  formatMoney,
  formatRate,
  maskCode,
  parseMoney,
  parseRate,
  PROVIDER_LABELS,
  SALE_CHANNELS,
  twoStepWarning,
  youtubeId,
  type AccountBundle,
  type Currency,
  type LoginLink,
  type Sale,
} from "@codex/shared";
import {
  Confirm,
  errMsg,
  Field,
  fmtDate,
  Loading,
  Modal,
  Money,
  SecretValue,
  StatusBadge,
  TxtView,
  todayIso,
  useAction,
  useApp,
  useLoad,
} from "../components";
import { draftToInput, emptyLink, LinkFields, linkToDraft, type LinkDraft } from "./LinkForm";
import { actorLabel, AuditDetails, EmptyState, Notice } from "../components";
import { Icon } from "../icons";
import { fallbackArt } from "../art";

type Tab = "overview" | "logins" | "codes" | "sales" | "history";

export function AccountDetail() {
  const { id } = useParams() as { id: string };
  const { svc } = useApp();
  const { data: b, error, loading, reload } = useLoad(() => svc.bundle(id), [id]);
  const [tab, setTab] = useState<Tab>("overview");
  if (!b) return error || !loading ? <Loading error={error ?? "Account not found"} /> : <Loading loading />;
  const tabs: [Tab, string, number | null][] = [
    ["overview", "Overview", null],
    ["logins", "Logins", b.links.length],
    ["codes", "Backup codes", b.backupSets.length],
    ["sales", "Sales", b.sales.length],
    ["history", "History", null],
  ];
  return (
    <>
      <Header b={b} reload={reload} />
      <div className="tabs" role="tablist">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l}
            {n !== null && <span className="n">{k === "logins" ? `${n}/4` : n}</span>}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview b={b} />}
      {tab === "logins" && <Logins b={b} />}
      {tab === "codes" && <Codes b={b} />}
      {tab === "sales" && <Sales b={b} />}
      {tab === "history" && <History id={b.account.id} />}
    </>
  );
}

function Header({ b, reload }: { b: AccountBundle; reload: () => void }) {
  const { svc } = useApp();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState<null | "delete" | "archive">(null);
  const a = b.account;
  const rev = svc.kind === "web" ? a.rev : undefined;
  const setStatus = (status: string) => run(() => svc.exec("setAccountStatus", { id: a.id, status, expected_rev: rev }), `Status: ${status}`);
  const margin = a.list_price_minor !== null && a.list_currency === a.purchase_currency ? a.list_price_minor - a.purchase_cost_minor : null;
  const unusedCodes = b.backupSets.reduce((n, s) => n + s.codes.filter((c) => c.state === "unused" && !c.deleted).length, 0);
  return (
    <>
      <div className="eyebrow"><Link to="/accounts"><Icon name="chevronLeft" size={14} /> Accounts</Link></div>
      <div className="detail-hero">
        <ImageBox b={b} />
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="row" style={{ gap: 8 }}>
            <StatusBadge status={a.status} />
            {a.published && a.status === "available" ? <span className="badge gold"><Icon name="globe" size={12} /> Live on website</span> : <span className="badge">Not on website</span>}
            {!b.links.length && <span className="badge bad"><Icon name="alert" size={12} /> No login link</span>}
          </div>
          <h1 style={{ margin: "14px 0 6px", fontSize: 26 }}>{a.title}</h1>
          <div className="price-xl">
            {a.list_price_minor === null ? <span className="faint" style={{ fontSize: 18, fontWeight: 550 }}>No sale price set</span> : <Money minor={a.list_price_minor} currency={a.list_currency} />}
          </div>
          <div className="facts">
            <div><small>Purchase cost</small><b><Money minor={a.purchase_cost_minor} currency={a.purchase_currency} /></b></div>
            <div><small>Margin at this price</small><b style={{ color: margin !== null && margin < 0 ? "var(--bad)" : margin ? "var(--ok)" : undefined }}>{margin === null ? <span className="faint">—</span> : <Money minor={margin} currency={a.purchase_currency} />}</b></div>
            <div><small>Logins · codes</small><b>{b.links.length}/4 · {unusedCodes} unused</b></div>
          </div>
          <div className="btn-group" style={{ marginTop: 20 }}>
            <Link className="btn primary" to={`/accounts/${a.id}/edit`}><Icon name="edit" size={15} /> Edit</Link>
            {a.status === "available" && (
              <button className="btn" disabled={busy} onClick={() => run(() => svc.exec("setPublished", { id: a.id, published: !a.published, expected_rev: rev }), a.published ? "Unpublished" : "Published on website")}>
                <Icon name="globe" size={15} /> {a.published ? "Unpublish" : "Publish"}
              </button>
            )}
            {a.status === "available" && <button className="btn" disabled={busy} onClick={() => setStatus("reserved")}><Icon name="tag" size={15} /> Reserve</button>}
            {(a.status === "reserved" || a.status === "archived") && <button className="btn" disabled={busy} onClick={() => setStatus("available")}>Make available</button>}
            {(a.status === "available" || a.status === "reserved") && <button className="btn ghost" disabled={busy} onClick={() => setConfirm("archive")}>Archive</button>}
            {!b.sales.length && <button className="btn ghost" style={{ color: "#ff8a8e" }} onClick={() => setConfirm("delete")}><Icon name="trash" size={15} /> Delete</button>}
          </div>
          <div className="small faint mono" style={{ marginTop: "auto", paddingTop: 16 }}>ID {a.id}</div>
        </div>
      </div>
      {confirm === "archive" && (
        <Confirm title="Archive account?" body="Archived accounts leave the inventory value and are hidden from the website. You can make it available again later." confirm="Archive" onClose={() => setConfirm(null)} onYes={async () => { await setStatus("archived"); reload(); }} />
      )}
      {confirm === "delete" && (
        <Confirm
          danger
          title="Delete account?"
          body="This removes the account, its login links, stored password and backup codes from all devices after sync. Use Archive to keep records."
          confirm="Delete permanently"
          onClose={() => setConfirm(null)}
          onYes={async () => {
            const ok = await run(() => svc.exec("deleteAccount", { id: a.id }), "Account deleted");
            if (ok !== undefined) nav("/accounts");
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ overview --------------------------- */

function ImageBox({ b }: { b: AccountBundle }) {
  const { svc, version } = useApp();
  const { busy, run } = useAction();
  const [local, setLocal] = useState<{ url: string; status: string; error: string | null } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    svc.localImage?.(b.account.id).then((l) => {
      url = l?.url ?? null;
      setLocal(l);
    });
    return () => void (url && URL.revokeObjectURL(url));
  }, [svc, b.account.id, b.account.image_url, version]);
  const src = local?.url ?? (b.account.image_url ? `${b.account.image_url}?tr=w-1200,fo-auto` : null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) run(async () => svc.setImage(b.account.id, new Uint8Array(await f.arrayBuffer())), svc.kind === "desktop" ? "Image saved locally; it uploads when online" : "Image uploaded");
  };
  return (
    <div>
      <div className="media-frame">
        <img src={src ?? fallbackArt(b.account.id)} alt={src ? `Photo of ${b.account.title}` : ""} style={src ? undefined : { opacity: 0.55 }} />
        {!src && <span className="art-chip"><Icon name="image" size={12} /> No account photo · decorative artwork</span>}
      </div>
      {local && local.status !== "uploaded" && (
        <Notice kind={local.status === "failed" ? "bad" : "warn"} className="small">
          {local.status === "failed" ? `Upload failed: ${local.error ?? "unknown error"}. It will retry automatically.` : "Waiting to upload (kept on this PC until ImageKit confirms)."}
        </Notice>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <label className="btn sm">
          <Icon name="upload" size={14} /> {src ? "Replace photo" : "Add photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} disabled={busy} />
        </label>
        {src && <button className="btn sm ghost" disabled={busy} onClick={() => run(() => svc.removeImage(b.account.id), "Image removed")}>Remove</button>}
        <span className="small faint">JPEG, PNG or WebP · max 8 MB</span>
      </div>
    </div>
  );
}

function Overview({ b }: { b: AccountBundle }) {
  const a = b.account;
  const yt = youtubeId(a.youtube_url);
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="card section-public">
        <div className="card-head">
          <h2>Public listing</h2>
          <span className="spacer" />
          <span className="scope public"><Icon name="globe" size={12} /> Shown on website</span>
        </div>
        <dl className="kv">
          <dt>Sale price</dt>
          <dd>{a.list_price_minor === null ? <span className="faint">Not set</span> : <Money minor={a.list_price_minor} currency={a.list_currency} />}</dd>
          <dt>YouTube</dt>
          <dd>{yt ? <a href={`https://www.youtube.com/watch?v=${yt}`} target="_blank" rel="noreferrer noopener">{a.youtube_url}</a> : <span className="faint">—</span>}</dd>
          <dt>Previous owner shown</dt>
          <dd>{a.show_old_owner_public && a.old_owner_name ? a.old_owner_name : <span className="faint">Hidden</span>}</dd>
        </dl>
        <h3 style={{ margin: "18px 0 8px" }}>Description · exactly as shown on the website</h3>
        {a.description_public ? <TxtView text={a.description_public} /> : <div className="faint">No description</div>}
      </div>
      <div className="card section-private">
        <div className="card-head">
          <h2>Private details</h2>
          <span className="spacer" />
          <span className="scope private"><Icon name="lock" size={12} /> Owner only</span>
        </div>
        <dl className="kv">
          <dt>Purchase cost</dt>
          <dd><Money minor={a.purchase_cost_minor} currency={a.purchase_currency} />{a.purchase_cost_minor === 0 && <span className="badge" style={{ marginLeft: 8 }}>Free</span>}</dd>
          <dt>Purchased</dt><dd>{fmtDate(a.purchased_at)}</dd>
          <dt>Purchase reference</dt><dd>{a.purchase_reference ?? <span className="faint">—</span>}</dd>
          <dt>Previous owner</dt><dd>{a.old_owner_name ?? <span className="faint">—</span>}</dd>
          <dt>Previous owner WhatsApp</dt><dd>{a.old_owner_whatsapp ?? <span className="faint">—</span>}</dd>
          <dt>Created</dt><dd>{fmtDate(a.created_at, true)}</dd>
          <dt>Updated</dt><dd>{fmtDate(a.updated_at, true)}</dd>
          <dt>Cloud revision</dt><dd>{a.rev || <span className="faint">not yet synced</span>}</dd>
        </dl>
        <h3 style={{ margin: "18px 0 8px" }}>Internal notes</h3>
        {a.internal_notes ? <TxtView text={a.internal_notes} /> : <div className="faint">—</div>}
      </div>
    </div>
  );
}

/* ------------------------------ logins ----------------------------- */

function unusedCodesFor(b: AccountBundle, link: LoginLink) {
  return b.backupSets
    .filter((s) => s.link_id === link.id || s.link_id === null)
    .reduce((n, s) => n + s.codes.filter((c) => c.state === "unused" && !c.deleted).length, 0);
}

function Logins({ b }: { b: AccountBundle }) {
  const { svc, requireVault } = useApp();
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<{ link: LoginLink | null; draft: LinkDraft } | null>(null);
  const [del, setDel] = useState<LoginLink | null>(null);
  const [pw, setPw] = useState<string | null>(null);
  const allowed = availableLinkKinds(b.links);
  const needsPw = b.links.some((l) => l.kind !== "social");
  return (
    <>
      <div className="card section-private">
        <div className="card-head">
          <span className="icon-tile gold"><Icon name="link" size={16} /></span>
          <h2>Login links</h2>
          <span className="muted small">Max 2 social · 1 phone · 1 email</span>
          <span className="spacer" />
          <span className="scope private"><Icon name="lock" size={12} /> Owner only</span>
          <button className="btn sm" disabled={!allowed.length} onClick={() => setEdit({ link: null, draft: emptyLink(allowed[0]) })}><Icon name="plus" size={14} /> Add link</button>
        </div>
        {!b.links.length && <Notice kind="bad">This account has no login link. Add at least one before publishing.</Notice>}
        <div className="grid grid-2">
          {b.links.map((l) => {
            const warn = twoStepWarning(l, unusedCodesFor(b, l));
            return (
              <div key={l.id} className="link-card">
                <div className="card-head">
                  <span className="icon-tile"><Icon name={l.kind === "phone" ? "phone" : l.kind === "email" ? "mail" : "user"} size={15} /></span>
                  <b>{l.kind === "social" ? `${PROVIDER_LABELS[l.provider ?? "other"]} · social` : l.kind === "phone" ? "Phone login" : "Email login"}</b>
                  <span className={`badge ${l.status === "active" ? "ok" : l.status === "lost" ? "bad" : ""}`}>{l.status}</span>
                  <span className="spacer" />
                  <button className="btn ghost sm icon-only" title="Edit link" aria-label="Edit link" onClick={() => setEdit({ link: l, draft: linkToDraft(l) })}><Icon name="edit" size={14} /></button>
                  <button className="btn ghost sm icon-only" title="Delete link" aria-label="Delete link" onClick={() => setDel(l)}><Icon name="trash" size={14} /></button>
                </div>
                {warn && <Notice kind="warn" className="small">{warn}</Notice>}
                <dl className="kv small">
                  <dt>{l.kind === "social" ? "Linked account" : l.kind === "phone" ? "Number" : "Email"}</dt><dd>{l.identifier ?? "—"}</dd>
                  <dt>Display name</dt><dd>{l.display_name ?? "—"}</dd>
                  <dt>Owner</dt><dd>{l.owner_name ?? "—"}</dd>
                  <dt>Owner contact</dt><dd>{l.owner_contact ?? "—"}</dd>
                  {l.owner_notes && (<><dt>Owner notes</dt><dd>{l.owner_notes}</dd></>)}
                  <dt>2-Step</dt>
                  <dd>
                    {l.two_step_enabled ? `On · ${l.two_step_method}${l.two_step_destination ? ` → ${l.two_step_destination}` : ""}` : "Off"}
                    {l.two_step_enabled && l.two_step_accessible !== null && <> · {l.two_step_accessible ? "accessible" : <b style={{ color: "var(--bad)" }}>not accessible</b>}</>}
                  </dd>
                  {l.recovery_info && (<><dt>Recovery</dt><dd>{l.recovery_info}</dd></>)}
                  {l.kind !== "social" && (<><dt>Password</dt><dd>{l.credential_id ? "Shared phone/email password" : <span className="faint">Not recorded</span>}</dd></>)}
                </dl>
              </div>
            );
          })}
        </div>
      </div>

      {needsPw && (
        <div className="card section-private">
          <div className="card-head">
            <span className="icon-tile gold"><Icon name="key" size={16} /></span>
            <h2>Shared phone / email password</h2>
            <span className="spacer" />
            <button className="btn sm" onClick={async () => (await requireVault()) && setPw("")}>{b.credential ? "Change password" : "Record password"}</button>
          </div>
          <p className="muted small">
            The phone and email logins use ONE shared password, stored once (encrypted with your vault key) and referenced by both links.
          </p>
          {b.credential ? (
            <div className="row">
              <SecretValue reveal={() => svc.revealCredential(b.credential!)} />
              <span className="small faint">Last changed {fmtDate(b.credential.secret_updated_at, true)}</span>
            </div>
          ) : (
            <div className="faint">No password recorded.</div>
          )}
        </div>
      )}

      {edit && (
        <Modal wide title={edit.link ? "Edit login link" : "Add login link"} onClose={() => setEdit(null)}>
          <LinkFields
            d={edit.draft}
            set={(draft) => setEdit({ ...edit, draft })}
            allowedKinds={edit.link ? [edit.link.kind] : allowed}
            kindLocked={!!edit.link}
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                const ok = await run(
                  () =>
                    svc.exec("saveLink", {
                      id: edit.link?.id,
                      account_id: b.account.id,
                      expected_rev: svc.kind === "web" ? edit.link?.rev : undefined,
                      link: draftToInput(edit.draft),
                    }),
                  "Login link saved",
                );
                if (ok !== undefined) setEdit(null);
              }}
            >
              Save link
            </button>
          </div>
        </Modal>
      )}
      {del && (
        <Confirm danger title="Delete login link?" body="Its owner details are removed. The shared password stays on the account." confirm="Delete" onClose={() => setDel(null)} onYes={() => run(() => svc.exec("deleteLink", { id: del.id }), "Link deleted").then(() => undefined)} />
      )}
      {pw !== null && (
        <Modal title={b.credential ? "Change shared password" : "Record shared password"} onClose={() => setPw(null)}>
          <p className="muted small">Record the password exactly as set with the provider. This app never resets or changes third-party passwords.</p>
          <Field label="Password">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" />
          </Field>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setPw(null)}>Cancel</button>
            <button
              className="btn primary"
              disabled={!pw || busy}
              onClick={async () => {
                const ok = await run(() => svc.saveSharedPassword(b.account.id, pw), "Password encrypted and saved");
                if (ok !== undefined) setPw(null);
              }}
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ---------------------------- backup codes ------------------------- */

function Codes({ b }: { b: AccountBundle }) {
  const { svc, requireVault } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState<{ label: string; linkId: string; codes: string[] } | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    if (await requireVault()) setForm({ label: "", linkId: "", codes: Array(10).fill("") });
  };
  const paste = (text: string) => {
    const found = text.match(/\d[\d\s-]{6,}\d/g)?.map((x) => x.replace(/[\s-]/g, "")).filter((x) => x.length === 8) ?? [];
    if (form && found.length) setForm({ ...form, codes: [...found, ...Array(10).fill("")].slice(0, Math.max(10, found.length)) });
  };
  return (
    <div className="card section-private">
      <div className="card-head">
        <span className="icon-tile gold"><Icon name="shieldCheck" size={16} /></span>
        <h2>Backup codes</h2>
        <span className="spacer" />
        <span className="scope private"><Icon name="lock" size={12} /> Encrypted</span>
        <button className="btn sm" onClick={open}><Icon name="plus" size={14} /> Record code set</button>
      </div>
      <p className="muted small">
        Record only codes generated by the provider. Codes are encrypted, masked by default and never shown as available once used.
      </p>
      {!b.backupSets.length && <EmptyState icon="shieldCheck" title="No backup codes recorded" body="Record provider-generated codes here. They're encrypted with your vault key and masked until you reveal them." />}
      {b.backupSets.map((s) => {
        const link = b.links.find((l) => l.id === s.link_id);
        const unused = s.codes.filter((c) => c.state === "unused").length;
        return (
          <div key={s.id} className="link-card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <b>{s.label || "Backup codes"}</b>
              <span className="small muted">{link ? `for ${link.kind} login${link.identifier ? ` (${link.identifier})` : ""}` : s.link_id ? "for a removed link" : "general"}</span>
              <span className={`badge ${unused ? "ok" : "bad"}`}>{unused} unused</span>
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => setDel(s.id)}>Delete set</button>
            </div>
            <div className="codes">
              {s.codes.map((c) => (
                <div key={c.id} className={`code ${c.state}`}>
                  <span className="small faint">#{c.position}</span>
                  {c.state === "unused" ? <SecretValue reveal={() => svc.revealBackupCode(c)} mask={maskCode("00000000")} /> : <span title={c.used_at ? `Used ${fmtDate(c.used_at, true)}` : undefined}>{c.state}</span>}
                  {c.state === "unused" && (
                    <span className="row" style={{ gap: 2 }}>
                      <button className="btn ghost sm" title="Mark as used" disabled={busy} onClick={() => run(() => svc.exec("setBackupCodeState", { id: c.id, state: "used" }), `Code #${c.position} marked used`)}>Used</button>
                      <button className="btn ghost sm" title="Revoke" disabled={busy} onClick={() => run(() => svc.exec("setBackupCodeState", { id: c.id, state: "revoked" }), `Code #${c.position} revoked`)}>✕</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {form && (
        <Modal wide title="Record backup-code set" onClose={() => setForm(null)}>
          <div className="form-grid">
            <Field label="Label"><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Google account codes" /></Field>
            <Field label="Verification context">
              <select value={form.linkId} onChange={(e) => setForm({ ...form, linkId: e.target.value })}>
                <option value="">General / whole account</option>
                {b.links.map((l) => <option key={l.id} value={l.id}>{l.kind} · {l.identifier ?? l.provider}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Paste codes (optional)" hint="Paste the provider's list; 8-digit codes are extracted automatically.">
            <textarea rows={2} onChange={(e) => paste(e.target.value)} />
          </Field>
          <div className="codes">
            {form.codes.map((c, i) => (
              <input
                key={i}
                className="mono"
                inputMode="numeric"
                maxLength={9}
                placeholder={`Code ${i + 1}`}
                value={c}
                onChange={(e) => setForm({ ...form, codes: form.codes.map((x, j) => (j === i ? e.target.value.replace(/[^\d]/g, "") : x)) })}
              />
            ))}
          </div>
          {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setErr(null);
                try {
                  await svc.recordBackupCodes({ accountId: b.account.id, linkId: form.linkId || null, label: form.label, codes: form.codes.filter((x) => x !== "") });
                  setForm(null);
                } catch (e) {
                  setErr(errMsg(e));
                }
              }}
            >
              Encrypt & save
            </button>
          </div>
        </Modal>
      )}
      {del && <Confirm danger title="Delete backup-code set?" body="All codes in this set are removed." confirm="Delete" onClose={() => setDel(null)} onYes={() => run(() => svc.exec("deleteBackupSet", { id: del }), "Set deleted").then(() => undefined)} />}
    </div>
  );
}

/* ------------------------------- sales ----------------------------- */

export function SaleForm({ b, onClose }: { b: AccountBundle; onClose: () => void }) {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const a = b.account;
  const [f, setF] = useState({
    amount: a.list_price_minor !== null ? String(a.list_price_minor / 100) : "",
    currency: (a.list_currency ?? a.purchase_currency) as Currency,
    rate: "",
    date: todayIso(),
    channel: "whatsapp",
    buyer_name: "",
    buyer_contact: "",
    reference: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const cross = f.currency !== a.purchase_currency;
  const save = async () => {
    setErr(null);
    try {
      const args = {
        account_id: a.id,
        sold_at: new Date(f.date + "T12:00:00").toISOString(),
        amount_minor: parseMoney(f.amount, f.currency),
        currency: f.currency,
        exchange_rate_micro: cross ? parseRate(f.rate) : null,
        channel: f.channel,
        buyer_name: f.buyer_name || null,
        buyer_contact: f.buyer_contact || null,
        reference: f.reference || null,
        notes: f.notes || null,
      };
      const ok = await run(() => svc.exec("recordSale", args), "Sale recorded · account marked sold");
      if (ok !== undefined) onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Modal title="Record sale" onClose={onClose}>
      <div className="form-grid">
        <Field label="Amount received *"><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Currency *">
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        {cross && (
          <Field className="full" label={`Exchange rate * (${f.currency} per 1 ${a.purchase_currency})`} hint={`Purchase was ${formatMoney(a.purchase_cost_minor, a.purchase_currency)}. The rate converts its cost into ${f.currency} for profit.`}>
            <input value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} inputMode="decimal" placeholder={a.purchase_currency === "USD" ? "e.g. 280" : "e.g. 0.00357"} />
          </Field>
        )}
        <Field label="Sale date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Channel">
          <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{SALE_CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Buyer name"><input value={f.buyer_name} onChange={(e) => setF({ ...f, buyer_name: e.target.value })} /></Field>
        <Field label="Buyer contact"><input value={f.buyer_contact} onChange={(e) => setF({ ...f, buyer_contact: e.target.value })} /></Field>
        <Field label="Sale reference" className="full"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Notes" className="full"><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {err && <div className="notice bad">{err}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Record sale</button>
      </div>
    </Modal>
  );
}

export function RefundForm({ sale, refunded, onClose }: { sale: Sale; refunded: number; onClose: () => void }) {
  const { svc } = useApp();
  const { busy, run } = useAction();
  const remaining = sale.amount_minor - refunded;
  const [f, setF] = useState({ amount: String(remaining / 100), reason: "", restock: false, date: todayIso() });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Record refund" onClose={onClose}>
      <p className="muted small">Refunds are recorded in the sale currency ({sale.currency}). Remaining refundable: {formatMoney(remaining, sale.currency)}.</p>
      <div className="form-grid">
        <Field label={`Amount (${sale.currency}) *`}><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Reason" className="full"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={f.restock} onChange={(e) => setF({ ...f, restock: e.target.checked })} />
        Account returned to me — put it back in inventory (requires refunding the full remaining amount)
      </label>
      {err && <div className="notice bad">{err}</div>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setErr(null);
            try {
              const args = { sale_id: sale.id, refunded_at: new Date(f.date + "T12:00:00").toISOString(), amount_minor: parseMoney(f.amount, sale.currency), reason: f.reason || null, restock: f.restock };
              const ok = await run(() => svc.exec("recordRefund", args), "Refund recorded");
              if (ok !== undefined) onClose();
            } catch (e) {
              setErr(errMsg(e));
            }
          }}
        >
          Record refund
        </button>
      </div>
    </Modal>
  );
}

function Sales({ b }: { b: AccountBundle }) {
  const { svc } = useApp();
  const { run } = useAction();
  const [sell, setSell] = useState(false);
  const [refund, setRefund] = useState<Sale | null>(null);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const canSell = b.account.status === "available" || b.account.status === "reserved";
  return (
    <div className="card">
      <div className="card-head">
        <span className="icon-tile gold"><Icon name="sales" size={16} /></span>
        <h2>Sales & refunds</h2>
        <span className="spacer" />
        {canSell && <button className="btn primary sm" onClick={() => setSell(true)}><Icon name="plus" size={14} /> Record sale</button>}
      </div>
      {!b.sales.length && <EmptyState icon="sales" title="Not sold yet" body={canSell ? "When a buyer pays, record the sale here. The account is marked sold everywhere." : "This account has no sales."} />}
      {b.sales.map((s) => {
        const refunds = b.refunds.filter((r) => r.sale_id === s.id);
        const refunded = refunds.reduce((a, r) => a + r.amount_minor, 0);
        return (
          <div key={s.id} className="link-card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <b style={{ fontSize: 16 }}><Money minor={s.amount_minor} currency={s.currency} /></b>
              <span className={`badge ${s.status === "completed" ? "ok" : s.status === "voided" ? "" : "warn"}`}>{s.status}</span>
              <span className="small muted">{fmtDate(s.sold_at)} · {s.channel}</span>
              <span className="spacer" />
              {s.status === "completed" && refunded < s.amount_minor && <button className="btn sm" onClick={() => setRefund(s)}>Refund</button>}
              {s.status === "completed" && !refunds.length && <button className="btn sm danger" onClick={() => setVoiding(s)}>Void</button>}
            </div>
            <dl className="kv small">
              {s.exchange_rate_micro && (<><dt>Exchange rate</dt><dd>{formatRate(s.exchange_rate_micro)} {s.currency} per 1 {b.account.purchase_currency}</dd></>)}
              <dt>Buyer</dt><dd>{[s.buyer_name, s.buyer_contact].filter(Boolean).join(" · ") || "—"}</dd>
              <dt>Reference</dt><dd>{s.reference ?? "—"}</dd>
              {s.notes && (<><dt>Notes</dt><dd>{s.notes}</dd></>)}
            </dl>
            {refunds.map((r) => (
              <div key={r.id} className="notice warn small" style={{ marginTop: 8, marginBottom: 0 }}>
                Refund <b><Money minor={r.amount_minor} currency={r.currency} /></b> on {fmtDate(r.refunded_at)}{r.restock ? " · account returned to inventory" : ""}{r.reason ? ` · ${r.reason}` : ""}
              </div>
            ))}
          </div>
        );
      })}
      {sell && <SaleForm b={b} onClose={() => setSell(false)} />}
      {refund && <RefundForm sale={refund} refunded={b.refunds.filter((r) => r.sale_id === refund.id).reduce((a, r) => a + r.amount_minor, 0)} onClose={() => setRefund(null)} />}
      {voiding && (
        <Confirm danger title="Void this sale?" body="Use this only for a sale recorded by mistake. The account becomes available again. The void is kept in the audit history." confirm="Void sale" onClose={() => setVoiding(null)} onYes={() => run(() => svc.exec("voidSale", { id: voiding.id, reason: "Voided by owner" }), "Sale voided").then(() => undefined)} />
      )}
    </div>
  );
}

/* ------------------------------ history ---------------------------- */

function History({ id }: { id: string }) {
  const { svc } = useApp();
  const { data, error, loading } = useLoad(() => svc.audit(id), [id]);
  return (
    <div className="card">
      <div className="card-head"><h2>Audit history</h2></div>
      <Loading error={error} loading={loading && !data} />
      {data && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Details</th><th>By</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td className="small">{fmtDate(e.at, true)}</td>
                  <td><code>{e.action}</code></td>
                  <td><AuditDetails details={e.details} /></td>
                  <td className="small muted" title={e.actor}>{actorLabel(e.actor)}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={4} className="empty">No history.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
