import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  availableLinkKinds,
  CURRENCIES,
  minorToDecimalString,
  newId,
  parseMoney,
  snapshotFromQuote,
  youtubeId,
  type Account,
  type FxQuote,
  type AccountInput,
  type Currency,
} from "@codex/shared";
import { errMsg, Field, Loading, Notice, TxtView, useApp } from "../components";
import { Icon } from "../icons";
import { draftToInput, emptyLink, LinkFields, type LinkDraft } from "./LinkForm";
import { ImagePicker, type PickedImage } from "../ImagePicker";
import { FxPreview, useFx } from "../fx-ui";

interface Draft {
  title: string;
  purchase_cost: string;
  purchase_currency: Currency;
  purchased_at: string;
  purchase_reference: string;
  list_price: string;
  list_currency: Currency;
  description_public: string;
  youtube_url: string;
  old_owner_name: string;
  old_owner_whatsapp: string;
  show_old_owner_public: boolean;
  internal_notes: string;
}

const EMPTY: Draft = {
  title: "", purchase_cost: "", purchase_currency: "PKR", purchased_at: "", purchase_reference: "", list_price: "",
  list_currency: "PKR", description_public: "", youtube_url: "", old_owner_name: "", old_owner_whatsapp: "",
  show_old_owner_public: false, internal_notes: "",
};

function fromAccount(a: Account): Draft {
  return {
    title: a.title,
    purchase_cost: minorToDecimalString(a.purchase_cost_minor, a.purchase_currency),
    purchase_currency: a.purchase_currency,
    purchased_at: a.purchased_at ?? "",
    purchase_reference: a.purchase_reference ?? "",
    list_price: a.list_price_minor === null ? "" : minorToDecimalString(a.list_price_minor, a.list_currency ?? "PKR"),
    list_currency: a.list_currency ?? a.purchase_currency,
    description_public: a.description_public,
    youtube_url: a.youtube_url ?? "",
    old_owner_name: a.old_owner_name ?? "",
    old_owner_whatsapp: a.old_owner_whatsapp ?? "",
    show_old_owner_public: a.show_old_owner_public,
    internal_notes: a.internal_notes,
  };
}

function toInput(d: Draft): AccountInput {
  if (!d.title.trim()) throw new Error("Title is required");
  if (d.purchase_cost.trim() === "") throw new Error("Purchase cost is required (enter 0 for a genuinely free account)");
  const nz = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    title: d.title.trim(),
    purchase_cost_minor: parseMoney(d.purchase_cost, d.purchase_currency),
    purchase_currency: d.purchase_currency,
    purchased_at: nz(d.purchased_at),
    purchase_reference: nz(d.purchase_reference),
    list_price_minor: d.list_price.trim() === "" ? null : parseMoney(d.list_price, d.list_currency),
    list_currency: d.list_price.trim() === "" ? null : d.list_currency,
    // TXT description is stored exactly as typed: never trimmed or collapsed.
    description_public: d.description_public,
    youtube_url: nz(d.youtube_url),
    old_owner_name: nz(d.old_owner_name),
    old_owner_whatsapp: nz(d.old_owner_whatsapp),
    show_old_owner_public: d.show_old_owner_public,
    internal_notes: d.internal_notes,
  };
}

function safeMinor(v: string, c: Currency): number | null {
  try {
    return parseMoney(v, c);
  } catch {
    return null;
  }
}

/**
 * Exchange-rate snapshot for the purchase. Only USD purchases need one (PKR is the reporting currency).
 * A snapshot already recorded for the same USD amount is kept; a new or changed USD purchase records
 * the current reference rate. Never rewritten later by newer rates.
 */
export function purchaseFx(input: AccountInput, orig: Account | null, quote: FxQuote | null): Pick<AccountInput, "purchase_fx_micro" | "purchase_fx_source" | "purchase_fx_at"> {
  const none = { purchase_fx_micro: null, purchase_fx_source: null, purchase_fx_at: null };
  if (input.purchase_currency !== "USD") return none;
  if (orig?.purchase_fx_micro && orig.purchase_currency === "USD" && orig.purchase_cost_minor === input.purchase_cost_minor)
    return { purchase_fx_micro: orig.purchase_fx_micro, purchase_fx_source: orig.purchase_fx_source, purchase_fx_at: orig.purchase_fx_at };
  if (!quote) return orig?.purchase_fx_micro && orig.purchase_currency === "USD" ? { purchase_fx_micro: orig.purchase_fx_micro, purchase_fx_source: orig.purchase_fx_source, purchase_fx_at: orig.purchase_fx_at } : none;
  const snap = snapshotFromQuote(quote);
  return { purchase_fx_micro: snap.usd_pkr_micro, purchase_fx_source: snap.source, purchase_fx_at: snap.at };
}

/** Let the Tab key insert a real tab character in TXT fields (for ASCII layouts). */
export function tabKey(e: KeyboardEvent<HTMLTextAreaElement>, set: (v: string) => void) {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  const t = e.currentTarget;
  const { selectionStart: s, selectionEnd: en, value } = t;
  set(value.slice(0, s) + "\t" + value.slice(en));
  requestAnimationFrame(() => t.setSelectionRange(s + 1, s + 1));
}

export function AccountForm() {
  const { id } = useParams();
  const editing = !!id;
  const { svc, toast, requireVault } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<Draft>(EMPTY);
  const [rev, setRev] = useState<number | undefined>();
  const [links, setLinks] = useState<LinkDraft[]>([emptyLink("email")]);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [image, setImage] = useState<PickedImage | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [orig, setOrig] = useState<Account | null>(null);
  const { quote } = useFx();
  const [removeImage, setRemoveImage] = useState(false);
  /** Set once the account itself is saved; the photo step can then be retried without saving again. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "saving" | "image" | "image_failed">("idle");

  useEffect(() => {
    if (!id) return;
    svc.bundle(id).then((b) => {
      if (b) {
        setD(fromAccount(b.account));
        setRev(b.account.rev);
        setExistingImage(b.account.image_url);
        setOrig(b.account);
      }
      setLoaded(true);
    });
  }, [id, svc]);

  const failRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage === "image_failed") failRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [stage]);

  const imageDoneMsg = svc.kind === "desktop" ? "Photo saved on this PC · it uploads automatically when online" : "Photo uploaded";

  /** Attach the chosen photo (or remove the old one) after the account is saved. Never re-saves the account. */
  const applyImage = async (accountId: string): Promise<boolean> => {
    if (!image && !(editing && removeImage)) return true;
    setStage("image");
    try {
      if (image) await svc.setImage(accountId, image.bytes);
      else await svc.removeImage(accountId);
      return true;
    } catch (err) {
      setStage("image_failed");
      setError(
        `${editing ? "Changes saved" : "Account created"}, but the photo was not ${image ? "uploaded" : "removed"}: ${errMsg(err)}. ` +
          "Retry now, or continue and change the photo later from the account page.",
      );
      return false;
    }
  };

  const retryImage = async () => {
    if (!savedId) return;
    setError(null);
    setBusy(true);
    try {
      if (await applyImage(savedId)) {
        toast(image ? imageDoneMsg : "Photo removed");
        nav(`/accounts/${savedId}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const up = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const needsPassword = links.some((l) => l.kind !== "social");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || savedId) return; // never submit twice
    setError(null);
    setBusy(true);
    setStage("saving");
    try {
      const account = { ...toInput(d), ...purchaseFx(toInput(d), orig, quote) };
      if (editing) {
        await svc.exec("updateAccount", { id, expected_rev: svc.kind === "web" ? rev : undefined, account });
        setSavedId(id!);
        if (!(await applyImage(id!))) return;
        toast(image ? `Account saved · ${imageDoneMsg}` : removeImage ? "Account saved · photo removed" : "Account saved");
        nav(`/accounts/${id}`);
      } else {
        if (password && needsPassword && !(await requireVault()))
          throw new Error("Unlock the vault to store the password, or leave the password empty for now");
        const newAccountId = newId();
        await svc.exec("createAccount", { id: newAccountId, account, links: links.map(draftToInput) });
        setSavedId(newAccountId);
        if (password && needsPassword) {
          try {
            await svc.saveSharedPassword(newAccountId, password);
          } catch (err) {
            toast(`Account saved, but the password was not stored: ${errMsg(err)}`, "bad");
          }
        }
        if (!(await applyImage(newAccountId))) return;
        toast(image ? `Account created · ${imageDoneMsg}` : "Account created");
        nav(`/accounts/${newAccountId}`);
      }
    } catch (err) {
      setStage("idle");
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Loading loading />;
  const yt = d.youtube_url && !youtubeId(d.youtube_url);

  return (
    <form onSubmit={save}>
      <div className="eyebrow">
        <button type="button" className="btn ghost sm" style={{ marginLeft: -10 }} onClick={() => nav(-1)}><Icon name="chevronLeft" size={14} /> Back</button>
      </div>
      <div className="cx-page-head">
        <div>
          <h1>{editing ? "Edit account" : "New PUBG Mobile account"}</h1>
          <p>Fields marked <span style={{ color: "var(--accent)" }}>*</span> are required. Purchase cost may be 0 for a genuinely free account.</p>
        </div>
      </div>
      {error && stage !== "image_failed" && <Notice kind="bad">{error}</Notice>}

      <div className="card">
      <section className="form-section">
        <header>
          <h2>Public listing</h2>
          <p>What buyers see on codexstocks.org once you publish the account.</p>
          <span className="scope public"><Icon name="globe" size={12} /> Website</span>
        </header>
        <div className="form-grid">
          <Field label="Title *" className="full">
            <input value={d.title} onChange={(e) => up({ title: e.target.value })} maxLength={200} required />
          </Field>
          <div className="field full">
            <span>Account photo<span className="opt">Optional</span></span>
            <ImagePicker
              picked={image}
              onPick={setImage}
              existingUrl={editing ? existingImage : null}
              existingRemoved={removeImage}
              onRemoveExisting={editing ? setRemoveImage : undefined}
              disabled={busy || !!savedId}
            />
          </div>
          <Field label="Sale price" optional hint="Leave empty if not decided yet. This amount and currency are the listing price; the other currency is only shown as an equivalent.">
            <input value={d.list_price} onChange={(e) => up({ list_price: e.target.value })} inputMode="decimal" placeholder="e.g. 25000" />
          </Field>
          <Field label="Sale currency">
            <select value={d.list_currency} onChange={(e) => up({ list_currency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="full"><FxPreview amount={d.list_price} currency={d.list_currency} label="Listing price" /></div>
          <Field
            label="Public description (plain TXT)"
            className="full"
            hint="Spaces, tabs, blank lines and line breaks are kept exactly as typed and shown the same on the website."
          >
            <div className="seg" role="group" aria-label="Description mode" style={{ justifySelf: "start", marginBottom: 4 }}>
              <button type="button" className={!preview ? "on" : ""} onClick={() => setPreview(false)}><Icon name="edit" size={13} /> Write</button>
              <button type="button" className={preview ? "on" : ""} onClick={() => setPreview(true)}><Icon name="eye" size={13} /> Preview</button>
            </div>
            {preview ? (
              <TxtView text={d.description_public || " "} />
            ) : (
              <textarea
                className="txt"
                spellCheck={false}
                value={d.description_public}
                onKeyDown={(e) => tabKey(e, (v) => up({ description_public: v }))}
                onChange={(e) => up({ description_public: e.target.value })}
              />
            )}
          </Field>
          <Field label="YouTube video URL" optional error={yt ? "Not a recognised YouTube video URL" : null}>
            <input value={d.youtube_url} onChange={(e) => up({ youtube_url: e.target.value })} placeholder="https://youtu.be/…" />
          </Field>
          <div />
          <div className="full">
            <label className="check">
              <input type="checkbox" checked={d.show_old_owner_public} onChange={(e) => up({ show_old_owner_public: e.target.checked })} />
              Show the previous owner's <b>name</b> on the website (their number is never public)
            </label>
          </div>
        </div>
      </section>

      <section className="form-section">
        <header>
          <h2>Purchase details</h2>
          <p>Cost, source and notes for your own books. Never shown on the website.</p>
          <span className="scope private"><Icon name="lock" size={12} /> Owner only</span>
        </header>
        <div className="form-grid">
          <Field label="Purchase cost *" hint="Enter 0 for a free account">
            <input value={d.purchase_cost} onChange={(e) => up({ purchase_cost: e.target.value })} inputMode="decimal" required placeholder="0" />
          </Field>
          <Field label="Purchase currency *">
            <select value={d.purchase_currency} onChange={(e) => up({ purchase_currency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="full">
            <FxPreview amount={d.purchase_cost} currency={d.purchase_currency} label="Purchase cost" />
            {d.purchase_currency === "USD" && (
              <small className="hint">
                {orig?.purchase_fx_micro && orig.purchase_currency === "USD" && orig.purchase_cost_minor === safeMinor(d.purchase_cost, "USD")
                  ? "The exchange rate recorded with this purchase is kept for your PKR-equivalent reports."
                  : quote
                    ? "This rate is saved with the purchase for your PKR-equivalent reports and never changes afterwards."
                    : "No exchange rate available now: this USD purchase is shown in USD and left out of PKR-equivalent totals until a rate is recorded (edit and save later)."}
              </small>
            )}
          </div>
          <Field label="Purchase date" optional>
            <input type="date" value={d.purchased_at} onChange={(e) => up({ purchased_at: e.target.value })} />
          </Field>
          <Field label="Purchase reference" optional>
            <input value={d.purchase_reference} onChange={(e) => up({ purchase_reference: e.target.value })} />
          </Field>
          <Field label="Previous owner name" optional>
            <input value={d.old_owner_name} onChange={(e) => up({ old_owner_name: e.target.value })} />
          </Field>
          <Field label="Previous owner WhatsApp" optional>
            <input value={d.old_owner_whatsapp} onChange={(e) => up({ old_owner_whatsapp: e.target.value })} placeholder="+92…" />
          </Field>
          <Field label="Internal notes" optional className="full">
            <textarea value={d.internal_notes} onChange={(e) => up({ internal_notes: e.target.value })} rows={3} />
          </Field>
        </div>
      </section>

      {!editing && (
        <section className="form-section">
          <header>
            <h2>Login links</h2>
            <p>At least 1 · max 2 social, 1 phone and 1 email (4 total). Phone and email share one encrypted password.</p>
            <span className="scope private"><Icon name="lock" size={12} /> Owner only</span>
          </header>
          <div>
          <div className="card-head">
            <span className="small muted">{links.length} of 4 links</span>
            <span className="spacer" />
            {availableLinkKinds(links.map((l) => ({ kind: l.kind, deleted: false }))).length > 0 && (
              <button
                type="button"
                className="btn sm"
                onClick={() => setLinks((ls) => [...ls, emptyLink(availableLinkKinds(ls.map((l) => ({ kind: l.kind, deleted: false })))[0])])}
              >
                <Icon name="plus" size={14} /> Add link
              </button>
            )}
          </div>
          {links.map((l, i) => {
            const others = links.filter((_, j) => j !== i).map((x) => ({ kind: x.kind, deleted: false }));
            return (
              <div key={i} className="link-card" style={{ marginBottom: 12 }}>
                <div className="card-head">
                  <span className="icon-tile"><Icon name="link" size={14} /></span>
                  <b>Link {i + 1}</b>
                  <span className="spacer" />
                  {links.length > 1 && <button type="button" className="btn ghost sm" onClick={() => setLinks(links.filter((_, j) => j !== i))}>Remove</button>}
                </div>
                <LinkFields d={l} set={(nd) => setLinks(links.map((x, j) => (j === i ? nd : x)))} allowedKinds={availableLinkKinds(others)} />
              </div>
            );
          })}
          {needsPassword && (
            <Field label="Shared phone/email password" optional hint="Encrypted on this device with your vault key before saving. Leave empty to add later. Requires an unlocked vault.">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          )}
          </div>
        </section>
      )}
      </div>
      {error && stage === "image_failed" && <div ref={failRef}><Notice kind="bad" className="image-failed">{error}</Notice></div>}
      <div className="action-bar">
        {stage === "image" ? (
          <span className="save-progress" role="status">
            <span className="bar" aria-hidden="true"><i /></span>
            {svc.kind === "desktop" ? "Saving photo on this PC…" : "Uploading photo to ImageKit…"}
          </span>
        ) : (
          <span className="small faint">{editing ? "Changes sync to your other devices and the website." : "Saved on this device first, then synced."}</span>
        )}
        <span className="spacer" />
        {stage === "image_failed" && savedId ? (
          <>
            <button type="button" className="btn ghost" onClick={() => nav(`/accounts/${savedId}`)}>Continue without photo</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void retryImage()}><Icon name="sync" size={16} /> {busy ? "Retrying…" : "Retry photo"}</button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={() => nav(-1)} disabled={busy}>Cancel</button>
            <button className="btn primary" disabled={busy || !!savedId}>
              <Icon name="check" size={16} /> {stage === "saving" ? "Saving…" : stage === "image" ? "Saving photo…" : editing ? "Save changes" : "Create account"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
