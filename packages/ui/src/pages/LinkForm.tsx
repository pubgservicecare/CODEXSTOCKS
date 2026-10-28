import { PROVIDER_LABELS, SOCIAL_PROVIDERS, type LinkInput, type LinkKind, type LoginLink } from "@codex/shared";
import { Field } from "../components";

export type LinkDraft = {
  kind: LinkKind;
  provider: string;
  identifier: string;
  display_name: string;
  owner_name: string;
  owner_contact: string;
  owner_notes: string;
  status: string;
  two_step_enabled: boolean;
  two_step_method: string;
  two_step_destination: string;
  two_step_accessible: "" | "yes" | "no";
  recovery_info: string;
};

export function emptyLink(kind: LinkKind = "email"): LinkDraft {
  return {
    kind, provider: kind === "social" ? "google" : "", identifier: "", display_name: "", owner_name: "", owner_contact: "",
    owner_notes: "", status: "active", two_step_enabled: false, two_step_method: "none", two_step_destination: "",
    two_step_accessible: "", recovery_info: "",
  };
}

export function linkToDraft(l: LoginLink): LinkDraft {
  return {
    kind: l.kind, provider: l.provider ?? "", identifier: l.identifier ?? "", display_name: l.display_name ?? "",
    owner_name: l.owner_name ?? "", owner_contact: l.owner_contact ?? "", owner_notes: l.owner_notes ?? "", status: l.status,
    two_step_enabled: l.two_step_enabled, two_step_method: l.two_step_method, two_step_destination: l.two_step_destination ?? "",
    two_step_accessible: l.two_step_accessible === null ? "" : l.two_step_accessible ? "yes" : "no", recovery_info: l.recovery_info ?? "",
  };
}

const nz = (s: string) => (s.trim() === "" ? null : s.trim());

export function draftToInput(d: LinkDraft): LinkInput {
  return {
    kind: d.kind,
    provider: d.kind === "social" ? ((d.provider || "other") as LinkInput["provider"]) : null,
    identifier: nz(d.identifier),
    display_name: nz(d.display_name),
    owner_name: nz(d.owner_name),
    owner_contact: nz(d.owner_contact),
    owner_notes: nz(d.owner_notes),
    status: d.status as LinkInput["status"],
    two_step_enabled: d.two_step_enabled,
    two_step_method: (d.two_step_enabled ? (d.two_step_method === "none" ? "phone" : d.two_step_method) : "none") as LinkInput["two_step_method"],
    two_step_destination: d.two_step_enabled ? nz(d.two_step_destination) : null,
    two_step_accessible: d.two_step_enabled ? (d.two_step_accessible === "" ? null : d.two_step_accessible === "yes") : null,
    recovery_info: nz(d.recovery_info),
  };
}

export function LinkFields({
  d,
  set,
  allowedKinds,
  kindLocked,
}: {
  d: LinkDraft;
  set: (d: LinkDraft) => void;
  allowedKinds: LinkKind[];
  kindLocked?: boolean;
}) {
  const up = (p: Partial<LinkDraft>) => set({ ...d, ...p });
  return (
    <div className="form-grid">
      <Field label="Login type">
        <select
          value={d.kind}
          disabled={kindLocked}
          onChange={(e) => up({ kind: e.target.value as LinkKind, provider: e.target.value === "social" ? "google" : "" })}
        >
          {(["email", "phone", "social"] as LinkKind[]).map((k) => (
            <option key={k} value={k} disabled={!kindLocked && !allowedKinds.includes(k) && k !== d.kind}>
              {k === "email" ? "Email login" : k === "phone" ? "Phone / number login" : "Social login"}
            </option>
          ))}
        </select>
      </Field>
      {d.kind === "social" ? (
        <Field label="Provider">
          <select value={d.provider} onChange={(e) => up({ provider: e.target.value })}>
            {SOCIAL_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={d.kind === "phone" ? "Phone number *" : "Email address *"}>
          <input value={d.identifier} onChange={(e) => up({ identifier: e.target.value })} placeholder={d.kind === "phone" ? "+92 300 1234567" : "name@example.com"} />
        </Field>
      )}
      {d.kind === "social" && (
        <Field label="Linked account (handle / email shown by provider)">
          <input value={d.identifier} onChange={(e) => up({ identifier: e.target.value })} />
        </Field>
      )}
      <Field label="Display name">
        <input value={d.display_name} onChange={(e) => up({ display_name: e.target.value })} />
      </Field>
      <Field label="Link owner name">
        <input value={d.owner_name} onChange={(e) => up({ owner_name: e.target.value })} />
      </Field>
      <Field label="Link owner contact number">
        <input value={d.owner_contact} onChange={(e) => up({ owner_contact: e.target.value })} placeholder="+92…" />
      </Field>
      <Field label="Link status">
        <select value={d.status} onChange={(e) => up({ status: e.target.value })}>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="inactive">Inactive</option>
          <option value="lost">Lost access</option>
        </select>
      </Field>
      <Field label="Owner notes" className="full">
        <textarea value={d.owner_notes} onChange={(e) => up({ owner_notes: e.target.value })} rows={2} />
      </Field>
      {d.kind === "social" && (
        <div className="notice info full small">
          Social links store no password. Sign-in must go through the provider's own authorised login flow; this app never simulates or bypasses it.
        </div>
      )}
      <div className="full">
        <label className="check">
          <input type="checkbox" checked={d.two_step_enabled} onChange={(e) => up({ two_step_enabled: e.target.checked, two_step_method: e.target.checked ? "phone" : "none" })} />
          2-Step Verification is enabled on this login
        </label>
      </div>
      {d.two_step_enabled && (
        <>
          <Field label="2-Step method">
            <select value={d.two_step_method} onChange={(e) => up({ two_step_method: e.target.value })}>
              <option value="phone">Phone (SMS / call)</option>
              <option value="email">Email</option>
              <option value="authenticator">Authenticator app</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Verification destination">
            <input value={d.two_step_destination} onChange={(e) => up({ two_step_destination: e.target.value })} placeholder="e.g. +92 3xx… or backup@…" />
          </Field>
          <Field label="Can you access that destination?">
            <select value={d.two_step_accessible} onChange={(e) => up({ two_step_accessible: e.target.value as LinkDraft["two_step_accessible"] })}>
              <option value="">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </>
      )}
      <Field label="Recovery information" className="full" hint="Recovery email/phone or notes. Do not paste passwords here — use the encrypted shared password.">
        <textarea value={d.recovery_info} onChange={(e) => up({ recovery_info: e.target.value })} rows={2} />
      </Field>
    </div>
  );
}
