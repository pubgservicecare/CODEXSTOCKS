/**
 * Readable public URLs: codexstocks.org/accounts/blood-raven-maxx-with-alan-walker-emote
 *
 * The server assigns each account its slug (clients never choose one): the title in lower case with accents
 * removed, "&" as "and", apostrophes dropped and every other run of punctuation/spaces as one "-". When
 * another account already owns that slug (now or in the past), a short suffix from the account's own id is
 * added, so a slug is never reused for a different account. Old slugs and old id URLs redirect permanently.
 */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
const FALLBACK = "pubg-account";

export function slugify(title: string): string {
  let s = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > SLUG_MAX) {
    s = s.slice(0, SLUG_MAX);
    const cut = s.lastIndexOf("-");
    if (cut > SLUG_MAX / 2) s = s.slice(0, cut);
    s = s.replace(/-+$/g, "");
  }
  return s || FALLBACK;
}

/** Slugs to try in order: the plain one, then with 4, 6, 8 and 12 characters of the account's id. */
export function slugCandidates(title: string, id: string): string[] {
  const base = slugify(title);
  const hex = id.replace(/-/g, "").toLowerCase();
  return [base, ...[4, 6, 8, 12].map((n) => `${base}-${hex.slice(-n)}`)];
}

export function isSlug(v: unknown): v is string {
  return typeof v === "string" && v.length <= 120 && SLUG_RE.test(v);
}
